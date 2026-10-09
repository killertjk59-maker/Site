/* OSHONA — панели админ.
 * Қоидаҳо: ҳамаи матни сервер бо esc() нишон дода мешавад; ягон onclick/inline нест (CSP);
 * тасдиқ/рад ва тағйири ҳолат танҳо пас аз ҷавоби мусбати сервер нишон медиҳад;
 * AI ҳеҷ гоҳ пардохтро тасдиқ намекунад — ин амал танҳо ба админ тааллуқ дорад.
 */
"use strict";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/[&<>"'`]/g, (c) => ESC_MAP[c]);
const TOKEN_KEY = "oshonaAdminToken";
let token = localStorage.getItem(TOKEN_KEY) || "";
let currentTab = "orders";
let lastStats = null;

const ORDER_STATUS_TEXT = {
  AWAITING_PAYMENT: "Интизори пардохт",
  PAYMENT_REVIEW: "Пардохт санҷида мешавад",
  PAYMENT_REJECTED: "Пардохт рад шуд",
  NEW: "Нав",
  CONFIRMED: "Пардохт тасдиқ",
  COOKING: "Дар ошхона",
  DELIVERING: "Дар роҳ",
  DONE: "Анҷом",
  CANCELLED: "Бекор",
};
const PAY_TEXT = {
  AWAITING_PAYMENT: "интизори пардохт",
  IN_REVIEW: "санҷиш",
  PAID: "пардохт шуд",
  REJECTED: "рад шуд",
  CASH_ON_DELIVERY: "нақд ҳангоми расонидан",
  CASH_COLLECTED: "нақд гирифта шуд",
  REFUND_DUE: "бояд баргардонда шавад",
};
const RES_TEXT = { NEW: "Нав", CONFIRMED: "Тасдиқ", CANCELLED: "Бекор" };
const CONF_TEXT = { high: "баланд", medium: "миёна", low: "паст" };
const WEEKDAYS = ["Якшанбе", "Душанбе", "Сешанбе", "Чоршанбе", "Панҷшанбе", "Ҷумъа", "Шанбе"];
const ALLERGENS = [
  ["gluten", "Глютен"], ["crustaceans", "Харчанг/майгу"], ["eggs", "Тухм"], ["fish", "Моҳӣ"],
  ["peanuts", "Зардчӯба"], ["soy", "Соя"], ["milk", "Шир"], ["nuts", "Меваҳои пӯстдор"],
  ["celery", "Карафс"], ["mustard", "Хардал"], ["sesame", "Кунҷид"], ["sulphites", "Сулфитҳо"],
  ["lupin", "Лупин"], ["molluscs", "Моллюскҳо"],
];
const fmt = (n) => (n === null || n === undefined ? "—" : String(n));
const money = (n) => `${fmt(n)} с.`;

/* ---------- API ---------- */
async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch("/api" + path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new Error("Пайвасти шабака нест.");
  }
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* матни оддӣ */ }
  if (res.status === 401 && path !== "/auth/login") {
    logout("Сессия ба охир расид. Дубора ворид шавед.");
    throw new Error("Сессия ба охир расид.");
  }
  if (!res.ok) throw new Error(data.error || `Хатогӣ (${res.status})`);
  return data;
}

function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = String(msg);
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = "toast"; }, 3200);
}

/* ---------- Воридшавӣ ---------- */
function logout(message) {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  $("#app").hidden = true;
  $("#loginCard").hidden = false;
  $("#logoutBtn").hidden = true;
  if (message) {
    $("#loginErr").hidden = false;
    $("#loginErr").textContent = message;
  }
}

async function login(e) {
  e.preventDefault();
  const user = $("#loginUser").value.trim();
  const pass = $("#loginPass").value;
  $("#loginErr").hidden = true;
  try {
    const r = await api("/auth/login", { method: "POST", body: { username: user, password: pass } });
    token = r.token;
    localStorage.setItem(TOKEN_KEY, token);
    $("#loginPass").value = "";
    showApp();
  } catch (err) {
    $("#loginErr").hidden = false;
    $("#loginErr").textContent = err.message;
  }
}

function showApp() {
  $("#loginCard").hidden = true;
  $("#app").hidden = false;
  $("#logoutBtn").hidden = false;
  loadStats();
  switchTab(currentTab);
}

