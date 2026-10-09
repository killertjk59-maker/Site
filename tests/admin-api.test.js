/**
 * Тестҳои API-и админ ва мизоҷ (сервери воқеӣ): меню бо таркиб, калория тавассути API,
 * промо CRUD, пешгӯӣ/ҳисобот, рад бо сабаб, ва дастрасии қатъии роҳҳо.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, http, adminLogin, createOrder, orderAuth } = require("./support/helpers");

let srv;
let admin;

before(async () => {
  srv = await startServer();
  admin = await adminLogin(srv.base);
});
after(async () => { if (srv) await srv.stop(); });

describe("Меню ва калория тавассути API", () => {
  let foodId;

  test("таоми нав бо таркиб: калория дар backend ҳисоб мешавад (паста 200г + пармезан 20г)", async () => {
    const r = await http(srv.base, "POST", "/api/foods", {
      token: admin,
      body: {
        name: "Тести калория",
        category: "Асосӣ",
        price: 75,
        description: "Санҷиши ҳисоб",
        ingredients: [{ name: "Паста (пухта)", grams: 200 }, { name: "Пармезан", grams: 20 }],
        nutritionConfidence: "high",
        nutritionSource: "Санҷиш: ҳисоби дастӣ",
        allergens: ["gluten", "milk"],
        weightG: 220,
      },
    });
    assert.equal(r.status, 201, r.text);
    foodId = r.json.id;
    assert.equal(r.json.nutrition.calories, 402);
    assert.equal(r.json.nutrition.status, "computed");
  });

  test("GET /api/foods/:id (мизоҷ) калорияро аз таркиб медиҳад; таркиб/аллерген дар DTO", async () => {
    const r = await http(srv.base, "GET", `/api/foods/${foodId}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.nutrition.calories, 402);
    assert.equal(r.json.nutrition.protein, 19.3);
    assert.ok(r.json.allergens.some((a) => a.key === "milk"));
    assert.equal(r.json.nutrition.source, "Санҷиш: ҳисоби дастӣ");
  });

  test("ингредиенти номаълум → калория null (рақами сохта нест)", async () => {
    const r = await http(srv.base, "PUT", `/api/foods/${foodId}`, {
      token: admin,
      body: { ingredients: [{ name: "Чизи номаълум", grams: 100 }] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.nutrition.calories, null);
    assert.deepEqual(r.json.nutrition.missingIngredients, ["Чизи номаълум"]);
    const pub = await http(srv.base, "GET", `/api/foods/${foodId}`);
    assert.equal(pub.json.nutrition.calories, null);
  });

  test("таоми ғайрифаъол дар сайт нест; таоми нав (demo) дар админ флаг дорад", async () => {
    await http(srv.base, "PUT", `/api/foods/${foodId}`, { token: admin, body: { available: false } });
    const pub = await http(srv.base, "GET", "/api/foods");
    assert.ok(!pub.json.some((f) => f.id === foodId), "таоми ғайрифаъол дар рӯйхати мизоҷ набояд бошад");
    assert.equal((await http(srv.base, "GET", `/api/foods/${foodId}`)).status, 404);
    const adm = await http(srv.base, "GET", "/api/admin/foods", { token: admin });
    assert.ok(adm.json.some((f) => f.id === foodId && f.available === false));
    assert.ok(adm.json.some((f) => f.demo === true), "таомҳои seed бо demo:true бояд бошанд");
  });

  test("таом бо нархи нодуруст ва калиди аллерген ё расми беэътимод рад мешавад", async () => {
    assert.equal((await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "Нодуруст", price: 10, allergens: ["unknown"] } })).status, 400);
    assert.equal((await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "Нодуруст", price: 10, nutritionConfidence: "very-high" } })).status, 400);
    assert.equal((await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "Нодуруст", price: 10, image: "http://insecure.example/x.jpg" } })).status, 400);
  });

  test("DELETE таом танҳо бо админ; пас аз нест кардан 404", async () => {
    assert.equal((await http(srv.base, "DELETE", `/api/foods/${foodId}`)).status, 401);
    assert.equal((await http(srv.base, "DELETE", `/api/foods/${foodId}`, { token: admin })).status, 200);
    assert.equal((await http(srv.base, "DELETE", `/api/foods/${foodId}`, { token: admin })).status, 404);
  });
});

describe("Рад бо сабаб ва дастрасии мизоҷ", () => {
  test("админ пардохтро бо сабаб рад мекунад; мизоҷ сабабро мебинад; пас аз дубора фиристодан ҳолат нав мешавад", async () => {
    const o = await createOrder(srv.base, { items: [{ foodId: 1, quantity: 1 }] });
    await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, { headers: orderAuth(o.json) });
    const rej = await http(srv.base, "POST", `/api/orders/${o.json.id}/reject-payment`, { token: admin, body: { reason: "Маблағ нарасид" } });
    assert.equal(rej.status, 200);
    assert.equal(rej.json.status, "PAYMENT_REJECTED");
    const mine = await http(srv.base, "GET", `/api/orders/${o.json.id}`, { headers: orderAuth(o.json) });
    assert.equal(mine.json.status, "PAYMENT_REJECTED");
    assert.equal(mine.json.rejectReason, "Маблағ нарасид");
    const again = await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, { headers: orderAuth(o.json) });
    assert.equal(again.json.status, "PAYMENT_REVIEW");
  });

  test("мизоҷ фармоиши дигарро бо токени худ тағйир дода наметавонад (PATCH/approve бе админ)", async () => {
    const o = await createOrder(srv.base, { paymentMethod: "cash" });
    assert.equal((await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { headers: orderAuth(o.json), body: { status: "CANCELLED" } })).status, 401);
    assert.equal((await http(srv.base, "POST", `/api/orders/${o.json.id}/approve-payment`, { headers: orderAuth(o.json) })).status, 401);
  });

  test("токени нодуруст ба фармоиш (бо ID-и дуруст) 404 медиҳад", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "GET", `/api/orders/${o.json.id}`, { headers: { "X-Order-Token": "x".repeat(40) } });
    assert.equal(r.status, 404);
  });

  test("admin бо токени худ фармоиши мизоҷро пурра мебинад (телефон, токени хэш нест)", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "GET", `/api/orders/${o.json.id}`, { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.json.phone, "+992 90 111 22 33");
    assert.equal(r.json.accessTokenHash, undefined);
    assert.ok(Array.isArray(r.json.events) && r.json.events.length >= 1);
  });
});

describe("Промокодҳо (админ CRUD)", () => {
  test("эҷод, такрор (409), фаъол/ғайрифаъол, тафтиш, нест кардан", async () => {
    const created = await http(srv.base, "POST", "/api/promos", { token: admin, body: { code: "SPRING26", type: "percent", value: 15 } });
    assert.equal(created.status, 201);
    assert.equal((await http(srv.base, "POST", "/api/promos", { token: admin, body: { code: "spring26", type: "percent", value: 5 } })).status, 409);
    const v = await http(srv.base, "POST", "/api/promos/validate", { body: { code: "SPRING26", total: 100 } });
    assert.equal(v.json.discount, 15);
    assert.equal(v.json.total, 85);
    await http(srv.base, "POST", "/api/promos/SPRING26/toggle", { token: admin });
    assert.equal((await http(srv.base, "POST", "/api/promos/validate", { body: { code: "SPRING26", total: 100 } })).status, 400);
    await http(srv.base, "POST", "/api/promos/SPRING26/toggle", { token: admin });
    assert.equal((await http(srv.base, "DELETE", "/api/promos/SPRING26", { token: admin })).status, 200);
    assert.equal((await http(srv.base, "DELETE", "/api/promos/SPRING26", { token: admin })).status, 404);
  });

  test("промо: ҳадди истифода — пас аз ҳадд фармоиш бо промо рад мешавад", async () => {
    await http(srv.base, "POST", "/api/promos", { token: admin, body: { code: "ONCE50", type: "amount", value: 5, maxUses: 1 } });
    const first = await createOrder(srv.base, { items: [{ foodId: 1, quantity: 1 }], promo: "ONCE50" });
    assert.equal(first.status, 201);
    const second = await createOrder(srv.base, { items: [{ foodId: 1, quantity: 1 }], promo: "ONCE50" });
    assert.equal(second.status, 400);
  });
});

describe("Ҳисобот, пешгӯӣ ва тавсияҳо", () => {
  test("GET /api/admin/forecast: сохтор, бе фурӯши воқеии ҳамин рӯз (ҳеҷ leakage)", async () => {
    const o = await createOrder(srv.base, { paymentMethod: "cash", items: [{ foodId: 2, quantity: 2 }] });
    await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { token: admin, body: { status: "DONE" } });
    const r = await http(srv.base, "GET", "/api/admin/forecast", { token: admin });
    assert.equal(r.status, 200);
    assert.ok(["no_sales", "insufficient", "partial", "ok"].includes(r.json.dataStatus));
    assert.equal(r.json.history.realSalesCount, 0, "фурӯши имрӯза ба таърих дохил намешавад");
    assert.ok(r.json.models.ma7 && r.json.models.weekdayMa7);
    assert.match(r.json.disclaimer, /тахминӣ/);
  });

  test("GET /api/admin/stats: фурӯши нақдии DONE → cashCollected; бекоршуда дар даромад нест", async () => {
    const before = (await http(srv.base, "GET", "/api/admin/stats", { token: admin })).json;
    const done = await createOrder(srv.base, { paymentMethod: "cash", items: [{ foodId: 3, quantity: 1 }] });
    await http(srv.base, "PATCH", `/api/orders/${done.json.id}/status`, { token: admin, body: { status: "DONE" } });
    const cancelled = await createOrder(srv.base, { paymentMethod: "cash", items: [{ foodId: 3, quantity: 1 }] });
    await http(srv.base, "PATCH", `/api/orders/${cancelled.json.id}/status`, { token: admin, body: { status: "CANCELLED" } });
    const after = (await http(srv.base, "GET", "/api/admin/stats", { token: admin })).json;
    assert.equal(after.cashCollected - before.cashCollected, 49);
    assert.equal(after.collectedNet - before.collectedNet, 49);
    assert.equal(after.cancelled - before.cancelled, 49);
    assert.equal(after.salesCompleted - before.salesCompleted, 49);
  });

  test("POST /api/recommendations: бе AI, аз рӯи буҷет ва истисноҳо", async () => {
    const r = await http(srv.base, "POST", "/api/recommendations", { body: { preferences: { budget: 50, avoid: ["шир"] } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.source, "rules");
    assert.ok(r.json.recommendations.every((x) => x.price <= 50));
  });

  test("бронкунӣ: admin-и PATCH статусро тағйир медиҳад; мизоҷ ҷавоби бе телефон мегирад", async () => {
    const r = await http(srv.base, "POST", "/api/reservations", { body: { name: "Мизоҷ", phone: "+992 91 222 33 44", date: "2026-12-30", time: "19:00", guests: "3 нафар" } });
    assert.equal(r.status, 201);
    assert.equal(r.json.phone, undefined, "телефон дар ҷавоби мизоҷ набояд бошад");
    const p = await http(srv.base, "PATCH", `/api/reservations/${r.json.id}`, { token: admin, body: { status: "CONFIRMED" } });
    assert.equal(p.json.status, "CONFIRMED");
    assert.equal((await http(srv.base, "PATCH", `/api/reservations/${r.json.id}`, { token: admin, body: { status: "BAD" } })).status, 400);
  });
});

describe("Роҳҳои номаълум ва дастнорас", () => {
  test("Telegram webhook бе танзим 404 (JSON)", async () => {
    const r = await http(srv.base, "POST", "/api/telegram/webhook", { body: {} });
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") || "", /json/);
  });

  test("/api/debug/storage ва /api/orders/by-phone нестанд", async () => {
    assert.equal((await http(srv.base, "GET", "/api/debug/storage", { token: admin })).status, 404);
    assert.equal((await http(srv.base, "GET", "/api/orders/by-phone?phone=123456")).status, 404);
  });

  test("POST /api/auth/login бо username-и нодуруст 401 (бе ошкор кардани ҳеҷ)", async () => {
    const r = await http(srv.base, "POST", "/api/auth/login", { body: { username: "root", password: "Test-Admin-Pass-2026!" } });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "Логин ё парол нодуруст аст.");
  });
});
