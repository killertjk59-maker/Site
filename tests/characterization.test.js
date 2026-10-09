/**
 * Тестҳои характеризатсионӣ: ҷараёни ҷории фармоиш ва пардохт (қоидаи ҳатмӣ).
 * Ин тестҳо пеш аз тағйирот навишта шудаанд ва бояд ҳам бо кодҳои кӯҳна ва ҳам бо нав гузаранд.
 * Пардохт ҳеҷ гоҳ аз ҷониби AI тасдиқ/рад намешавад — танҳо админ.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  startServer, http, adminLogin, createOrder, orderAuth,
} = require("./support/helpers");

let srv;
let admin;

before(async () => {
  srv = await startServer();
  admin = await adminLogin(srv.base);
});
after(async () => { if (srv) await srv.stop(); });

describe("Меню", () => {
  test("GET /api/foods меню-и аввалро бармегардонад (8 таом)", async () => {
    const r = await http(srv.base, "GET", "/api/foods");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
    assert.equal(r.json.length, 8);
    assert.equal(r.json[0].name, "Паста Трюфель");
    assert.equal(r.json[0].price, 68);
  });
});

describe("Фармоиши нақдӣ", () => {
  test("фармоиш бо нақд: NEW / CASH_ON_DELIVERY ва ҷамъи дуруст", async () => {
    const r = await createOrder(srv.base, {
      paymentMethod: "cash",
      items: [{ foodId: 1, quantity: 2 }, { foodId: 7, quantity: 1 }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.paymentMethod, "cash");
    assert.equal(r.json.status, "NEW");
    assert.equal(r.json.paymentStatus, "CASH_ON_DELIVERY");
    assert.equal(r.json.total, 68 * 2 + 24);
  });

  test("админ фармоиши нақдиро ба ОШПАЗӢ/ДАР РОҲ/ АНҶОМ мегузаронад", async () => {
    const r = await createOrder(srv.base, { paymentMethod: "cash", items: [{ foodId: 3, quantity: 1 }] });
    const id = r.json.id;
    for (const status of ["COOKING", "DELIVERING", "DONE"]) {
      const p = await http(srv.base, "PATCH", `/api/orders/${id}/status`, { token: admin, body: { status } });
      assert.equal(p.status, 200, `status=${status}: ${p.text}`);
      assert.equal(p.json.status, status);
    }
  });
});

describe("Фармоиши онлайн ва пардохт", () => {
  test("фармоиши онлайн дастурҳои пардохтро бармегардонад", async () => {
    const r = await createOrder(srv.base, { items: [{ foodId: 2, quantity: 1 }] });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "AWAITING_PAYMENT");
    assert.equal(r.json.paymentStatus, "AWAITING_PAYMENT");
    const pi = r.json.paymentInstructions;
    assert.ok(pi, "paymentInstructions бояд бошад");
    assert.equal(pi.amount, 119);
    assert.equal(pi.comment, r.json.paymentCode);
    assert.match(pi.qr, /^data:image\/png;base64,/);
    assert.ok(pi.dcWallet && pi.alifWallet, "рақами ҳамён бояд бошад");
  });

  test("промокоди OSHONA10 тахфифи 10% медиҳад", async () => {
    const r = await createOrder(srv.base, { items: [{ foodId: 1, quantity: 1 }], promo: "OSHONA10" });
    assert.equal(r.status, 201);
    assert.equal(r.json.subtotal, 68);
    assert.equal(r.json.discount, 7);
    assert.equal(r.json.total, 61);
  });

  test("промокоди нодуруст рад мешавад (400)", async () => {
    const r = await createOrder(srv.base, { promo: "NOPE-123" });
    assert.equal(r.status, 400);
    assert.ok(r.json.error);
  });

  test("мизоҷ «пардохт кардам» мефиристад → PAYMENT_REVIEW / IN_REVIEW", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, {
      headers: orderAuth(o.json),
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.status, "PAYMENT_REVIEW");
    assert.equal(r.json.paymentStatus, "IN_REVIEW");
  });

  test("админ пардохтро тасдиқ мекунад → PAID / CONFIRMED", async () => {
    const o = await createOrder(srv.base, {});
    await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, { headers: orderAuth(o.json) });
    const r = await http(srv.base, "POST", `/api/orders/${o.json.id}/approve-payment`, { token: admin });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.paymentStatus, "PAID");
    assert.equal(r.json.status, "CONFIRMED");
  });

  test("админ пардохтро рад мекунад → REJECTED / PAYMENT_REJECTED", async () => {
    const o = await createOrder(srv.base, {});
    await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, { headers: orderAuth(o.json) });
    const r = await http(srv.base, "POST", `/api/orders/${o.json.id}/reject-payment`, { token: admin });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.paymentStatus, "REJECTED");
    assert.equal(r.json.status, "PAYMENT_REJECTED");
  });

  test("пас аз рад мизоҷ метавонад дубора пардохтро фиристад", async () => {
    const o = await createOrder(srv.base, {});
    await http(srv.base, "POST", `/api/orders/${o.json.id}/reject-payment`, { token: admin });
    const r = await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, { headers: orderAuth(o.json) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.status, "PAYMENT_REVIEW");
  });
});

describe("Админ: аутентификатсия", () => {
  test("логин бо парол — токен; парол нодуруст — 401", async () => {
    const ok = await http(srv.base, "POST", "/api/auth/login", { body: { username: "admin", password: "Test-Admin-Pass-2026!" } });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    const bad = await http(srv.base, "POST", "/api/auth/login", { body: { username: "admin", password: "wrong" } });
    assert.equal(bad.status, 401);
  });

  test("роҳҳои админ бе токен 401 медиҳанд", async () => {
    assert.equal((await http(srv.base, "GET", "/api/orders")).status, 401);
    assert.equal((await http(srv.base, "GET", "/api/reservations")).status, 401);
    assert.equal((await http(srv.base, "GET", "/api/promos")).status, 401);
    assert.equal((await http(srv.base, "GET", "/api/admin/stats")).status, 401);
    assert.equal((await http(srv.base, "POST", "/api/foods", { body: { name: "x", price: 1 } })).status, 401);
  });

  test("токени нодуруст 401 медиҳад", async () => {
    const r = await http(srv.base, "GET", "/api/orders", { token: "abc.def.ghi" });
    assert.equal(r.status, 401);
  });

  test("админ фармоишҳоро мебинад", async () => {
    const r = await http(srv.base, "GET", "/api/orders", { token: admin });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
    assert.ok(r.json.length > 0);
  });
});

describe("Бронкунии миз", () => {
  test("бронкунии дуруст 201 мегардонад", async () => {
    const r = await http(srv.base, "POST", "/api/reservations", {
      body: { name: "Мизоҷ", phone: "+992 90 111 22 33", date: "2026-12-31", time: "20:00", guests: "4 нафар" },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "NEW");
  });
});
