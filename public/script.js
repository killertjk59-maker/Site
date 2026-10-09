/* OSHONA — сайти мизоҷ.
 * Қоидаҳо:
 *  - ҳама матни динамикӣ бо esc() ҳатман тоза мешавад (XSS);
 *  - меню танҳо аз сервер (/api/foods) меояд; ягон меню-и демо дар код нест;
 *  - паёми «муваффақ» танҳо пас аз тасдиқи сервер (HTTP 2xx) нишон дода мешавад;
 *  - фармоишҳои мизоҷ бо токени дастрасӣ (X-Order-Token) идора мешаванд; телефон барои ҷустуҷӯ нест;
 *  - скрипти инлайн ва onclick/onerror нест (CSP: script-src 'self').
 */
"use strict";

/* ---------- Ёрирасонҳо ---------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/[&<>"'`]/g, (c) => ESC_MAP[c]);
/** Танҳо URL-и https ё файли аз сервер боршуда (/uploads/...) иҷозат аст */
const safeImageUrl = (u) => {
  const s = String(u || "");
  return /^https:\/\/[^\s"'<>]+$/i.test(s) || /^\/uploads\/[A-Za-z0-9._-]+$/.test(s) ? s : "";
};
const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = String(text); };
const CONF = { high: "эътимод: баланд", medium: "эътимод: миёна", low: "эътимод: паст (тахминӣ)" };

function store(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ҳеҷ */ } }

class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/** Даъвати API. Хатогиҳо ApiError мепартоянд (матни сервер — барои корбар). */
async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["X-Order-Token"] = token;
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Пайвасти шабака нест. Лутфан, интернетро санҷед.");
  }
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* ҷавоби матнӣ */ }
  if (!res.ok) {
    const msg = data && data.error ? data.error : res.status === 429 ? "Дархостҳо зиёданд. Каме интизор шавед." : `Хатогӣ (${res.status})`;
    throw new ApiError(res.status, msg, data && data.code);
  }
  return data;
}

/* ---------- Ҳолат ---------- */
function loadCart() {
  const raw = store("oshonaCart", []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => ({ id: Number(x && x.id), qty: Math.floor(Number(x && x.qty)) }))
    .filter((x) => Number.isInteger(x.id) && x.id > 0 && Number.isInteger(x.qty) && x.qty >= 1 && x.qty <= 20)
    .slice(0, 30);
}
function loadOrders() {
  const raw = store("oshonaOrders", []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && Number.isInteger(Number(x.id)) && typeof x.token === "string" && x.token.length >= 16)
    .map((x) => ({ id: Number(x.id), token: String(x.token), total: Number(x.total) || 0, createdAt: String(x.createdAt || "") }))
    .slice(0, 20);
}

const state = {
  foods: [],
  menuLoaded: false,
  menuError: "",
  cart: loadCart(),
  orders: loadOrders(),
  promo: null,
  chat: [],
  aiEnabled: false,
  telegramBot: null,
  currency: "TJS",
};

const findFood = (id) => state.foods.find((f) => f.id === id) || null;
const cartLines = () => state.cart.map((x) => ({ ...x, food: findFood(x.id) })).filter((x) => x.food);
const cartSubtotal = () => cartLines().reduce((s, x) => s + x.food.price * x.qty, 0);
const cartCount = () => state.cart.reduce((s, x) => s + x.qty, 0);
function saveCart() { save("oshonaCart", state.cart); renderCart(); }
function saveOrders() { save("oshonaOrders", state.orders); }

/* ---------- Оғоз ---------- */
window.addEventListener("load", () => setTimeout(() => $("#loader").classList.add("hide"), 500));
window.addEventListener("scroll", () => $("#header").classList.toggle("scrolled", window.scrollY > 40));

async function loadConfig() {
  try {
    const cfg = await api("/config");
    state.aiEnabled = Boolean(cfg.aiEnabled);
    state.telegramBot = cfg.telegramBotUsername || null;
    state.currency = cfg.currency || "TJS";
  } catch { /* конфиг ихтиёрӣ аст */ }
  $("#aiBtn").hidden = false;
}

