"use strict";

/**
 * Домени фармоишҳо: ҷараёни пардохт ва иҷро, қоидаҳои ҳолат (state machine),
 * ва сохтани фармоиши нав (нархҳо аз сервер).
 *
 * Ҷараёни онлайн (как қаблан):
 *   AWAITING_PAYMENT → (мизоҷ "пардохт кардам") PAYMENT_REVIEW
 *   PAYMENT_REVIEW → (админ тасдиқ) CONFIRMED [paymentStatus=PAID]
 *   PAYMENT_REVIEW → (админ рад)   PAYMENT_REJECTED [paymentStatus=REJECTED]
 *   PAYMENT_REJECTED → (мизоҷ дубора) PAYMENT_REVIEW, ё (админ тасдиқ) CONFIRMED
 *   CONFIRMED → COOKING → DELIVERING → DONE  (танҳо пас аз PAID)
 * Ҷараёни нақдӣ: NEW → COOKING → DELIVERING → DONE [paymentStatus=CASH_COLLECTED]
 * CANCELLED — терминалӣ; аз PAID бекор шавад → REFUND_DUE.
 * AI ҳеҷ гоҳ ягон қадамро иҷро намекунад.
 */
const { HttpError, hashToken, newAccessToken } = require("./security");
const v = require("./validation");
const { round2 } = require("./util");
const { makePaymentCode } = require("./payments");
const { applyPromo } = require("./promos");

const ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "PAYMENT_REJECTED",
  "NEW",
  "CONFIRMED",
  "COOKING",
  "DELIVERING",
  "DONE",
  "CANCELLED",
];
const PAYMENT_STATUSES = [
  "AWAITING_PAYMENT",
  "IN_REVIEW",
  "PAID",
  "REJECTED",
  "CASH_ON_DELIVERY",
  "CASH_COLLECTED",
  "REFUND_DUE",
];

const ONLINE_UNPAID = ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "PAYMENT_REJECTED"];
const FLOW_CASH = ["NEW", "COOKING", "DELIVERING", "DONE"];
const FLOW_ONLINE = ["CONFIRMED", "COOKING", "DELIVERING", "DONE"];
const TERMINAL = ["DONE", "CANCELLED"];

const LIMITS = {
  maxItemsPerOrder: 30,
  maxQtyPerLine: 20,
  maxUnitsPerOrder: 60,
  minTotal: 1,
  maxOrderTotal: 20000, // ҳадди ақлонии маблағи як фармоиш (барои фармоишҳои ғайриодӣ)
  maxEvents: 50,
};

const now = () => new Date().toISOString();

function pushEvent(order, action, by, details) {
  order.events = (order.events || []).slice(-(LIMITS.maxEvents - 1));
  order.events.push({ at: now(), action, by, ...(details ? { details } : {}) });
  order.updatedAt = now();
}

const isOnline = (o) => o.paymentMethod === "online";
const isPaidOnline = (o) => isOnline(o) && o.paymentStatus === "PAID";

/**
 * Рӯйхати ҳолатҳое, ки админ метавонад ба онҳо барояд (бо PATCH /status).
 * Тасдиқ/рад ба ҳолатҳои алоҳида (approve/reject) тааллуқ дорад ва инҷо нест.
 */
function allowedStatuses(order) {
  if (TERMINAL.includes(order.status)) return [];
  const out = [];
  // Фармоиши онлайн то PAID ба иҷро намеравад; нақдӣ — аз NEW
  const canFulfil = !isOnline(order) || isPaidOnline(order);
  if (canFulfil) {
    const flow = isOnline(order) ? FLOW_ONLINE : FLOW_CASH;
    const idx = flow.indexOf(order.status);
    // Ҳолати ҷорӣ дар ҷараён нест (масалан нақдии CONFIRMED-и пештара) → ҳамаи қадамҳои баъдӣ
    const from = idx >= 0 ? idx + 1 : 1;
    out.push(...flow.slice(from));
  }
  out.push("CANCELLED");
  return out;
}

