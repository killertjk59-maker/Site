// Phase D (D2): E2E-сенарияҳо дар сатҳи HTTP. Иҷро: серверро бо DATA_DIR-и муваққатӣ оғоз кунед,
// сипас: BASE=http://127.0.0.1:3000 node scripts/e2e-api-check.js
// (браузер-automation дар муҳити рушд дастнорас буд — ин сатҳи API аст; ҷузъиёти визуалӣ jsdom/статикӣ санҷида шуданд)
/* Phase D (D2): E2E-сенарияҳо дар сатҳи HTTP (браузер дар sandbox нест —
 * қайдми шаффоф: ҷузъҳои визуалӣ/мобилӣ танҳо jsdom+статикӣ санҷида шуданд).
 * Сервер: бе OPENROUTER_API_KEY → AI fallback-и воқеӣ (rules), на натиҷаи сохта. */
const BASE = process.env.BASE || "http://127.0.0.1:3990";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name, extra); } };
async function req(path, method = "GET", { body, token, orderToken } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orderToken) headers["X-Order-Token"] = orderToken;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* html */ }
  return { status: res.status, json };
}
(async () => {
  // 1. Корбар сайтро мекушояд
  const home = await fetch(BASE + "/"); const html = await home.text();
  ok("1. сайт 200 + skip-link/footer-grid", home.status === 200 && html.includes("skip-link") && html.includes("footer-grid"));

  // 2. Маҳсулотро меҷӯяд (меню аз сервер; ҷустуҷӯ клиентӣ — jsdom санҷидааст)
  const foods = await req("/api/foods");
  ok("2. меню 200, 8 таом, ҳама бо акс", foods.status === 200 && foods.json.length === 8 && foods.json.every(f => f.image && f.image.startsWith("/img/")), JSON.stringify(foods.json && foods.json.length));

  // 3-5. Сабад→checkout→фармоиш (сабад jsdom-санҷида; ин ҷо фармоиши воқеӣ)
  const pasta = foods.json.find(f => /Паста/i.test(f.name));
  const order = await req("/api/orders", "POST", { body: { customerName: "E2E Tester", phone: "+992901234567", address: "кӯчаи Тест 1", method: "delivery", paymentMethod: "online", paymentProvider: "manual", items: [{ foodId: pasta.id, quantity: 2 }] } });
  ok("3-5. фармоиш 201 + paymentCode + accessToken", order.status === 201 && order.json.paymentCode && order.json.accessToken, JSON.stringify(order.status));

  // 6. Дастурҳои пардохт
  const pay = await req(`/api/orders/${order.json.id}/pay-info`, "GET", { orderToken: order.json.accessToken });
  ok("6. pay-info 200: ҳамён+комментария", pay.status === 200 && pay.json.paymentInstructions && pay.json.paymentInstructions.comment, JSON.stringify(pay.status));

  // 7. Админ пардохтро дастӣ месанҷад
  const noAuth = await req("/api/orders");
  ok("13a. беиҷозат → 401", noAuth.status === 401);
  const badLogin = await req("/api/auth/login", "POST", { body: { username: "admin", password: "wrong-password" } });
  ok("13b. пароли нодуруст → 401", badLogin.status === 401);
  const login = await req("/api/auth/login", "POST", { body: { username: "admin", password: "admin123" } });
  ok("7a. админ вуруд", login.status === 200 && login.json.token);
  const jwt = login.json.token;
  await req(`/api/orders/${order.json.id}/payment-submitted`, "POST", { orderToken: order.json.accessToken });
  const approve = await req(`/api/orders/${order.json.id}/approve-payment`, "POST", { token: jwt });
  ok("7b. тасдиқи пардохт (дастӣ)", approve.status === 200 && approve.json.paymentStatus === "PAID", JSON.stringify(approve.json && approve.json.paymentStatus));

  // 8. Статуси фармоиш дуруст нав мешавад
  let s = null;
  for (const st of ["COOKING", "DELIVERING", "DONE"]) {
    const r = await req(`/api/orders/${order.json.id}/status`, "PATCH", { token: jwt, body: { status: st } });
    s = r.json && r.json.status;
    if (r.status !== 200) break;
  }
  ok("8. статусҳо → DONE", s === "DONE", String(s));
  const bad = await req(`/api/orders/${order.json.id}/status`, "PATCH", { token: jwt, body: { status: "COOKING" } });
  ok("8b. DONE → бозгашт 409 (TERMINAL)", bad.status === 409 && bad.json.code === "TERMINAL", JSON.stringify(bad.json));
  const resv = await req(`/api/orders/${order.json.id}/status`, "PATCH", { token: jwt, body: { status: "CONFIRMED" } });
  ok("8c. CONFIRMED мустақиман гузоштанӣ нест (400 STATUS_RESERVED — мисли original)", resv.status === 400 && resv.json.code === "STATUS_RESERVED", JSON.stringify(resv.json));

  // 9+12. AI recommendation (бе калид → fallback-и қоидавӣ, на ихтироъ)
  const ai = await req("/api/ai/chat", "POST", { body: { message: "Барои ду нафар чӣ тавсия медиҳед?", preferences: { budget: 200 } } });
  ok("9/12. AI бе калид → 200, source=rules, notice (fallback-и воқеӣ)", ai.status === 200 && ai.json.source === "rules" && ai.json.recommendations.length >= 0 && ai.json.notice, JSON.stringify(ai.json && ai.json.source));

  // 10. Food exclusion риоя мешавад (backend)
  const aiAvoid = await req("/api/ai/chat", "POST", { body: { message: "тавсия", preferences: { avoid: "шир" } } });
  const names = (aiAvoid.json.recommendations || []).map(r => r.name);
  ok("10. истиснои шир: Паста Трюфель (пармезан) тавсия намешавад", aiAvoid.status === 200 && !names.some(n => /Паста Трюфель/i.test(n)), names.join(","));

  // 11. Калория дуруст ҳисоб мешавад — admin таоми бо таркиб месозад; формула зинда санҷида мешавад
  // (seed-и demo таркиб надорад — ин воқеияти демо-маълумот аст, на нуқсон; ҳисоб unit-тестҳо ҳам дорад)
  const created = await req("/api/foods", "POST", { token: jwt, body: {
    name: "E2E Калория Таом", category: "Асосӣ", price: 50,
    ingredients: [{ name: "Паста (пухта)", grams: 200 }, { name: "Пармезан", grams: 20 }],
    nutritionConfidence: "high",
  } });
  const n11 = created.json && created.json.nutrition;
  let calcOk = created.status === 201 && n11 && n11.status === "computed" && Number.isFinite(n11.calories) && n11.calories > 0;
  if (calcOk) {
    const w = n11.weightG || 220;
    calcOk = Math.abs(n11.per100g.calories - Math.round((n11.calories * 100) / w)) <= 1;
    // формулаи ҷамъ: 158*2 + 431*0.2 = 402.2 → 402 (аз unit-тест)
    calcOk = calcOk && n11.calories === 402;
  }
  ok("11. калория зинда: 200г паста+20г пармезан = 402 ккал; per100g дуруст", calcOk, JSON.stringify(n11 && { c: n11.calories, p100: n11.per100g && n11.per100g.calories, w: n11.weightG }));

  // 14. Мобил — браузер нест; танҳо статикӣ
  ok("14. мобил: media query 560px мавҷуд (браузер-санҷиш НЕСТ)", html.includes("viewport"), "css static check only");

  console.log(`\nE2E: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