async function loadMenu() {
  try {
    const list = await api("/foods");
    state.foods = Array.isArray(list) ? list : [];
    state.menuLoaded = true;
    state.menuError = "";
  } catch (err) {
    state.menuError = err.message;
  }
  renderFilters();
  renderFoods(currentCategory);
  if (state.menuLoaded) pruneCart();
  renderCart();
  renderMenuStatus();
}

/** Агар таом аз меню нест шуда бошад, аз сабад хориҷ мешавад (танҳо вақте ки меню дуруст боргирӣ шуд) */
function pruneCart() {
  const before = state.cart.length;
  state.cart = state.cart.filter((x) => findFood(x.id));
  if (state.cart.length !== before) {
    save("oshonaCart", state.cart);
    toast("Баъзе таомҳо дастнорас шуданд ва аз сабад хориҷ карда шуданд.");
  }
}

function renderMenuStatus() {
  const box = $("#menuStatus");
  if (state.menuError) {
    box.hidden = false;
    box.innerHTML = `<p>Меню ҳоло дастнорас аст: ${esc(state.menuError)}</p><button class="btn btn-ghost" type="button" data-retry-menu>Аз нав кӯшиш</button>`;
  } else if (state.menuLoaded && !state.foods.length) {
    box.hidden = false;
    box.innerHTML = "<p>Ҳоло таом дар меню нест.</p>";
  } else {
    box.hidden = true;
    box.innerHTML = "";
  }
}

/* ---------- Меню ---------- */
let currentCategory = "Ҳама";

function renderFilters() {
  const cats = [...new Set(state.foods.filter((f) => f.available !== false).map((f) => f.category))];
  const all = ["Ҳама", ...cats];
  $("#filters").innerHTML = all
    .map((c) => `<button class="filter ${c === currentCategory ? "active" : ""}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`)
    .join("");
}

function nutritionLine(n) {
  if (!n || n.status !== "computed") return '<span class="nutri-none">Калория: маълумот нест</span>';
  return `<span class="nutri"><b>${esc(n.calories)} ккал</b> · сафеда ${esc(n.protein)} г · равған ${esc(n.fat)} г · карбо ${esc(n.carbs)} г</span>` +
    ` <span class="conf conf-${esc(n.confidence)}">${esc(CONF[n.confidence] || "")}</span>`;
}

function renderFoods(cat = "Ҳама") {
  currentCategory = cat;
  const list = state.foods.filter((f) => f.available !== false && (cat === "Ҳама" || f.category === cat));
  $("#foodGrid").innerHTML = list
    .map((f) => {
      const img = safeImageUrl(f.image);
      return `
    <article class="food-card reveal visible" data-open="${esc(f.id)}">
      ${img ? `<div class="food-image" style="background-image:url('${esc(img)}')"></div>` : '<div class="food-image food-image-empty">🍽</div>'}
      <div class="food-info">
        <div class="food-top"><h3>${esc(f.name)}</h3><span class="price">${esc(f.price)} с.</span></div>
        <p>${esc(f.description)}</p>
        <div class="food-nutri">${nutritionLine(f.nutrition)}</div>
        <button class="add" data-add="${esc(f.id)}" type="button">+ Ба сабад</button>
      </div>
    </article>`;
    })
    .join("");
  if (!list.length && state.menuLoaded) {
    $("#foodGrid").innerHTML = '<div class="empty">Дар ин категория таом нест.</div>';
  }
}