/** Фармоишҳои онлайн: admin approve/reject */
function reviewActions(order) {
  const actions = [];
  if (!isOnline(order)) return actions;
  if (order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_REVIEW" || order.status === "PAYMENT_REJECTED") {
    actions.push("approve");
  }
  if (order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_REVIEW") actions.push("reject");
  return actions;
}

/** Тасдиқ/рад: санҷиш ва татбиқ (мутатсия). Танҳо барои онлайн. */
function approvePayment(order, actor) {
  if (!isOnline(order)) throw new HttpError(409, "Ин фармоиш нақдӣ аст — тасдиқи пардохт лозим нест.", "NOT_ONLINE");
  if (!ONLINE_UNPAID.includes(order.status)) {
    throw new HttpError(409, `Пардохт дар ҳолати «${order.status}» тасдиқ карда намешавад.`, "BAD_STATE");
  }
  order.paymentStatus = "PAID";
  order.status = "CONFIRMED";
  order.paidAt = now();
  order.rejectReason = null;
  pushEvent(order, "payment_approved", actor);
  return order;
}

function rejectPayment(order, actor, reason) {
  if (!isOnline(order)) throw new HttpError(409, "Ин фармоиш нақдӣ аст — рад кардани пардохт лозим нест.", "NOT_ONLINE");
  if (!["AWAITING_PAYMENT", "PAYMENT_REVIEW"].includes(order.status)) {
    throw new HttpError(409, `Пардохт дар ҳолати «${order.status}» рад карда намешавад.`, "BAD_STATE");
  }
  order.paymentStatus = "REJECTED";
  order.status = "PAYMENT_REJECTED";
  order.rejectReason = reason ? String(reason).slice(0, 200) : null;
  pushEvent(order, "payment_rejected", actor, order.rejectReason ? { reason: order.rejectReason } : undefined);
  return order;
}

/** Мизоҷ мегӯяд «пардохт кардам» → санҷиши админ */
function submitPayment(order, actor = "customer") {
  if (!isOnline(order)) throw new HttpError(400, "Ин фармоиш нақдӣ аст.", "NOT_ONLINE");
  if (order.status === "PAYMENT_REVIEW") return { order, changed: false };
  if (order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_REJECTED") {
    order.status = "PAYMENT_REVIEW";
    order.paymentStatus = "IN_REVIEW";
    order.submittedAt = now();
    pushEvent(order, "payment_submitted", actor);
    return { order, changed: true };
  }
  throw new HttpError(409, `Фармоиш дар ҳолати «${order.status}» аст; «пардохт кардам» имкон надорад.`, "BAD_STATE");
}

/** Тағйири ҳолати иҷро аз ҷониби админ (PATCH /status) */
function setStatus(order, target, actor, { allowNoop = true } = {}) {
  if (!ORDER_STATUSES.includes(target)) throw new HttpError(400, "Статус нодуруст.", "BAD_STATUS");
  if (target === order.status) {
    if (allowNoop) return { order, changed: false };
  }
  if (["AWAITING_PAYMENT", "PAYMENT_REVIEW", "PAYMENT_REJECTED", "CONFIRMED"].includes(target)) {
    throw new HttpError(400, "Ин статусро бевосита гузоштан мумкин нест (тасдиқ/рад тавассути пардохт).", "STATUS_RESERVED");
  }
  if (TERMINAL.includes(order.status)) {
    throw new HttpError(409, `Фармоиш «${order.status}» аст ва тағйир ёфта наметавонад.`, "TERMINAL");
  }
  const allowed = allowedStatuses(order);
  if (!allowed.includes(target)) {
    const hint = isOnline(order) && !isPaidOnline(order)
      ? " Аввал пардохтро тасдиқ кунед."
      : "";
    throw new HttpError(409, `Гузариш аз «${order.status}» ба «${target}» иҷозат нест.${hint}`, "BAD_TRANSITION");
  }

  const from = order.status;
  if (target === "CANCELLED") {
    if (isPaidOnline(order)) order.paymentStatus = "REFUND_DUE";
    order.cancelledAt = now();
  }
  if (target === "DONE" && !isOnline(order)) {
    order.paymentStatus = "CASH_COLLECTED";
    order.cashCollectedAt = now();
  }
  order.status = target;
  pushEvent(order, "status_changed", actor, { from, to: target });
  return { order, changed: true };
}

/** Санҷиши ворид ва сохтани фармоиш. Нархро аз сервер мегирад. */
function buildOrder(input, { foods, promos, config, idForNew, codeExists, actor = "customer", now: nowMs = Date.now() }) {
  const b = v.object(input);
  const customerName = v.str(b.customerName ?? b.name, { field: "Ном", required: true, min: 2, max: 80 });
  const phone = v.phone(b.phone, { field: "Телефон", required: true });
  const method = v.oneOf(b.method || "delivery", ["delivery", "pickup"], { field: "Усули гирифтан" });
  const address = v.str(b.address, { field: "Суроға", max: 200, min: method === "delivery" ? 5 : 0, required: method === "delivery" });
  const payMethod = v.oneOf(b.paymentMethod || "online", ["online", "cash"], { field: "Усули пардохт" });
  const provider = payMethod === "online" ? (["manual", "dc", "alif"].includes(b.paymentProvider) ? b.paymentProvider : "manual") : null;

  const rawItems = v.array(b.items, { field: "Сабад", min: 1, max: LIMITS.maxItemsPerOrder, required: true });
  let units = 0;
  let subtotal = 0;
  const items = rawItems.map((it, i) => {
    if (!it || typeof it !== "object") throw v.fail("Сабад", `unsur #${i + 1} нодуруст аст`);
    const foodId = v.int(it.foodId ?? it.id, { field: `Таом #${i + 1}`, min: 1, max: 1e9, required: true });
    const quantity = v.int(it.quantity ?? it.qty ?? 1, { field: `Миқдор #${i + 1}`, min: 1, max: LIMITS.maxQtyPerLine, required: true });
    const food = foods.find((f) => f.id === foodId);
    if (!food) throw new HttpError(400, `Таом бо id=${foodId} ёфт нашуд.`, "FOOD_NOT_FOUND");
    if (food.available === false) throw new HttpError(400, `«${food.name}» имрӯз дастнорас аст. Аз сабад хориҷ кунед.`, "FOOD_UNAVAILABLE");
    units += quantity;
    subtotal += food.price * quantity;
    return { foodId: food.id, name: food.name, price: food.price, quantity };
  });
  if (units > LIMITS.maxUnitsPerOrder) throw v.fail("Сабад", `зиёда аз ${LIMITS.maxUnitsPerOrder} адад дар як фармоиш`);

  subtotal = round2(subtotal);
  if (subtotal > LIMITS.maxOrderTotal) {
    throw new HttpError(400, `Маблағи фармоиш аз ҳадди иҷозатдодашуда (${LIMITS.maxOrderTotal} ${config.currency}) зиёд аст. Бо ресторан тамос гиред.`, "ORDER_TOO_LARGE");
  }

  const promoCode = b.promo ? String(b.promo) : "";
  const pr = applyPromo(promos, promoCode, subtotal, { now: nowMs });
  const total = round2(pr.total);
  if (total < LIMITS.minTotal) throw new HttpError(400, "Маблағи фармоиш аз 1 с. кам аст.", "TOTAL_TOO_LOW");

  let paymentCode = makePaymentCode();
  let guard = 0;
  while (codeExists(paymentCode) && guard++ < 20) paymentCode = makePaymentCode();

  const accessToken = newAccessToken();
  const created = new Date(nowMs).toISOString();
  const order = {
    id: idForNew,
    customerName,
    phone,
    address,
    method,
    paymentMethod: payMethod,
    paymentProvider: provider,
    paymentCode,
    paymentStatus: payMethod === "cash" ? "CASH_ON_DELIVERY" : "AWAITING_PAYMENT",
    status: payMethod === "cash" ? "NEW" : "AWAITING_PAYMENT",
    items,
    subtotal,
    discount: pr.discount,
    promo: pr.promo,
    total,
    currency: config.currency,
    createdAt: created,
    updatedAt: created,
    accessTokenHash: hashToken(accessToken),
    events: [{ at: created, action: "created", by: actor }],
    rejectReason: null,
  };
  return { order, accessToken };
}

/** DTO барои мизоҷ — бе телефон, суроға ва токен */
function customerView(order) {
  return {
    id: order.id,
    orderId: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paymentCode: order.paymentCode,
    method: order.method,
    items: order.items.map((i) => ({ foodId: i.foodId, name: i.name, price: i.price, quantity: i.quantity })),
    subtotal: order.subtotal,
    discount: order.discount || 0,
    promo: order.promo || null,
    total: order.total,
    currency: order.currency,
    rejectReason: order.status === "PAYMENT_REJECTED" ? order.rejectReason || null : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** DTO барои админ — пурра (бе хешҳои токен) + амалиёти имконпазир */
function adminView(order) {
  const { accessTokenHash, ...rest } = order;
  return {
    ...rest,
    orderId: order.id,
    allowedStatuses: allowedStatuses(order),
    reviewActions: reviewActions(order),
    // Номҳои қаблии майдонҳо (барои мувофиқат бо скрипти кӯҳнаи админ)
    customer_name: order.customerName,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    payment_code: order.paymentCode,
  };
}

module.exports = {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  LIMITS,
  allowedStatuses,
  reviewActions,
  approvePayment,
  rejectPayment,
  submitPayment,
  setStatus,
  buildOrder,
  customerView,
  adminView,
  isPaidOnline,
  isOnline,
  pushEvent,
};
