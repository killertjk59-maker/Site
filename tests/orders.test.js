/**
 * Воҳидҳо: мошини ҳолатҳои фармоиш (онлайн/нақдӣ), ҳисоботи даромад, промокодҳо, мехоҳишҳо.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const o = require("../src/orders");
const { summarizeRevenue } = require("../src/reports");
const { applyPromo, normalizePromo, validatePromoInput } = require("../src/promos");
const { normalizePreferences, detectSafetyIntents, ageFromText } = require("../src/preferences");
const v = require("../src/validation");

const CONFIG = { currency: "TJS" };
const FOODS = [
  { id: 1, name: "Паста", price: 68, category: "Асосӣ", available: true, ingredients: [], allergens: [], tags: [] },
  { id: 2, name: "Бургер", price: 119, category: "Асосӣ", available: true, ingredients: [], allergens: [], tags: [] },
  { id: 7, name: "Нӯшок", price: 24, category: "Нӯшокӣ", available: false, ingredients: [], allergens: [], tags: [] },
  { id: 3, name: "Лак (санҷиш)", price: 9000, category: "Асосӣ", available: true, ingredients: [], allergens: [], tags: [] },
];

function make(input = {}, opts = {}) {
  const { order, accessToken } = o.buildOrder(
    {
      customerName: "Алӣ Тестов",
      phone: "+992 90 111 22 33",
      address: "Душанбе, кӯчаи Сино 1",
      method: "delivery",
      paymentMethod: "online",
      items: [{ foodId: 1, quantity: 2 }],
      ...input,
    },
    {
      foods: FOODS,
      promos: [],
      config: CONFIG,
      idForNew: 1,
      codeExists: () => false,
      now: Date.parse("2026-10-09T08:00:00Z"),
      ...opts,
    }
  );
  return { order, accessToken };
}

describe("Сохтани фармоиш (нархҳо аз сервер)", () => {
  test("ҷамъи дуруст: 2 × 68 = 136; онлайн → AWAITING_PAYMENT", () => {
    const { order, accessToken } = make();
    assert.equal(order.subtotal, 136);
    assert.equal(order.total, 136);
    assert.equal(order.status, "AWAITING_PAYMENT");
    assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
    assert.match(order.paymentCode, /^OSH-[A-Z2-9]{5}$/);
    assert.ok(accessToken.length >= 20);
    assert.notEqual(order.accessTokenHash, accessToken, "токен бояд хэш шавад");
  });

  test("нақдӣ → NEW / CASH_ON_DELIVERY", () => {
    const { order } = make({ paymentMethod: "cash" });
    assert.equal(order.status, "NEW");
    assert.equal(order.paymentStatus, "CASH_ON_DELIVERY");
  });

  test("таоми дастнорас рад мешавад", () => {
    assert.throws(() => make({ items: [{ foodId: 7, quantity: 1 }] }), /дастнорас/);
  });

  test("таоми номаълум рад мешавад", () => {
    assert.throws(() => make({ items: [{ foodId: 999, quantity: 1 }] }), /ёфт нашуд/);
  });

  test("фармоиши аз ҳад калон (маблағ > 20000) рад мешавад", () => {
    // 3 × 9000 = 27000 > 20000
    assert.throws(() => make({ items: [{ foodId: 3, quantity: 3 }] }), /ҳадди иҷозатдодашуда/);
  });

  test("ҳадди адад (60) ва миқдори як сатр (20)", () => {
    assert.throws(() => make({ items: [{ foodId: 1, quantity: 21 }] }), /бояд|аз 20|ҳудуд|20/);
  });

  test("код ба коллизия ҳеҷ гоҳ такрор намешавад (codeExists)", () => {
    let calls = 0;
    const { order } = make({}, { codeExists: () => (calls++ < 3) });
    assert.ok(order.paymentCode.startsWith("OSH-"));
    assert.equal(calls, 4);
  });
});

describe("Ҷараёни пардохти онлайн", () => {
  test("мизоҷ «пардохт кардам» → PAYMENT_REVIEW / IN_REVIEW; такрори он идемпотент", () => {
    const { order } = make();
    const r1 = o.submitPayment(order, "customer");
    assert.equal(r1.changed, true);
    assert.equal(order.status, "PAYMENT_REVIEW");
    assert.equal(order.paymentStatus, "IN_REVIEW");
    const r2 = o.submitPayment(order, "customer");
    assert.equal(r2.changed, false);
  });

  test("approve → PAID / CONFIRMED; дубора approve → 409", () => {
    const { order } = make();
    o.submitPayment(order);
    o.approvePayment(order, "admin:x");
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.status, "CONFIRMED");
    assert.throws(() => o.approvePayment(order, "admin:x"), (e) => e.status === 409);
  });

  test("reject → PAYMENT_REJECTED / REJECTED; мизоҷ метавонад дубора фиристад", () => {
    const { order } = make();
    o.submitPayment(order);
    o.rejectPayment(order, "admin:x", "Пул нарасид");
    assert.equal(order.status, "PAYMENT_REJECTED");
    assert.equal(order.paymentStatus, "REJECTED");
    assert.equal(order.rejectReason, "Пул нарасид");
    o.submitPayment(order);
    assert.equal(order.status, "PAYMENT_REVIEW");
  });

  test("reject баъди approve → 409", () => {
    const { order } = make();
    o.approvePayment(order, "admin:x");
    assert.throws(() => o.rejectPayment(order, "admin:x"), (e) => e.status === 409);
  });

  test("пеш аз пардохт DONE/COOKING иҷозат нест", () => {
    const { order } = make();
    for (const s of ["COOKING", "DELIVERING", "DONE", "CONFIRMED", "NEW"]) {
      assert.throws(() => o.setStatus(order, s, "admin:x"), (e) => e.status === 400 || e.status === 409, `статус ${s}`);
    }
    assert.deepEqual(o.allowedStatuses(order), ["CANCELLED"]);
  });

  test("пас аз approve → COOKING → DELIVERING → DONE; DONE пардохтро тағйир намедиҳад", () => {
    const { order } = make();
    o.approvePayment(order, "admin:x");
    assert.deepEqual(o.allowedStatuses(order), ["COOKING", "DELIVERING", "DONE", "CANCELLED"]);
    o.setStatus(order, "COOKING", "admin:x");
    o.setStatus(order, "DELIVERING", "admin:x");
    o.setStatus(order, "DONE", "admin:x");
    assert.equal(order.paymentStatus, "PAID");
    assert.deepEqual(o.allowedStatuses(order), []);
  });

  test("бекор кардани фармоиши пардохтшуда → REFUND_DUE", () => {
    const { order } = make();
    o.approvePayment(order, "admin:x");
    o.setStatus(order, "CANCELLED", "admin:x");
    assert.equal(order.status, "CANCELLED");
    assert.equal(order.paymentStatus, "REFUND_DUE");
  });

  test("approve барои фармоиши нақдӣ рад мешавад (409)", () => {
    const { order } = make({ paymentMethod: "cash" });
    assert.throws(() => o.approvePayment(order, "admin:x"), (e) => e.status === 409);
  });

  test("CANCELLED терминалӣ аст", () => {
    const { order } = make({ paymentMethod: "cash" });
    o.setStatus(order, "CANCELLED", "admin:x");
    assert.throws(() => o.setStatus(order, "COOKING", "admin:x"), (e) => e.status === 409);
    assert.throws(() => o.approvePayment(order, "admin:x"), (e) => e.status === 409);
  });
});

describe("Ҷараёни нақдӣ", () => {
  test("NEW → COOKING → DELIVERING → DONE; DONE → CASH_COLLECTED", () => {
    const { order } = make({ paymentMethod: "cash" });
    assert.deepEqual(o.allowedStatuses(order), ["COOKING", "DELIVERING", "DONE", "CANCELLED"]);
    o.setStatus(order, "COOKING", "admin:x");
    o.setStatus(order, "DELIVERING", "admin:x");
    assert.equal(order.paymentStatus, "CASH_ON_DELIVERY");
    o.setStatus(order, "DONE", "admin:x");
    assert.equal(order.paymentStatus, "CASH_COLLECTED");
    assert.ok(order.cashCollectedAt);
  });

  test("ҳолати якхела дар PATCH бенатиҷа (no-op) аст", () => {
    const { order } = make({ paymentMethod: "cash" });
    const r = o.setStatus(order, "NEW", "admin:x");
    assert.equal(r.changed, false);
  });

  test("статуси номаълум → 400", () => {
    const { order } = make({ paymentMethod: "cash" });
    assert.throws(() => o.setStatus(order, "HACKED", "admin:x"), (e) => e.status === 400);
  });

  test("таърихчаи рӯйдодҳо (events) дар ҳар қадам сабт мешавад", () => {
    const { order } = make({ paymentMethod: "cash" });
    o.setStatus(order, "COOKING", "admin:7");
    const last = order.events[order.events.length - 1];
    assert.equal(last.action, "status_changed");
    assert.equal(last.by, "admin:7");
    assert.deepEqual(last.details, { from: "NEW", to: "COOKING" });
  });
});

describe("DTO-ҳо: маълумоти хусусӣ берун намерасад", () => {
  test("customerView телефон, суроға ва токен надорад", () => {
    const { order } = make();
    const c = o.customerView(order);
    assert.equal(c.phone, undefined);
    assert.equal(c.address, undefined);
    assert.equal(c.accessTokenHash, undefined);
    assert.equal(c.customerName, undefined);
    assert.equal(c.paymentCode, order.paymentCode);
  });
  test("adminView токени хэшро намедиҳад, аммо allowedStatuses медиҳад", () => {
    const { order } = make();
    const a = o.adminView(order);
    assert.equal(a.accessTokenHash, undefined);
    assert.equal(a.phone, "+992 90 111 22 33");
    assert.ok(Array.isArray(a.allowedStatuses));
  });
});

describe("Ҳисоботи даромад", () => {
  const mk = (over) => ({
    createdAt: "2026-10-05T08:00:00Z", total: 100, status: "NEW", paymentMethod: "online", paymentStatus: "AWAITING_PAYMENT", ...over,
  });
  const orders = [
    mk({ total: 100, status: "DONE", paymentStatus: "PAID" }), // онлайн тасдиқшуда, анҷом ёфта
    mk({ total: 50, status: "CONFIRMED", paymentStatus: "PAID" }), // онлайн тасдиқшуда, дар ҷараён
    mk({ total: 70, status: "DONE", paymentMethod: "cash", paymentStatus: "CASH_COLLECTED" }), // нақди гирифташуда
    mk({ total: 30, status: "NEW", paymentMethod: "cash", paymentStatus: "CASH_ON_DELIVERY" }), // интизори нақд
    mk({ total: 200, status: "CANCELLED", paymentMethod: "cash", paymentStatus: "CASH_ON_DELIVERY" }), // бекоршуда (нақд)
    mk({ total: 300, status: "CANCELLED", paymentStatus: "REFUND_DUE" }), // пардохт шуда, бекоршуда
    mk({ total: 40, status: "PAYMENT_REVIEW", paymentStatus: "IN_REVIEW" }), // интизори санҷиш
  ];
  const r = summarizeRevenue(orders);

  test("approvedOnline = 150 (ҳар ду PAID)", () => assert.equal(r.approvedOnline, 150));
  test("cashCollected = 70 (танҳо CASH_COLLECTED)", () => assert.equal(r.cashCollected, 70));
  test("collectedNet = approvedOnline + cashCollected = 220", () => assert.equal(r.collectedNet, 220));
  test("revenue (нусхаи кӯҳна) = collectedNet", () => assert.equal(r.revenue, 220));
  test("фармоишҳои бекоршуда дар даромад нестанд", () => assert.ok(r.collectedNet < 220 + 200 + 300));
  test("refundDue = 300 (пардохт шуда, бекор шуда)", () => assert.equal(r.refundDue, 300));
  test("cancelled = 500 (ҳамаи бекоршуда)", () => assert.equal(r.cancelled, 500));
  test("salesCompleted = 170 (DONE)", () => assert.equal(r.salesCompleted, 170));
  test("pendingCash = 30; pendingOnline = 40", () => {
    assert.equal(r.pendingCash, 30);
    assert.equal(r.pendingOnline, 40);
  });
  test("ordersCount = 7", () => assert.equal(r.ordersCount, 7));
  test("филтри давра: фақат фармоишҳои дар давра", () => {
    const x = summarizeRevenue(orders, { fromMs: Date.parse("2026-10-06T00:00:00Z") });
    assert.equal(x.ordersCount, 0);
  });
});

describe("Промокодҳо", () => {
  const promos = [
    normalizePromo({ code: "OSHONA10", type: "percent", value: 10 }),
    normalizePromo({ code: "MINUS20", type: "amount", value: 20 }),
    normalizePromo({ code: "OLD", type: "percent", value: 5, expiresAt: "2026-01-01T00:00:00Z" }),
    normalizePromo({ code: "ONCE", type: "percent", value: 5, maxUses: 1, uses: 1 }),
    normalizePromo({ code: "BIG", type: "amount", value: 500, minTotal: 100 }),
    normalizePromo({ code: "OFF", type: "percent", value: 5, active: false }),
  ];
  test("10% аз 68 = 6.8 → 7 (қоидаи кӯҳна: бутун); ҷамъ 61", () => {
    const r = applyPromo(promos, "oshona10", 68);
    assert.equal(r.discount, 7);
    assert.equal(r.total, 61);
  });
  test("тахфифи маблағӣ, ҳадди поён танҳо 0", () => {
    const r = applyPromo(promos, "MINUS20", 15);
    assert.equal(r.discount, 15);
    assert.equal(r.total, 0);
  });
  test("мӯҳлат гузашта рад мешавад", () => {
    assert.throws(() => applyPromo(promos, "OLD", 100), /Мӯҳлат/);
  });
  test("ҳадди истифода пур шуда рад мешавад", () => {
    assert.throws(() => applyPromo(promos, "ONCE", 100), /ҳадди истифода/);
  });
  test("ҳадди ақали сумма", () => {
    assert.throws(() => applyPromo(promos, "BIG", 50), /ҳадди ақал/);
  });
  test("ғайрифаъол ва номаълум рад мешаванд", () => {
    assert.throws(() => applyPromo(promos, "OFF", 100), /ғайрифаъол|нодуруст/);
    assert.throws(() => applyPromo(promos, "NOPE", 100), /нодуруст/);
  });
  test("валидатсияи ворид: процент > 100 рад мешавад; код кӯтоҳ рад мешавад", () => {
    assert.throws(() => validatePromoInput({ code: "ABC", type: "percent", value: 150 }));
    assert.throws(() => validatePromoInput({ code: "A", type: "percent", value: 10 }));
    const ok = validatePromoInput({ code: "spring-26", type: "percent", value: 15 });
    assert.equal(ok.code, "SPRING-26");
  });
});

describe("Санҷиши воридшаванда (validation)", () => {
  test("телефон: 9–15 рақам; 1 рақам рад", () => {
    assert.equal(v.phone("+992 90 000 00 00"), "+992 90 000 00 00");
    assert.throws(() => v.phone("1"));
    assert.throws(() => v.phone("abc"));
  });
  test("сана: 2026-02-30 нодуруст аст", () => {
    assert.throws(() => v.isoDate("2026-02-30"), /санаи нодуруст/);
    assert.equal(v.isoDate("2028-02-29"), "2028-02-29");
  });
  test("HTML-тег рад мешавад (ҳимояи XSS)", () => {
    assert.throws(() => v.str("<img src=x onerror=alert(1)>", { field: "Ном" }), /манъшуда/);
  });
  test("control chars тоза мешаванд", () => {
    assert.equal(v.str("Алӣ\u0007  Тест", { field: "Ном" }), "Алӣ Тест");
  });
});

describe("Мехоҳишҳо ва ҳимояи наврасон/лоғаршавӣ", () => {
  test("синну сол аз матн: «ман 15 сол» → 15", () => {
    assert.equal(ageFromText("Ман 15 сол ҳастам"), 15);
    assert.equal(ageFromText("мне 16 лет"), 16);
    assert.equal(ageFromText("ба 2026 сол"), null, "сол-рақамҳои калон синну сол нестанд");
  });
  test("наврас → minor, ҳадафи light ғайрифаъол", () => {
    const p = normalizePreferences({ goal: "light" }, { text: "Ман 15 сол, калория кам бихӯрам" });
    assert.equal(p.minor, true);
    assert.equal(p.restrictedAdvice, true);
    assert.equal(p.goal, "balanced");
  });
  test("хостани лоғаршавӣ → weightLoss", () => {
    const i = detectSafetyIntents("Ман мехоҳам лоғар шавам, парҳез кунам");
    assert.equal(i.weightLoss, true);
  });
  test("истисноҳо ба allergen/tag мепайвандад", () => {
    const p = normalizePreferences({ avoid: ["шир", "гӯшт", "нон"] });
    assert.deepEqual(p.avoid.map((a) => a.type), ["allergen", "tag", "allergen"]);
  });
  test("буҷет манфӣ рад мешавад", () => {
    assert.throws(() => normalizePreferences({ budget: -5 }));
  });
});