/* ---------- Оморҳо ---------- */
async function loadStats() {
  try {
    const s = await api("/admin/stats");
    lastStats = s;
    const ai = s.ai || {};
    $("#stats").innerHTML = [
      statCard(s.orders, "Фармоишҳо", `нав: ${fmt(s.newOrders)}`),
      statCard(money(s.collectedNet), "Даромади воқеӣ", "онлайн тасдиқшуда + нақди гирифташуда"),
      statCard(money(s.pendingOnline), "Интизори онлайн", "пардохт/санҷиш"),
      statCard(money(s.pendingCash), "Интизори нақд", "ҳангоми расонидан"),
      statCard(s.foods, "Таомҳо", `бронкунӣ: ${fmt(s.reservations)}`),
      statCard(`${fmt(ai.requestsToday)}/${fmt(ai.dailyRequestLimit)}`, "AI имрӯз", "дархост / ҳад"),
    ].join("");
    const demo = await api("/admin/foods").catch(() => []);
    $("#demoBanner").hidden = !demo.some((f) => f.demo);
  } catch (err) {
    toast(err.message, true);
  }
}

function statCard(value, label, note) {
  return `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
}

function switchTab(name) {
  currentTab = name;
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  const titles = {
    orders: "Фармоишҳо", reserv: "Бронкунии миз", menu: "Меню", promo: "Промокодҳо", report: "Ҳисоботи даромад", forecast: "Пешгӯии талабот",
  };
  $("#tabTitle").textContent = titles[name] || "";
  refresh();
}

function refresh() {
  if (!token) return;
  loadStats();
  const map = { orders: renderOrders, reserv: renderReservations, menu: renderMenu, promo: renderPromos, report: renderReport, forecast: renderForecast };
  (map[currentTab] || renderOrders)();
}

/* ---------- Фармоишҳо ---------- */
function orderCard(o) {
  const items = (o.items || []).map((i) => `<li>${esc(i.name)} × ${esc(i.quantity)} = ${esc(i.price * i.quantity)} с.</li>`).join("");
  const actions = [];
  if ((o.reviewActions || []).includes("approve")) {
    actions.push(`<button class="btn btn-ok" type="button" data-action="approve" data-id="${esc(o.id)}">✓ Пардохтро тасдиқ</button>`);
  }
  if ((o.reviewActions || []).includes("reject")) {
    actions.push(`<button class="btn btn-no" type="button" data-action="reject" data-id="${esc(o.id)}">✕ Рад кардан</button>`);
  }
  const allowed = o.allowedStatuses || [];
  if (allowed.length) {
    const opts = allowed.map((s) => `<option value="${esc(s)}">${esc(ORDER_STATUS_TEXT[s] || s)}</option>`).join("");
    actions.push(`<select class="sel statusSel" data-status-select="${esc(o.id)}" aria-label="Ҳолати нав">${opts}</select>`);
    actions.push(`<button class="btn btn-gold" type="button" data-action="setstatus" data-id="${esc(o.id)}">Тағйир додан</button>`);
  }
  const events = (o.events || []).slice(-12).map((e) => {
    const extra = e.details ? ` (${esc(e.details.from || "")} → ${esc(e.details.to || e.details.reason || "")})` : "";
    return `<li>${esc(new Date(e.at).toLocaleString("ru-RU"))} — ${esc(e.action)} — ${esc(e.by)}${extra}</li>`;
  }).join("");
  const reject = o.rejectReason ? `<div class="meta">Сабаби рад: <b>${esc(o.rejectReason)}</b></div>` : "";
  return `
  <div class="card ${o.paymentStatus === "IN_REVIEW" ? "review" : ""}">
    <div class="card-head">
      <b>#${esc(o.id)} · ${esc(o.customerName)}</b>
      <span><span class="badge st-${esc(o.status)}">${esc(ORDER_STATUS_TEXT[o.status] || o.status)}</span>
      <span class="badge pay-${esc(o.paymentStatus)}">${esc(PAY_TEXT[o.paymentStatus] || o.paymentStatus)}</span></span>
    </div>
    <div class="meta">
      Телефон: <b>${esc(o.phone)}</b> · ${esc(o.method === "pickup" ? "Худ мегирад" : "Расонидан")}<br>
      Суроға: ${esc(o.address || "—")}<br>
      Пардохт: ${esc(o.paymentMethod === "online" ? "онлайн (ҳамён)" : "нақд")} · Код: <code>${esc(o.paymentCode)}</code><br>
      Ҷамъ: ${esc(o.subtotal)} с.${o.discount ? ` − тахфиф ${esc(o.discount)} с. (${esc(o.promo || "")})` : ""} · <b>Ҳамагӣ: ${esc(o.total)} ${esc(o.currency || "")}</b><br>
      Сана: ${esc(new Date(o.createdAt).toLocaleString("ru-RU"))}
    </div>
    <ul class="items">${items}</ul>
    ${reject}
    <div class="actions">${actions.join("")}</div>
    <details class="events"><summary>Таърихи амалиёт (${esc((o.events || []).length)})</summary><ul>${events}</ul></details>
  </div>`;
}

async function renderOrders() {
  const box = $("#content");
  box.innerHTML = '<div class="empty">Боргирӣ…</div>';
  try {
    const list = await api("/orders");
    if (!list.length) { box.innerHTML = '<div class="empty">Фармоиш нест.</div>'; return; }
    const rank = (o) => (o.paymentStatus === "IN_REVIEW" ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b) || b.id - a.id);
    box.innerHTML = list.map(orderCard).join("");
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/* ---------- Бронкунӣ ---------- */
async function renderReservations() {
  const box = $("#content");
  box.innerHTML = '<div class="empty">Боргирӣ…</div>';
  try {
    const list = await api("/reservations");
    if (!list.length) { box.innerHTML = '<div class="empty">Бронкунӣ нест.</div>'; return; }
    box.innerHTML = list.map((r) => `
      <div class="card">
        <div class="card-head"><b>${esc(r.name)}</b><span class="badge st-${esc(r.status === "NEW" ? "NEW" : r.status === "CONFIRMED" ? "CONFIRMED" : "CANCELLED")}">${esc(RES_TEXT[r.status] || r.status)}</span></div>
        <div class="meta">Телефон: <b>${esc(r.phone)}</b> · Сана: <b>${esc(r.date)}</b> · Вақт: <b>${esc(r.time)}</b> · ${esc(r.guests)}</div>
        <div class="actions">
          <select class="sel" data-res-select="${esc(r.id)}" aria-label="Статус">
            ${["NEW", "CONFIRMED", "CANCELLED"].map((s) => `<option value="${s}" ${s === r.status ? "selected" : ""}>${esc(RES_TEXT[s])}</option>`).join("")}
          </select>
          <button class="btn btn-gold" type="button" data-action="res-status" data-id="${esc(r.id)}">Сабт</button>
        </div>
      </div>`).join("");
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/* ---------- Меню ---------- */
function nutritionBlock(f) {
  const n = f.nutrition || {};
  const conf = n.confidence ? `<span class="conf-${esc(n.confidence)}">эътимод: ${esc(CONF_TEXT[n.confidence] || n.confidence)}</span>` : "";
  const warnings = (n.warnings || []).map((w) => ({
    no_recipe: "таркиб ворид нашудааст",
    missing_ingredient_data: "баъзе ингредиентҳо дар маълумотнома нестанд",
    weight_mismatch: "вазни порсия ба ҷамъи таркиб мувофиқ нест",
  }[w] || w));
  const missing = (f.nutrition && f.nutrition.missingIngredients) || [];
  const values = n.status === "computed"
    ? `${esc(n.calories)} ккал · сафеда ${esc(n.protein)} · равған ${esc(n.fat)} · карбо ${esc(n.carbs)} г`
    : "Ҳисоб нашудааст (маълумот нест)";
  return `<div class="nut">Ғизо: ${values} ${conf}<br>Манбаъ: ${esc(n.source || f.nutritionSourceDeclared || "—")}</div>
    ${missing.length ? `<div class="warnlist">Камбуд: ${esc(missing.join(", "))}</div>` : ""}
    ${warnings.length ? `<div class="warnlist">${esc(warnings.join("; "))}</div>` : ""}`;
}

function foodForm(f, { mode }) {
  const isEdit = mode === "edit";
  const allergenSet = new Set(f ? (f.allergens || []).map((a) => a.key) : []);
  const ingr = f ? (f.ingredients || []).map((i) => `${i.name} | ${i.grams}`).join("\n") : "";
  const idAttr = isEdit ? `data-food-form="${esc(f.id)}"` : 'id="foodForm"';
  return `
  <form class="form-box" ${idAttr} ${isEdit ? "" : ""}>
    <h3>${isEdit ? `Таҳрири «${esc(f.name)}»` : "Таоми нав"}</h3>
    <div class="row">
      <label>Ном*<input name="name" required maxlength="120" value="${esc(f ? f.name : "")}"></label>
      <label>Категория<input name="category" maxlength="40" value="${esc(f ? f.category : "Асосӣ")}"></label>
    </div>
    <div class="row">
      <label>Нарх (с.)*<input name="price" type="number" step="0.01" min="0.01" required value="${esc(f ? f.price : "")}"></label>
      <label>Вазни порсия (г)<input name="weightG" type="number" step="1" min="1" max="5000" value="${esc(f && f.weightG ? f.weightG : "")}"></label>
    </div>
    <label>Тавсиф<textarea name="description" maxlength="500">${esc(f ? f.description : "")}</textarea></label>
    <label>Таркиб: ҳар сатр «ном | грамм» (масалан: Паста (пухта) | 200)
      <textarea name="ingredients" placeholder="Паста (пухта) | 200&#10;Пармезан | 20">${esc(ingr)}</textarea></label>
    <div class="explain">Калория ва макроҳо танҳо аз таркиб ҳисоб мешаванд. Ингредиентҳои номаълум — ҳисоб намешавад.</div>
    <label>Аллергенҳо</label>
    <div class="checks">${ALLERGENS.map(([k, label]) => `<label><input type="checkbox" name="allergens" value="${k}" ${allergenSet.has(k) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div>
    <div class="row">
      <label>Тегҳо (вергул)<input name="tags" maxlength="300" value="${esc(f ? (f.tags || []).join(", ") : "")}"></label>
      <label>Дараҷаи эътимоди ғизо
        <select name="nutritionConfidence">
          <option value="">— (ҳисоб аз маълумотнома)</option>
          ${["high", "medium", "low"].map((c) => `<option value="${c}" ${f && f.nutritionConfidenceDeclared === c ? "selected" : ""}>${esc(CONF_TEXT[c])}</option>`).join("")}
        </select></label>
    </div>
    <label>Манбаи маълумоти ғизоӣ (масалан: «ҳисоби ошпаз, рецепти 2026»)<input name="nutritionSource" maxlength="200" value="${esc(f ? f.nutritionSourceDeclared || "" : "")}"></label>
    <div class="explain">Расм (JPG/PNG/WebP, то 5 MB):</div>
    <label class="file-label">📷 Интихоби расм<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" data-upload></label>
    <input type="hidden" name="image" value="${esc(f ? f.image : "")}">
    ${f && f.image ? `<img class="preview" src="${esc(f.image)}" alt="">` : ""}
    <label class="checks"><input type="checkbox" name="available" ${!f || f.available ? "checked" : ""}> Фаъол (дар сайт нишон дода шавад)</label>
    <div class="actions"><button class="btn btn-gold" type="submit">${isEdit ? "Захира" : "Илова кардан"}</button>${isEdit ? `<button class="btn btn-ghost" type="button" data-action="food-cancel" data-id="${esc(f.id)}">Бекор</button>` : ""}</div>
  </form>`;
}

async function renderMenu() {
  const box = $("#content");
  box.innerHTML = '<div class="empty">Боргирӣ…</div>';
  try {
    const foods = await api("/admin/foods");
    const list = foods.map((f) => `
      <div class="card ${f.available ? "" : "off"}" data-food-card="${esc(f.id)}">
        <div class="food-row">
          ${f.image ? `<img src="${esc(f.image)}" alt="">` : "<div></div>"}
          <div>
            <h4>${esc(f.name)} ${f.demo ? '<span class="badge st-PAYMENT_REVIEW">демо</span>' : ""} ${f.available ? "" : '<span class="badge st-CANCELLED">нофаъол</span>'}</h4>
            <div class="meta">${esc(f.category)} · <b>${esc(f.price)} с.</b>${f.weightG ? ` · порсия ${esc(f.weightG)} г` : ""}</div>
            ${nutritionBlock(f)}
            ${(f.allergens || []).length ? `<div class="nut">Аллергенҳо: ${esc(f.allergens.map((a) => a.label).join(", "))}</div>` : ""}
          </div>
          <div class="actions" style="flex-direction:column;align-items:stretch">
            <button class="btn btn-ghost" type="button" data-action="food-edit" data-id="${esc(f.id)}">✎ Таҳрир</button>
            <button class="btn btn-ghost" type="button" data-action="food-toggle" data-id="${esc(f.id)}">${f.available ? "Нофаъол кардан" : "Фаъол кардан"}</button>
            <button class="btn btn-no" type="button" data-action="food-del" data-id="${esc(f.id)}">Нест кардан</button>
          </div>
        </div>
        <div class="edit-slot" data-edit-slot="${esc(f.id)}"></div>
      </div>`).join("");
    box.innerHTML = foodForm(null, { mode: "create" }) + (list || '<div class="empty">Таом нест.</div>');
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/** Хонда ва санҷиши формаи таом → объекти API */
function readFoodForm(form) {
  const fd = new FormData(form);
  const lines = String(fd.get("ingredients") || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ingredients = lines.map((line, i) => {
    const [name, grams] = line.split("|").map((x) => (x || "").trim());
    if (!name || !grams) throw new Error(`Таркиб, сатри ${i + 1}: формат «ном | грамм» лозим аст.`);
    return { name, grams: Number(grams.replace(",", ".")) };
  });
  const weight = String(fd.get("weightG") || "").trim();
  const conf = String(fd.get("nutritionConfidence") || "");
  return {
    name: String(fd.get("name") || "").trim(),
    category: String(fd.get("category") || "").trim() || "Асосӣ",
    price: Number(String(fd.get("price") || "").replace(",", ".")),
    description: String(fd.get("description") || "").trim(),
    weightG: weight ? Number(weight) : null,
    ingredients,
    allergens: fd.getAll("allergens"),
    tags: String(fd.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
    nutritionConfidence: conf || null,
    nutritionSource: String(fd.get("nutritionSource") || "").trim() || null,
    image: String(fd.get("image") || ""),
    available: fd.get("available") === "on",
  };
}

/* ---------- Промо ---------- */
async function renderPromos() {
  const box = $("#content");
  box.innerHTML = '<div class="empty">Боргирӣ…</div>';
  try {
    const list = await api("/promos");
    box.innerHTML = `
      <form class="form-box" id="promoForm">
        <h3>Промокоди нав</h3>
        <div class="row">
          <label>Код (A–Z, 0–9, -, _)*<input name="code" required minlength="3" maxlength="32"></label>
          <label>Намуд<select name="type"><option value="percent">Фоиз (%)</option><option value="amount">Маблағ (с.)</option></select></label>
        </div>
        <div class="row">
          <label>Миқдор*<input name="value" type="number" step="0.01" min="0.01" required></label>
          <label>Ҳадди ақали ҷамъ (с.)<input name="minTotal" type="number" step="0.01" min="0" value="0"></label>
        </div>
        <div class="row">
          <label>Мӯҳлат (ихтиёрӣ)<input name="expiresAt" type="date"></label>
          <label>Ҳадди истифода (ихтиёрӣ)<input name="maxUses" type="number" min="1" step="1"></label>
        </div>
        <div class="actions"><button class="btn btn-gold" type="submit">Илова кардан</button></div>
      </form>
      <div class="card">
        ${list.length ? list.map((p) => `
          <div class="promo-row ${p.active ? "" : "off"}">
            <div><b>${esc(p.code)}</b> — ${p.type === "percent" ? `${esc(p.value)}%` : `${esc(p.value)} с.`}
              ${p.minTotal ? ` · ҳадди ақал ${esc(p.minTotal)} с.` : ""}
              ${p.expiresAt ? ` · то ${esc(String(p.expiresAt).slice(0, 10))}` : ""}
              ${p.maxUses ? ` · истифода ${esc(p.uses || 0)}/${esc(p.maxUses)}` : ` · истифода ${esc(p.uses || 0)}`}
              ${p.active ? "" : " · <i>ғайрифаъол</i>"}</div>
            <div class="actions">
              <button class="btn btn-ghost" type="button" data-action="promo-toggle" data-id="${esc(p.code)}">${p.active ? "Хомӯш" : "Фаъол"}</button>
              <button class="btn btn-no" type="button" data-action="promo-del" data-id="${esc(p.code)}">Нест</button>
            </div>
          </div>`).join("") : '<div class="empty">Промокод нест.</div>'}
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/* ---------- Ҳисобот ---------- */
function renderReport() {
  const box = $("#content");
  const s = lastStats;
  if (!s) { box.innerHTML = '<div class="empty">Боргирӣ…</div>'; loadStats().then(renderReport); return; }
  const row = (label, value, explain) => `<tr><th>${esc(label)}<div class="explain">${esc(explain)}</div></th><td><b>${esc(money(value))}</b></td></tr>`;
  box.innerHTML = `
    <p class="banner info">Даромад се хел ҷудо шудааст: фармоишҳо, пардохти тасдиқшуда ва пули воқеан гирифташуда. Фармоишҳои бекоршуда ба даромад дохил намешаванд.</p>
    <div class="card">
      <table class="kv">
        ${row("Фармоишҳо (ҳамаи, шумора)", s.ordersCount ?? s.orders, "Ҳамаи фармоишҳо, аз ҷумла бекоршуда")}
        ${row("Фурӯши иҷрошуда", s.salesCompleted, "Фармоишҳои ба ҳолати «Анҷом» расида")}
        ${row("Пардохти онлайн тасдиқшуда", s.approvedOnline, "Ҳамён санҷида шуд ва админ тасдиқ кард (PAID)")}
        ${row("Нақди воқеан гирифташуда", s.cashCollected, "Ҳангоми расонидан гирифта шуд (CASH_COLLECTED)")}
        ${row("Даромади воқеӣ (онлайн + нақд)", s.collectedNet, "Пули дар ҳақиқат гирифташуда")}
        ${row("Бояд баргардонда шавад", s.refundDue, "Пардохт шуда, аммо фармоиш бекор шуд")}
        ${row("Интизори пардохти онлайн", s.pendingOnline, "Пардохт ё санҷиши он ҳанӯз анҷом наёфтааст")}
        ${row("Интизори нақд", s.pendingCash, "Нақд ҳангоми расонидан гирифта мешавад")}
        ${row("Бекоршуда (маблағи фармоишҳо)", s.cancelled, "Ҳама фармоишҳои бекоршуда")}
      </table>
    </div>
    <p class="explain">Рақамҳо аз база ҳисоб мешаванд. AI ҳеҷ гоҳ пардохтро тасдиқ ё рад намекунад.</p>`;
}

/* ---------- Пешгӯӣ ---------- */
function statusLabelForecast(status) {
  return {
    ok: "Маълумоти кофӣ (ҳам MA-7, ҳам модели дуюм)",
    partial: "Маълумоти қисман: танҳо MA-7 дастрас аст",
    insufficient: "Маълумот нокифоя — пешгӯӣ нишон дода намешавад",
    no_sales: "Фурӯши пардохтшудаи иҷрошуда нест — пешгӯӣ нест",
  }[status] || status;
}

async function renderForecast() {
  const box = $("#content");
  box.innerHTML = '<div class="empty">Ҳисоб…</div>';
  try {
    const f = await api("/admin/forecast");
    const m = (x) => (x === null || x === undefined ? "n/a" : String(x));
    const metricRow = (label, x) => `<tr><th>${esc(label)}</th><td>${esc(m(x && x.mae))}</td><td>${esc(m(x && x.wape))}${x && x.wape !== null && x.wape !== undefined ? "%" : ""}</td><td>${esc(m(x && x.n))}</td></tr>`;
    const models = Object.values(f.models || {}).map((x) => `<li>${esc(x.name)}: ${x.available ? "дастрас" : `нест — ${esc(x.reason || "")}`}</li>`).join("");
    const bt = f.backtest;
    const fc = (f.forecast || []).map((d) => `<tr><td>${esc(d.date)}</td><td>${esc(WEEKDAYS[d.weekday] || "")}</td><td>${esc(m(d.units.ma7))}</td><td>${esc(m(d.units.weekdayMa7))}</td></tr>`).join("");
    const per = (f.perFood || []).map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.totalUnits)}</td><td>${esc(p.dailyMa7)}</td><td>${esc(p.forecastNext7Days)}</td></tr>`).join("");
    box.innerHTML = `
      <p class="banner ${f.dataStatus === "ok" ? "info" : "warn"}">${esc(statusLabelForecast(f.dataStatus))}. Таърих: ${esc(f.history.days)} рӯз (${esc(f.history.firstDay || "—")} — ${esc(f.history.lastDay || "—")}), фурӯши воқеӣ: ${esc(f.history.realSalesCount)} фармоиш.</p>
      <div class="card">
        <div class="section-title">Моделҳо</div>
        <ul class="explain" style="margin-left:18px;line-height:1.7">${models}</ul>
      </div>
      ${bt ? `
      <div class="card">
        <div class="section-title">Арзёбӣ (walk-forward, ${esc(bt.days)} рӯз: ${esc(bt.from)} — ${esc(bt.to)})</div>
        <table class="kv">
          <tr><th>Модел</th><th>MAE (дона)</th><th>WAPE</th><th>Рӯзҳо</th></tr>
          ${metricRow("MA-7", bt.ma7)}
          ${metricRow("MA-7 × омили рӯзи ҳафта", bt.weekdayMa7)}
        </table>
        <div class="explain">MAE = миёнаи |факт − пешгӯӣ|. WAPE = Σ|факт − пешгӯӣ| / Σфакт. ${bt.common ? `Муқоиса дар рӯзҳои умумӣ: MA-7 MAE=${esc(m(bt.common.ma7 && bt.common.ma7.mae))}, модели дуюм MAE=${esc(m(bt.common.weekdayMa7 && bt.common.weekdayMa7.mae))}.` : ""} ${bt.best ? `Беҳтар: ${esc(bt.best === "weekdayMa7" ? "MA-7 × омили рӯзи ҳафта" : "MA-7")}.` : ""} ${esc(bt.note || "")}</div>
      </div>` : ""}
      <div class="card">
        <div class="section-title">Пешгӯӣ барои 7 рӯзи оянда (дона)</div>
        ${fc ? `<table class="kv"><tr><th>Сана</th><th>Рӯз</th><th>MA-7</th><th>Модели дуюм</th></tr>${fc}</table>` : '<div class="empty">Пешгӯӣ нест.</div>'}
      </div>
      <div class="card">
        <div class="section-title">Таомҳо (ма'лумоти 10 беҳтарин)</div>
        ${per ? `<table class="kv"><tr><th>Таом</th><th>Ҳамагӣ (дона)</th><th>Миёна дар рӯз</th><th>Пешгӯӣ 7 рӯз</th></tr>${per}</table>` : '<div class="empty">Маълумот нест.</div>'}
      </div>
      <p class="explain">${esc(f.disclaimer)} Пешгӯӣ танҳо аз фурӯши ба охир расида ва пардохтшуда ҳисоб мешавад (бекоршуда ва пардохтнашуда дохил нест). Рӯзи ҷорӣ ба омӯзиш дохил намешавад.</p>`;
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/* ---------- Амалиёт (делегатсия) ---------- */
async function doOrderAction(action, id, btn) {
  if (action === "approve") {
    if (!confirm(`Пардохти фармоиши #${id}-ро дар ҳамён дидед ва тасдиқ мекунед?`)) return;
    await api(`/orders/${id}/approve-payment`, { method: "POST" });
    toast(`Фармоиши #${id}: пардохт тасдиқ шуд ✓`);
  } else if (action === "reject") {
    const reason = window.prompt(`Сабаби рад кардани пардохти #${id} (ихтиёрӣ):`, "");
    if (reason === null) return;
    await api(`/orders/${id}/reject-payment`, { method: "POST", body: { reason } });
    toast(`Фармоиши #${id}: пардохт рад шуд`);
  } else if (action === "setstatus") {
    const sel = $(`[data-status-select="${CSS.escape(String(id))}"]`);
    const status = sel ? sel.value : "";
    if (!status) return;
    if (status === "CANCELLED" && !confirm(`Фармоиши #${id}-ро бекор мекунед?`)) return;
    await api(`/orders/${id}/status`, { method: "PATCH", body: { status } });
    toast(`Фармоиши #${id}: ҳолат → ${ORDER_STATUS_TEXT[status] || status} ✓`);
  }
  refresh();
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) {
    const tab = e.target.closest(".tabs [data-tab]");
    if (tab) switchTab(tab.dataset.tab);
    return;
  }
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  try {
    if (["approve", "reject", "setstatus"].includes(action)) {
      btn.disabled = true;
      try {
        await doOrderAction(action, Number(id), btn);
      } finally {
        btn.disabled = false;
      }
    } else if (action === "res-status") {
      const sel = $(`[data-res-select="${CSS.escape(id)}"]`);
      await api(`/reservations/${id}`, { method: "PATCH", body: { status: sel.value } });
      toast("Статуси бронкунӣ сабт шуд ✓");
      renderReservations();
    } else if (action === "food-edit") {
      const food = (await api("/admin/foods")).find((x) => String(x.id) === id);
      const slot = $(`[data-edit-slot="${CSS.escape(id)}"]`);
      slot.innerHTML = foodForm(food, { mode: "edit" });
    } else if (action === "food-cancel") {
      $(`[data-edit-slot="${CSS.escape(id)}"]`).innerHTML = "";
    } else if (action === "food-toggle") {
      const food = (await api("/admin/foods")).find((x) => String(x.id) === id);
      await api(`/foods/${id}`, { method: "PUT", body: { available: !food.available } });
      toast("Ҳолати таом сабт шуд ✓");
      renderMenu();
    } else if (action === "food-del") {
      if (!confirm("Таомро нест кунед? (фармоишҳои кӯҳна нусхаи нархро нигоҳ медоранд)")) return;
      await api(`/foods/${id}`, { method: "DELETE" });
      toast("Таом нест шуд.");
      renderMenu();
    } else if (action === "promo-toggle") {
      await api(`/promos/${encodeURIComponent(id)}/toggle`, { method: "POST" });
      renderPromos();
    } else if (action === "promo-del") {
      if (!confirm(`Промокод ${id} нест карда шавад?`)) return;
      await api(`/promos/${encodeURIComponent(id)}`, { method: "DELETE" });
      renderPromos();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (form.id === "loginCard") return login(e);
  e.preventDefault();
  try {
    if (form.id === "foodForm") {
      const body = readFoodForm(form);
      await api("/foods", { method: "POST", body });
      toast("Таом илова шуд ✓");
      renderMenu();
    } else if (form.dataset.foodForm) {
      const body = readFoodForm(form);
      await api(`/foods/${form.dataset.foodForm}`, { method: "PUT", body });
      toast("Таом захира шуд ✓");
      renderMenu();
    } else if (form.id === "promoForm") {
      const fd = new FormData(form);
      const body = {
        code: String(fd.get("code") || "").trim(),
        type: fd.get("type"),
        value: Number(fd.get("value")),
        minTotal: Number(fd.get("minTotal") || 0),
        expiresAt: fd.get("expiresAt") || null,
        maxUses: fd.get("maxUses") ? Number(fd.get("maxUses")) : null,
      };
      await api("/promos", { method: "POST", body });
      toast("Промокод илова шуд ✓");
      renderPromos();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener("change", async (e) => {
  const input = e.target;
  if (!input.matches || !input.matches("input[data-upload]")) return;
  const file = input.files && input.files[0];
  if (!file) return;
  const form = input.closest("form");
  const fd = new FormData();
  fd.append("photo", file, file.name);
  try {
    const r = await api("/upload", { method: "POST", form: fd });
    const hidden = form.querySelector('input[name="image"]');
    hidden.value = r.url;
    let prev = form.querySelector("img.preview");
    if (!prev) {
      prev = document.createElement("img");
      prev.className = "preview";
      prev.alt = "";
      hidden.after(prev);
    }
    prev.src = r.url;
    toast("Расм боргирӣ шуд ✓ (захира кунед)");
  } catch (err) {
    input.value = "";
    toast(err.message, true);
  }
});

$("#refreshBtn").addEventListener("click", refresh);
$("#logoutBtn").addEventListener("click", () => logout(""));

if (token) showApp();