function openFood(id) {
  const f = findFood(id);
  if (!f) return;
  const img = safeImageUrl(f.image);
  const allergens = (f.allergens || []).map((a) => `<span class="allergen-chip">${esc(a.label)}</span>`).join("");
  const ingredients = (f.ingredients || []).length
    ? `<ul class="ing-list">${f.ingredients.map((i) => `<li>${esc(i.name)} — ${esc(i.grams)} г</li>`).join("")}</ul>`
    : '<p class="muted">Таркиби таом ҳоло дар сайт нишон дода намешавад.</p>';
  const n = f.nutrition || {};
  const src = n.status === "computed" && n.source ? `<small class="muted">Манбаъ: ${esc(n.source)}</small>` : "";
  $("#foodModalContent").innerHTML = `
    <div class="modal-food">
      ${img ? `<img src="${esc(img)}" alt="${esc(f.name)}">` : ""}
      <div>
        <p class="eyebrow">${esc(f.category)}</p>
        <h2>${esc(f.name)}</h2>
        <p>${esc(f.description)}</p>
        <div class="food-nutri-box">
          <h4>Ғизо${f.weightG ? ` · порсия ${esc(f.weightG)} г` : ""}</h4>
          <p>${nutritionLine(n)}</p>
          ${src}
        </div>
        ${allergens ? `<div class="allergens"><h4>Аллергенҳо</h4>${allergens}</div>` : ""}
        <div class="ingredients"><h4>Таркиб</h4>${ingredients}</div>
        <strong class="price">${esc(f.price)} с.</strong>
        <button class="btn btn-primary full" style="margin-top:20px" data-add="${esc(f.id)}" type="button">Ба сабад илова кардан</button>
      </div>
    </div>`;
  $("#foodModal").classList.add("show");
  showOverlay();
}

/* ---------- Сабад ---------- */
function addToCart(id) {
  const food = findFood(id);
  if (!food) { toast("Ин таом дастнорас аст."); return; }
  const item = state.cart.find((x) => x.id === id);
  if (item) {
    if (item.qty >= 20) { toast("Барои як таом ҳадди 20 адад аст."); return; }
    item.qty += 1;
  } else {
    state.cart.push({ id, qty: 1 });
  }
  saveCart();
  toast("Ба сабад илова шуд ✓");
}

function renderCart() {
  const count = cartCount();
  setText("#cartCount", count);
  setText("#tabCartCount", count);
  const lines = cartLines();
  $("#cartEmpty").style.display = lines.length ? "none" : "block";
  $("#cartItems").innerHTML = lines
    .map((x) => {
      const img = safeImageUrl(x.food.image);
      return `<div class="cart-row">
        ${img ? `<img src="${esc(img)}" alt="">` : '<div class="cart-noimg">🍽</div>'}
        <div><h4>${esc(x.food.name)}</h4><small>${esc(x.food.price)} с.</small>
          <div class="qty"><button type="button" data-minus="${esc(x.id)}">−</button><span>${esc(x.qty)}</span><button type="button" data-plus="${esc(x.id)}">+</button></div>
        </div>
        <strong>${esc(x.food.price * x.qty)} с.</strong></div>`;
    })
    .join("");
  setText("#cartTotal", `${cartSubtotal()} с.`);
}

