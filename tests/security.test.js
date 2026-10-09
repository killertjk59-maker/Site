/**
 * Тестҳои амният ва санҷиши воридшаванда (аудит).
 * Тестҳо дар коди аслии 7cc00c2 НОКОМ мешаванд — ин исботи заифиҳост.
 * Пас аз ислоҳ бояд ҳама гузаранд.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  startServer, http, adminLogin, createOrder, orderAuth, TEST_JWT_SECRET,
} = require("./support/helpers");

// 1x1 PNG (ҳақиқӣ)
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

let srv;
let admin;
before(async () => {
  srv = await startServer();
  admin = await adminLogin(srv.base);
});
after(async () => { if (srv) await srv.stop(); });

async function upload(base, token, bytes, { filename = "photo.png", type = "image/png" } = {}) {
  const fd = new FormData();
  fd.append("photo", new Blob([bytes], { type }), filename);
  const res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers };
}

describe("Дастрасӣ ба фармоишҳо (маҳдуд кардани маълумоти хусусӣ)", () => {
  test("GET /api/orders/:id бе токен маълумоти мизоҷро намедиҳад", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "GET", `/api/orders/${o.json.id}`);
    assert.ok(r.status === 401 || r.status === 404, `статус ${r.status}, бояд 401/404 бошад`);
    assert.ok(!String(r.text).includes("+992 90 111 22 33"), "телефон дар ҷавоб набояд бошад");
  });

  test("pay-info бе токен дастнорас аст", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "GET", `/api/orders/${o.json.id}/pay-info`);
    assert.ok(r.status === 401 || r.status === 404, `статус ${r.status}`);
  });

  test("payment-submitted бе токен фармоишро тағйир дода наметавонад", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`);
    assert.ok(r.status === 401 || r.status === 404, `статус ${r.status}`);
    const check = await http(srv.base, "GET", "/api/orders", { token: admin });
    const found = check.json.find((x) => x.id === o.json.id);
    assert.equal(found.status, "AWAITING_PAYMENT", "ҳолат набояд тағйир ёбад");
  });

  test("фармоиши нав токени дастрасии мизоҷро бармегардонад", async () => {
    const o = await createOrder(srv.base, {});
    assert.equal(o.status, 201);
    assert.equal(typeof o.json.accessToken, "string");
    assert.ok(o.json.accessToken.length >= 20, "токен бояд дароз ва тасодуфӣ бошад");
  });

  test("токени фармоиши дигар ба фармоиши дигар дастрасӣ намедиҳад", async () => {
    const a = await createOrder(srv.base, {});
    const b = await createOrder(srv.base, {});
    const r = await http(srv.base, "GET", `/api/orders/${b.json.id}`, { headers: orderAuth(a.json) });
    assert.ok(r.status === 401 || r.status === 404, `статус ${r.status}`);
  });

  test("мизоҷ бо токени худ фармоишашро мебинад, аммо телефон/суроға нест", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "GET", `/api/orders/${o.json.id}`, { headers: orderAuth(o.json) });
    assert.equal(r.status, 200);
    assert.equal(r.json.id, o.json.id);
    assert.equal(r.json.phone, undefined, "телефон дар DTO-и мизоҷ набояд бошад");
    assert.equal(r.json.address, undefined, "суроға дар DTO-и мизоҷ набояд бошад");
    assert.equal(r.json.accessTokenHash, undefined);
    assert.equal(r.json.accessToken, undefined);
  });

  test("админ бо токени худ ҳар фармоишро мебинад", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "GET", `/api/orders/${o.json.id}`, { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.json.phone, "+992 90 111 22 33");
  });

  test("ҷустуҷӯ бо телефон (by-phone) маълумоти фармоишҳоро намедиҳад", async () => {
    await createOrder(srv.base, { phone: "+992 91 222 33 44" });
    const r = await http(srv.base, "GET", "/api/orders/by-phone?phone=223344");
    assert.ok(r.status !== 200 || (Array.isArray(r.json) && r.json.length === 0), `статус ${r.status}: ${r.text.slice(0, 120)}`);
  });
});

describe("Санҷиши воридшаванда", () => {
  test("нархи манфӣ/нол барои таом қабул намешавад", async () => {
    const neg = await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "Манфӣ", price: -500 } });
    assert.equal(neg.status, 400);
    const zero = await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "Сифр", price: 0 } });
    assert.equal(zero.status, 400);
    const nan = await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "NaN", price: "abc" } });
    assert.equal(nan.status, 400);
  });

  test("image бо протоколи javascript: қабул намешавад", async () => {
    const r = await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "Тест", price: 10, image: "javascript:alert(1)" } });
    assert.equal(r.status, 400);
  });

  test("ном бе ҳад дароз ва танҳо HTML қабул намешавад", async () => {
    const r = await http(srv.base, "POST", "/api/foods", { token: admin, body: { name: "x".repeat(500), price: 10 } });
    assert.equal(r.status, 400);
  });

  test("миқдори таом нодуруст/бузург рад мешавад", async () => {
    for (const quantity of ["abc", 0, -3, 1000000, 2.5]) {
      const r = await createOrder(srv.base, { items: [{ foodId: 1, quantity }] });
      assert.equal(r.status, 400, `quantity=${quantity} статус ${r.status}`);
    }
  });

  test("сабади холӣ ва ҳад зиёд рад мешавад", async () => {
    assert.equal((await createOrder(srv.base, { items: [] })).status, 400);
    const many = Array.from({ length: 100 }, () => ({ foodId: 1, quantity: 1 }));
    assert.equal((await createOrder(srv.base, { items: many })).status, 400);
  });

  test("телефон нодуруст рад мешавад", async () => {
    assert.equal((await createOrder(srv.base, { phone: "abc" })).status, 400);
    assert.equal((await createOrder(srv.base, { phone: "1" })).status, 400);
  });

  test("суроға барои расонидан ҳатмист", async () => {
    const r = await createOrder(srv.base, { method: "delivery", address: "" });
    assert.equal(r.status, 400);
  });

  test("усули пардохти нодуруст рад мешавад", async () => {
    assert.equal((await createOrder(srv.base, { paymentMethod: "bitcoin" })).status, 400);
  });

  test("бронкунии нодуруст (сана/вақт) рад мешавад", async () => {
    const bad = [
      { date: "yesterday??", time: "20:00" },
      { date: "2026-12-01", time: "99:99" },
      { date: "2020-01-01", time: "20:00" },
    ];
    for (const b of bad) {
      const r = await http(srv.base, "POST", "/api/reservations", {
        body: { name: "А", phone: "+992 90 111 22 33", guests: "2 нафар", ...b },
      });
      assert.equal(r.status, 400, JSON.stringify(b));
    }
  });

  test("промокод бо тахфифи 150% қабул намешавад", async () => {
    const r = await http(srv.base, "POST", "/api/promos", { token: admin, body: { code: "BIG150", type: "percent", value: 150 } });
    assert.equal(r.status, 400);
  });

  test("ҷамъи фармоиш пас аз тахфиф аз 1 с. паст шуда наметавонад", async () => {
    const p = await http(srv.base, "POST", "/api/promos", { token: admin, body: { code: "FREE100", type: "percent", value: 100 } });
    assert.equal(p.status, 201);
    const r = await createOrder(srv.base, { items: [{ foodId: 7, quantity: 1 }], promo: "FREE100" });
    assert.equal(r.status, 400, `статус ${r.status}: ${r.text.slice(0, 120)}`);
  });
});

describe("Қоидаҳои ҷараёни пардохт ва статус", () => {
  test("approve-payment барои фармоиши нақдӣ рад мешавад (409)", async () => {
    const o = await createOrder(srv.base, { paymentMethod: "cash" });
    const r = await http(srv.base, "POST", `/api/orders/${o.json.id}/approve-payment`, { token: admin });
    assert.equal(r.status, 409);
  });

  test("approve-payment дуюм бор 409 медиҳад (такрори тасдиқ)", async () => {
    const o = await createOrder(srv.base, {});
    await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, { headers: orderAuth(o.json) });
    assert.equal((await http(srv.base, "POST", `/api/orders/${o.json.id}/approve-payment`, { token: admin })).status, 200);
    assert.equal((await http(srv.base, "POST", `/api/orders/${o.json.id}/approve-payment`, { token: admin })).status, 409);
  });

  test("ҳолати DONE барои фармоиши пардохтнашуда рад мешавад", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { token: admin, body: { status: "DONE" } });
    assert.equal(r.status, 409);
  });

  test("CONFIRMED-ро бевосита аз PATCH гузоштан мумкин нест (танҳо approve-payment)", async () => {
    const o = await createOrder(srv.base, {});
    const r = await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { token: admin, body: { status: "CONFIRMED" } });
    assert.equal(r.status, 400);
  });

  test("payment-submitted барои фармоиши бекоршуда 409 медиҳад", async () => {
    const o = await createOrder(srv.base, {});
    await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { token: admin, body: { status: "CANCELLED" } });
    const r = await http(srv.base, "POST", `/api/orders/${o.json.id}/payment-submitted`, { headers: orderAuth(o.json) });
    assert.equal(r.status, 409);
  });

  test("ҳолати терминалии CANCELLED тағйир намеёбад", async () => {
    const o = await createOrder(srv.base, { paymentMethod: "cash" });
    await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { token: admin, body: { status: "CANCELLED" } });
    const r = await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { token: admin, body: { status: "COOKING" } });
    assert.equal(r.status, 409);
  });

  test("GET /api/orders барои админ allowedStatuses медиҳад", async () => {
    const o = await createOrder(srv.base, { paymentMethod: "cash" });
    const list = await http(srv.base, "GET", "/api/orders", { token: admin });
    const found = list.json.find((x) => x.id === o.json.id);
    assert.ok(Array.isArray(found.allowedStatuses));
    assert.ok(found.allowedStatuses.includes("COOKING"));
    assert.ok(found.allowedStatuses.includes("CANCELLED"));
  });
});

describe("Ҳисоботи даромад", () => {
  test("фармоиши нақдии бекоршуда даромад ҳисоб намешавад", async () => {
    const before = (await http(srv.base, "GET", "/api/admin/stats", { token: admin })).json;
    const o = await createOrder(srv.base, { paymentMethod: "cash", items: [{ foodId: 2, quantity: 1 }] });
    await http(srv.base, "PATCH", `/api/orders/${o.json.id}/status`, { token: admin, body: { status: "CANCELLED" } });
    const after = (await http(srv.base, "GET", "/api/admin/stats", { token: admin })).json;
    assert.equal(after.revenue, before.revenue, "фармоиши бекоршуда ба даромад дохил намешавад");
  });

  test("ҳисобот даромади тасдиқшуда, воқеан гирифташуда ва интизориро ҷудо мекунад", async () => {
    const s = (await http(srv.base, "GET", "/api/admin/stats", { token: admin })).json;
    for (const key of ["salesCompleted", "approvedOnline", "cashCollected", "collectedNet", "pendingOnline", "pendingCash"]) {
      assert.ok(typeof s[key] === "number", `майдони ${key} лозим аст`);
    }
  });
});

describe("Боркунии расм (санҷиши формат ва андоза)", () => {
  test("HTML-и ниқобшуда ҳамчун расм қабул намешавад", async () => {
    const dir = path.join(srv.dir, "uploads");
    const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    const r = await upload(srv.base, admin, Buffer.from("<html><script>alert(document.domain)</script></html>"), { filename: "evil.html", type: "image/png" });
    assert.equal(r.status, 400);
    const after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    assert.equal(after, before, "файл набояд нигоҳ дошта нашавад");
  });

  test("SVG (метавонад скрипт дошта бошад) қабул намешавад", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r = await upload(srv.base, admin, svg, { filename: "a.svg", type: "image/svg+xml" });
    assert.equal(r.status, 400);
  });

  test("расми ҳақиқии PNG қабул мешавад ва бо nosniff сервер мешавад", async () => {
    const r = await upload(srv.base, admin, PNG_1X1);
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.url, /^\/uploads\/[\w.-]+\.png$/);
    const get = await fetch(srv.base + r.json.url);
    assert.equal(get.status, 200);
    assert.match(get.headers.get("content-type") || "", /^image\/png/);
    assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  });

  test("файли аз 5MB калон рад мешавад", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 0);
    big.set(PNG_1X1.subarray(0, 8), 0); // сигнатураи PNG, аммо андоза аз ҳад зиёд
    const r = await upload(srv.base, admin, big);
    assert.equal(r.status, 400);
  });

  test("боркунӣ бе токен рад мешавад", async () => {
    const r = await upload(srv.base, null, PNG_1X1);
    assert.equal(r.status, 401);
  });
});

describe("HTTP-сарлавҳаҳо ва хатогиҳо", () => {
  test("CORS барои origin-и номаълум ACAO намедиҳад", async () => {
    const r = await http(srv.base, "GET", "/api/foods", { headers: { Origin: "https://evil.example" } });
    assert.notEqual(r.headers.get("access-control-allow-origin"), "*");
    assert.notEqual(r.headers.get("access-control-allow-origin"), "https://evil.example");
  });

  test("сарлавҳаҳои амниятӣ дар саҳифаи асосӣ ҳастанд", async () => {
    const r = await http(srv.base, "GET", "/");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.ok(r.headers.get("x-frame-options") || /frame-ancestors/.test(r.headers.get("content-security-policy") || ""), "clickjacking-protection лозим аст");
    assert.ok(r.headers.get("content-security-policy"), "Content-Security-Policy лозим аст");
  });

  test("/api/health маълумоти бизнесиро (счётчикҳо) надиҳад", async () => {
    const r = await http(srv.base, "GET", "/api/health");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.orders, undefined);
    assert.equal(r.json.foods, undefined);
    assert.equal(r.json.reservations, undefined);
  });

  test("JSON-и вайроншуда ҷавоби JSON медиҳад, бе stack trace", async () => {
    const r = await http(srv.base, "POST", "/api/orders", { raw: "{bad", headers: { "Content-Type": "application/json" } });
    assert.equal(r.status, 400);
    assert.match(r.headers.get("content-type") || "", /application\/json/);
    assert.ok(!/node_modules|at JSON\.parse|SyntaxError/.test(r.text), "stack trace набояд нашавад");
  });

  test("роҳи номаълум барои API ҷавоби JSON 404 медиҳад", async () => {
    const r = await http(srv.base, "GET", "/api/no-such-route");
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") || "", /application\/json/);
  });

  test("маълумоти API Cache-Control: no-store дорад", async () => {
    const r = await http(srv.base, "GET", "/api/foods");
    assert.match(r.headers.get("cache-control") || "", /no-store/);
  });
});

describe("Сервиси service worker", () => {
  test("sw.js ҳеҷ гоҳ ҷавоби /api/-ро барои фармоиш/admin нигоҳ намедорад", async () => {
    const sw = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
    const cacheVersion = (sw.match(/CACHE\s*=\s*"([^"]+)"/) || [])[1];
    assert.ok(cacheVersion && cacheVersion !== "oshona-v1", "версияи кэш бояд баланд шавад (кэши кӯҳна бо маълумоти API пок шавад)");

    // Иҷрои вақтии sw.js бо caches/fetch-и сохтаи мо
    const vm = require("node:vm");
    const listeners = {};
    const puts = [];
    const cacheStub = {
      put: async (req) => { puts.push(typeof req === "string" ? req : req.url); },
      match: async () => undefined,
      addAll: async () => {},
    };
    const ctx = {
      self: {
        addEventListener: (type, fn) => { listeners[type] = fn; },
        skipWaiting: async () => {},
        clients: { claim: async () => {} },
      },
      caches: {
        open: async () => cacheStub,
        match: async () => undefined,
        keys: async () => [],
        delete: async () => true,
      },
      fetch: async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
      URL,
      Response,
      Promise,
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(sw, ctx);
    assert.ok(listeners.fetch, "fetch listener лозим аст");

    const attempts = [
      { url: "http://x/api/orders/1", headers: { Authorization: "Bearer t" } },
      { url: "http://x/api/orders", headers: {} },
      { url: "http://x/api/admin/stats", headers: {} },
      { url: "http://x/api/orders/by-phone?phone=1", headers: {} },
    ];
    for (const a of attempts) {
      let p;
      const req = { url: a.url, method: "GET", headers: new Map(Object.entries(a.headers)) };
      listeners.fetch({ request: req, respondWith: (x) => { p = x; } });
      await p;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.deepEqual(puts, [], `API-и хусусӣ кэш шуд: ${puts.join(", ")}`);
  });
});

describe("Конфигуратсияи production", () => {
  test("production бо JWT_SECRET-и пешфарзӣ оғоз намешавад", async () => {
    const s = await startServer({
      waitHealthy: false,
      env: { NODE_ENV: "production", JWT_SECRET: "oshona_secret_change_me" },
    });
    const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r("timeout"), 5000))]);
    await s.stop();
    assert.notEqual(code, "timeout", "сервер бояд зуд хомӯш шавад, на ки кор кунад");
    assert.notEqual(code, 0, "сервер бояд бо JWT пешфарзӣ рад шавад");
    assert.match(s.getLog(), /JWT_SECRET/);
  });

  test("production бо пароли админи 'admin123' оғоз намешавад", async () => {
    const s = await startServer({
      waitHealthy: false,
      env: { NODE_ENV: "production", ADMIN_PASSWORD: "admin123" },
    });
    const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r("timeout"), 5000))]);
    await s.stop();
    assert.notEqual(code, "timeout", "сервер бояд зуд хомӯш шавад, на ки кор кунад");
    assert.notEqual(code, 0, "сервер бояд бо пароли заиф рад шавад");
    assert.match(s.getLog(), /ADMIN_PASSWORD/);
  });

  test("production бо JWT ва пароли дуруст оғоз меёбад", async () => {
    const s = await startServer({
      env: { NODE_ENV: "production", JWT_SECRET: TEST_JWT_SECRET, ADMIN_PASSWORD: "Strong-Pass-2026-xyz!" },
    });
    try {
      const r = await http(s.base, "GET", "/api/health");
      assert.equal(r.status, 200);
    } finally {
      await s.stop();
    }
  });
});

describe("Амнияти маълумот (storage)", () => {
  test("файли вайроншудаи orders.json сервериро оғоз намекунад ва файлро рӯи нест намекунад", async () => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "oshona-corrupt-"));
    const broken = '[{"id":1,"customerName":"Мизоҷ"';
    fs.writeFileSync(path.join(dir, "orders.json"), broken);
    const s = await startServer({ dataDir: dir, waitHealthy: false });
    const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r("timeout"), 5000))]);
    await s.stop();
    assert.notEqual(code, "timeout", "сервер бояд зуд хомӯш шавад, на ки кор кунад");
    assert.notEqual(code, 0);
    assert.equal(fs.readFileSync(path.join(dir, "orders.json"), "utf8"), broken, "файл набояд бе тағйир монад");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("навиштани фармоиш файли муваққатӣ (.tmp) боқӣ намегузорад", async () => {
    await createOrder(srv.base, {});
    const leftovers = fs.readdirSync(srv.dir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});

describe("Маҳдудияти дархостҳо", () => {
  test("кӯшишҳои зиёди вуруд ба 429 мерасанд", async () => {
    const s = await startServer({ env: { RATE_LIMIT_SCALE: "1" } });
    try {
      let saw429 = false;
      for (let i = 0; i < 25; i++) {
        const r = await http(s.base, "POST", "/api/auth/login", { body: { username: "admin", password: "bad-" + i } });
        if (r.status === 429) { saw429 = true; assert.ok(r.headers.get("retry-after")); break; }
      }
      assert.ok(saw429, "маҳдудияти кӯшишҳои вуруд набояд аз 25 бештар бошад");
    } finally {
      await s.stop();
    }
  });

  test("CORS аз origin-ҳои иҷозатдодашуда (CORS_ORIGINS) кор мекунад", async () => {
    const s = await startServer({ env: { CORS_ORIGINS: "https://shop.example.tj", RATE_LIMIT_SCALE: "1" } });
    try {
      const ok = await http(s.base, "GET", "/api/foods", { headers: { Origin: "https://shop.example.tj" } });
      assert.equal(ok.headers.get("access-control-allow-origin"), "https://shop.example.tj");
      const bad = await http(s.base, "GET", "/api/foods", { headers: { Origin: "https://evil.example" } });
      assert.notEqual(bad.headers.get("access-control-allow-origin"), "https://evil.example");
    } finally {
      await s.stop();
    }
  });
});