function changeQty(id, delta) {
  const item = state.cart.find((x) => x.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter((x) => x !== item);
  if (item.qty > 20) item.qty = 20;
  saveCart();
}

function openCart() {
  closeModals();
  $("#overlay").classList.add("show");
  $("#cartDrawer").classList.add("open");
  document.body.classList.add("lock");
}

function openCheckout() {
  if (!cartLines().length) { toast("Аввал ба сабад хӯрок илова кунед."); return; }
  state.promo = null;
  $("#promoInput").value = "";
  $("#promoInfo").hidden = true;
  setErr($("#checkoutError"), "");
  updateCheckoutTotal();
  $("#cartDrawer").classList.remove("open");
  $("#checkoutModal").classList.add("show");
  showOverlay();
}

function updateCheckoutTotal() {
  const sub = cartSubtotal();
  const d = state.promo ? state.promo.discount : 0;
  const box = $("#checkoutTotal");
  box.textContent = "";
  box.append(`Ҷамъ: ${sub} с.`);
  if (d) {
    const span = document.createElement("span");
    span.className = "disc";
    span.textContent = ` −${d} с. 🎟 ${state.promo.promo}`;
    box.append(span);
  }
  const b = document.createElement("b");
  b.textContent = `Ҳамагӣ: ${sub - d} с.`;
  box.append(document.createElement("br"), b);
}

function setErr(el, msg) {
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || "";
}

/* ---------- Фармоиш ---------- */
function rememberOrder(order) {
  if (!order || !order.accessToken) return;
  state.orders = [{ id: order.id, token: order.accessToken, total: order.total, createdAt: order.createdAt || new Date().toISOString() },
    ...state.orders.filter((o) => o.id !== order.id)].slice(0, 20);
  saveOrders();
}

async function submitCheckout(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = $("#checkoutSubmit");
  const f = new FormData(form);
  const method = f.get("method") === "cash" ? "cash" : "online";
  setErr($("#checkoutError"), "");
  btn.disabled = true;
  try {
    const order = await api("/orders", {
      method: "POST",
      body: {
        customerName: String(f.get("name") || ""),
        phone: String(f.get("phone") || ""),
        address: String(f.get("address") || ""),
        method: "delivery",
        paymentMethod: method,
        paymentProvider: method === "online" ? "manual" : null,
        items: cartLines().map((x) => ({ foodId: x.id, quantity: x.qty })),
        promo: state.promo ? state.promo.promo : null,
      },
    });
    // Фақат пас аз тасдиқи сервер: фармоиш сабт шуд
    rememberOrder(order);
    state.cart = [];
    state.promo = null;
    saveCart();
    form.reset();
    $("#checkoutModal").classList.remove("show");
    if (method === "online") {
      showPaymentSheet(order);
    } else {
      closeAll();
      toast(`Фармоиши #${order.id} қабул шуд ✓ (пардохт ҳангоми расонидан)`);
    }
  } catch (err) {
    setErr($("#checkoutError"), err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Пардохт (равзанаи пардохт) ---------- */
let payCtx = null;

function copyText(txt) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
  return Promise.reject(new Error("clipboard"));
}

function safeHttpLink(u) {
  return /^https:\/\/[^\s"'<>]+$/i.test(String(u || "")) ? String(u) : "";
}

function payWithBank(which) {
  if (!payCtx) return;
  const info = payCtx.info;
  const isAlif = which === "alif";
  const wallet = isAlif ? info.alifWallet : info.dcWallet;
  const link = safeHttpLink(isAlif ? info.alifLink : info.dcLink);
  const name = isAlif ? "Алиф" : "Душанбе Сити";
  const txt = `Хамён: ${wallet}\nСумма: ${payCtx.total} с.\nКод: ${payCtx.code}`;
  copyText(txt)
    .then(() => {
      if (link) {
        toast(`Нусха шуд! ${name} кушода мешавад...`);
        setTimeout(() => window.open(link, "_blank", "noopener"), 500);
      } else {
        toast(`Нусха шуд ✓ ${name} app → ҳамён ${wallet} → ${payCtx.total} с.`);
      }
    })
    .catch(() => { window.prompt(`Дар ${name} app пардохт кунед:`, txt); });
}

function showPaymentSheet(order) {
  const info = order.paymentInstructions || {};
  payCtx = {
    id: order.orderId || order.id,
    token: order.token || order.accessToken || tokenFor(order.orderId || order.id),
    total: order.total,
    code: info.comment || order.paymentCode || "—",
    info,
  };
  setErr($("#payError"), "");
  setText("#payOrderId", `#${payCtx.id}`);
  setText("#payAmount", `${order.total} с.`);
  setText("#payDC", info.dushanbeCity || "—");
  setText("#payAlif", info.alif || "—");
  setText("#payCode", payCtx.code);
  const qr = $("#payQR");
  const qrSrc = typeof info.qr === "string" && /^data:image\/png;base64,/.test(info.qr) ? info.qr : "";
  if (qrSrc) { qr.src = qrSrc; qr.parentElement.style.display = "block"; }
  else { qr.removeAttribute("src"); qr.parentElement.style.display = "none"; }
  const tg = safeTelegramLink(order.telegramLink);
  const tgEl = $("#payTgLink");
  tgEl.hidden = !tg;
  if (tg) tgEl.href = tg;
  $("#paySheet").classList.add("show");
  showOverlay();
  document.body.classList.add("lock");
}

function tokenFor(id) {
  const rec = state.orders.find((o) => o.id === Number(id));
  return rec ? rec.token : "";
}

function safeTelegramLink(u) {
  return /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]+$/.test(String(u || "")) ? String(u) : "";
}

async function confirmPaymentSubmitted() {
  if (!payCtx) return;
  const btn = $("#payDoneBtn");
  btn.disabled = true;
  setErr($("#payError"), "");
  try {
    // Пас аз ҷавоби мусбати сервер танҳо паём нишон дода мешавад
    await api(`/orders/${payCtx.id}/payment-submitted`, { method: "POST", token: payCtx.token });
    $("#paySheet").classList.remove("show");
    closeAll();
    toast("Пардохт барои санҷиши админ фиристода шуд ✓");
  } catch (err) {
    setErr($("#payError"), err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Фармоишҳои ман (бо токен, бе телефон) ---------- */
const STATUS_TEXT = {
  AWAITING_PAYMENT: "Интизори пардохт",
  PAYMENT_REVIEW: "Пардохт санҷида мешавад",
  PAYMENT_REJECTED: "Пардохт рад шуд",
  NEW: "Қабул шуд",
  CONFIRMED: "Пардохт тасдиқ шуд",
  COOKING: "Дар ошхона",
  DELIVERING: "Дар роҳ",
  DONE: "Анҷом ✓",
  CANCELLED: "Бекор шуд",
};

function openMyOrders() {
  closeAll();
  $("#myOrdersModal").classList.add("show");
  showOverlay();
  renderMyOrders();
}

async function renderMyOrders() {
  const box = $("#moList");
  if (!state.orders.length) {
    box.innerHTML = '<div class="empty">Дар ин дастгоҳ фармоиш нест.</div>';
    return;
  }
  box.innerHTML = '<div class="empty">Боргирӣ…</div>';
  const results = await Promise.all(
    state.orders.map(async (rec) => {
      try {
        return { rec, order: await api(`/orders/${rec.id}`, { token: rec.token }) };
      } catch (err) {
        return { rec, error: err };
      }
    })
  );
  // Фармоишҳое, ки токенашон нодуруст аст, аз дастгоҳ хориҷ мешаванд
  const gone = results.filter((r) => r.error && r.error.status === 404).map((r) => r.rec.id);
  if (gone.length) {
    state.orders = state.orders.filter((o) => !gone.includes(o.id));
    saveOrders();
  }
  box.innerHTML = results
    .filter((r) => !gone.includes(r.rec.id))
    .map(({ rec, order, error }) => {
      if (error) return `<div class="mo-card"><div class="mo-head"><b>#${esc(rec.id)}</b></div><small>${esc(error.message)}</small></div>`;
      const items = (order.items || []).map((i) => `${esc(i.name)} × ${esc(i.quantity)}`).join(", ");
      const pay = order.status === "AWAITING_PAYMENT" && order.paymentMethod === "online"
        ? `<button type="button" data-order-pay="${esc(order.id)}">Пардохт кардан</button>` : "";
      const reject = order.status === "PAYMENT_REJECTED" && order.rejectReason
        ? `<small class="mo-reject">Сабаб: ${esc(order.rejectReason)}</small>` : "";
      return `<div class="mo-card">
        <div class="mo-head"><b>#${esc(order.id)}</b><span class="mo-status">${esc(STATUS_TEXT[order.status] || order.status)}</span></div>
        <small>${items}</small>${reject}
        <div class="mo-foot"><b>${esc(order.total)} с.</b>${pay}</div>
      </div>`;
    })
    .join("");
}

async function payOldOrder(id) {
  const token = tokenFor(id);
  if (!token) { toast("Фармоиш ёфт нашуд."); return; }
  try {
    const info = await api(`/orders/${id}/pay-info`, { token });
    $("#myOrdersModal").classList.remove("show");
    showPaymentSheet({ orderId: info.orderId, total: info.total, paymentInstructions: info.paymentInstructions, token });
  } catch (err) {
    toast(`Хатогӣ: ${err.message}`);
  }
}

/* ---------- Бронкунии миз ---------- */
async function submitReservation(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("/reservations", { method: "POST", body: data });
    form.reset();
    toast("Миз барои шумо банд карда шуд! ✓");
  } catch (err) {
    // Маълумот нигоҳ дошта мешавад; муваффақият гуфта намешавад
    toast(`Бронкунӣ анҷом наёфт: ${err.message}`);
  }
}

/* ---------- Ҷустуҷӯ ---------- */
function openSearch() {
  $("#searchScreen").classList.add("show");
  document.body.classList.add("lock");
  $("#searchInput").value = "";
  renderSearch();
  setTimeout(() => $("#searchInput").focus(), 100);
}
function closeSearch() {
  $("#searchScreen").classList.remove("show");
  if (!$(".modal.show")) document.body.classList.remove("lock");
}
function renderSearch() {
  const q = ($("#searchInput").value || "").toLowerCase().trim();
  const list = q
    ? state.foods.filter((f) => `${f.name} ${f.description} ${f.category}`.toLowerCase().includes(q))
    : state.foods;
  $("#searchResults").innerHTML = list.length
    ? list.map((f) => {
        const img = safeImageUrl(f.image);
        return `<div class="sr-row">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" data-hide-on-error>` : ""}
          <div><h4>${esc(f.name)}</h4><small>${esc(f.category)} · ${esc(f.price)} с.</small></div>
          <button type="button" data-add="${esc(f.id)}">+</button></div>`;
      }).join("")
    : '<div class="empty">Ҳеҷ чиз ёфт нашуд.</div>';
}

/* ---------- AI (тавсия) ---------- */
const PREFS_KEY = "oshonaPrefs";

function readPrefsForm() {
  const budgetRaw = $("#prefBudget").value.trim();
  const split = (s) => s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
  return {
    budget: budgetRaw ? Number(budgetRaw) : null,
    tastes: split($("#prefTastes").value).slice(0, 8),
    avoid: split($("#prefAvoid").value),
    minor: $("#prefMinor").checked,
  };
}

function loadPrefsForm() {
  const p = store(PREFS_KEY, {});
  $("#prefBudget").value = p.budget || "";
  $("#prefTastes").value = (p.tastes || []).join(", ");
  $("#prefAvoid").value = (p.avoid || []).join(", ");
  $("#prefMinor").checked = Boolean(p.minor);
}

function openAi() {
  closeAll();
  $("#aiScreen").classList.add("show");
  document.body.classList.add("lock");
  loadPrefsForm();
  if (!state.chat.length) {
    appendBot({
      reply: state.aiEnabled
        ? "Салом! Ман OSHONA AI ҳастам. Мегӯед, чӣ мехоҳед: буҷет, таъм ё истисноҳо. Тавсияҳо аз меню ва таркиби ҳақиқии ошхона аст."
        : "Салом! Ман тавсияи меню медиҳам. AI ҳозир фаъол нест, аммо тавсияҳо аз рӯи буҷет ва таъми шумо тартиб дода мешаванд.",
      recommendations: [],
      notes: [],
    });
  }
  setTimeout(() => $("#aiInput").focus(), 150);
}
function closeAi() {
  $("#aiScreen").classList.remove("show");
  if (!$(".modal.show")) document.body.classList.remove("lock");
}

function appendUser(text) {
  const log = $("#aiLog");
  const div = document.createElement("div");
  div.className = "ai-msg ai-user";
  div.textContent = text;
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function appendBot(res) {
  const log = $("#aiLog");
  const div = document.createElement("div");
  div.className = "ai-msg ai-bot";
  const p = document.createElement("p");
  p.textContent = res.reply || "";
  div.append(p);
  if (res.source) {
    const src = document.createElement("small");
    src.className = "ai-source";
    src.textContent = res.source === "ai" ? "OSHONA AI" : "Тавсияи қоидавӣ (AI ҳоло дастнорас)";
    div.append(src);
  }
  if (res.notice) {
    const n = document.createElement("small");
    n.className = "ai-notice";
    n.textContent = res.notice;
    div.append(n);
  }
  (res.notes || []).forEach((t) => {
    const n = document.createElement("small");
    n.className = "ai-notes";
    n.textContent = t;
    div.append(n);
  });
  (res.recommendations || []).forEach((r) => {
    const card = document.createElement("div");
    card.className = "ai-card";
    const h = document.createElement("h4");
    h.textContent = `${r.name} — ${r.price} с.`;
    card.append(h);
    if (r.reason) {
      const rs = document.createElement("small");
      rs.textContent = r.reason;
      card.append(rs);
    }
    const n = r.nutrition;
    const nl = document.createElement("small");
    nl.className = "ai-nutri";
    nl.textContent = n && n.calories !== null && n.calories !== undefined
      ? `${n.calories} ккал · сафеда ${n.protein} г · равған ${n.fat} г · карбо ${n.carbs} г (${CONF[n.confidence] || "эътимод"})`
      : "Калория: маълумот нест";
    card.append(nl);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add";
    btn.dataset.add = String(r.foodId);
    btn.textContent = "+ Ба сабад";
    card.append(btn);
    div.append(card);
  });
  if (res.disclaimer) {
    const d = document.createElement("small");
    d.className = "ai-disclaimer";
    d.textContent = res.disclaimer;
    div.append(d);
  }
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function sendAi(text) {
  const message = text.trim();
  if (!message) return;
  const prefs = readPrefsForm();
  save(PREFS_KEY, prefs);
  appendUser(message);
  state.chat.push({ role: "user", content: message });
  const pending = document.createElement("div");
  pending.className = "ai-msg ai-bot ai-pending";
  pending.textContent = "…";
  $("#aiLog").append(pending);
  $("#aiSend").disabled = true;
  try {
    const history = state.chat.slice(-7, -1).map((m) => ({ role: m.role, content: m.content }));
    const res = await api("/ai/chat", { method: "POST", body: { message, history, preferences: prefs } });
    pending.remove();
    appendBot(res);
    state.chat.push({ role: "assistant", content: res.reply || "" });
  } catch (err) {
    pending.textContent = `Хатогӣ: ${err.message}`;
    pending.classList.add("ai-error");
  } finally {
    $("#aiSend").disabled = false;
  }
}

/* ---------- Умумӣ: модал, overlay, toast, таб ---------- */
function showOverlay() { $("#overlay").classList.add("show"); }
function closeModals() {
  $$("#foodModal, .small-modal, #aiScreen, #searchScreen").forEach((x) => x.classList.remove("show"));
  $("#cartDrawer").classList.remove("open");
}
function closeAll() {
  closeModals();
  $("#overlay").classList.remove("show");
  document.body.classList.remove("lock");
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = String(msg);
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2800);
}

function observeReveals() {
  const obs = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); }), { threshold: 0.12 });
  $$(".reveal:not(.visible)").forEach((x) => obs.observe(x));
}

function switchMainTab(name) {
  $$("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  closeAll();
  if (name === "home") window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "menu") $("#menu").scrollIntoView({ behavior: "smooth" });
  if (name === "search") openSearch();
  if (name === "cart") openCart();
  if (name === "orders") openMyOrders();
}

/* ---------- Рӯйдодҳо (делегатсия, бе onclick) ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  const addBtn = t.closest("[data-add]");
  if (addBtn) { e.stopPropagation(); addToCart(Number(addBtn.dataset.add)); return; }
  const plus = t.closest("[data-plus]");
  if (plus) { changeQty(Number(plus.dataset.plus), 1); return; }
  const minus = t.closest("[data-minus]");
  if (minus) { changeQty(Number(minus.dataset.minus), -1); return; }
  const cat = t.closest("[data-cat]");
  if (cat && cat.closest("#filters")) {
    $$("#filters .filter").forEach((x) => x.classList.toggle("active", x === cat));
    renderFoods(cat.dataset.cat);
    return;
  }
  const open = t.closest("[data-open]");
  if (open && !t.closest("button")) { openFood(Number(open.dataset.open)); return; }
  const pay = t.closest("[data-order-pay]");
  if (pay) { payOldOrder(Number(pay.dataset.orderPay)); return; }
  const copy = t.closest("[data-copy]");
  if (copy) {
    const txt = $("#" + copy.dataset.copy).textContent;
    copyText(txt).then(() => toast("Нусхабардорӣ шуд ✓")).catch(() => window.prompt("Нусхабардорӣ кунед:", txt));
    return;
  }
  if (t.closest("[data-retry-menu]")) { state.menuError = ""; loadMenu(); return; }
  if (t.closest("[data-close]")) { closeAll(); return; }
  if (t.id === "cartBtn") { openCart(); return; }
  if (t.id === "checkoutBtn") { openCheckout(); return; }
  if (t.id === "heroReserve") { $("#reservation").scrollIntoView({ behavior: "smooth" }); return; }
  if (t.id === "aiBtn" || t.id === "aiEntryBtn") { openAi(); return; }
});

document.addEventListener("error", (e) => {
  if (e.target && e.target.matches && e.target.matches("img[data-hide-on-error]")) e.target.style.display = "none";
}, true);

/* ---------- Формаҳо ва тугмаҳо ---------- */
$("#overlay").addEventListener("click", closeAll);
$("#checkoutForm").addEventListener("submit", submitCheckout);
$("#reservationForm").addEventListener("submit", submitReservation);
$("#searchBtn").addEventListener("click", openSearch);
$("#searchClose").addEventListener("click", closeSearch);
$("#searchInput").addEventListener("input", renderSearch);
$("#aiClose").addEventListener("click", closeAi);
$("#menuToggle").addEventListener("click", () => $("#nav").classList.toggle("open"));
$("#allMenuBtn").addEventListener("click", () => { renderFoods("Ҳама"); renderFilters(); $("#menu").scrollIntoView({ behavior: "smooth" }); });
$("#payDoneBtn").addEventListener("click", confirmPaymentSubmitted);
$("#payAlifBtn").addEventListener("click", () => payWithBank("alif"));
$("#payDCBtn").addEventListener("click", () => payWithBank("dc"));
$("#payCancelBtn").addEventListener("click", () => {
  closeAll();
  toast("Фармоиш сабт шуд. Баъдтар пардохт карда метавонед.");
});
$("#promoApply").addEventListener("click", async () => {
  const code = $("#promoInput").value.trim();
  const info = $("#promoInfo");
  if (!code) { state.promo = null; info.hidden = true; updateCheckoutTotal(); return; }
  try {
    const r = await api("/promos/validate", { method: "POST", body: { code, total: cartSubtotal() } });
    state.promo = r;
    info.hidden = false;
    info.textContent = `🎟 ${r.promo}: −${r.discount} с.`;
    updateCheckoutTotal();
    toast("Промокод татбиқ шуд ✓");
  } catch (err) {
    state.promo = null;
    info.hidden = true;
    updateCheckoutTotal();
    toast(`Хатогӣ: ${err.message}`);
  }
});
$("#aiForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#aiInput");
  const text = input.value;
  input.value = "";
  sendAi(text);
});
$$("#tabbar button").forEach((b) => b.addEventListener("click", () => switchMainTab(b.dataset.tab)));

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* SW ихтиёрӣ аст */ });
  });
}
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!store("oshonaInstallHide", false)) $("#installBanner").hidden = false;
});
$("#installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) { toast("Дар Chrome: меню ⋮ → «Насб кардани барнома»"); return; }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#installBanner").hidden = true;
});
$("#installClose").addEventListener("click", () => {
  $("#installBanner").hidden = true;
  save("oshonaInstallHide", true);
});

/* ---------- Оғози барнома ---------- */
observeReveals();
renderCart();
renderMyOrdersBadge();
loadConfig();
loadMenu();

function renderMyOrdersBadge() {
  // Танҳо барои дастрасии осон: шумораи фармоишҳои дастгоҳ
  const btn = $('#tabbar button[data-tab="orders"]');
  if (btn && state.orders.length) btn.setAttribute("aria-label", `Фармоишҳо (${state.orders.length})`);
}
