/**
 * Тестҳои frontend бо jsdom (бе браузери воқеӣ):
 *  - XSS: номи таом/категория/тавсиф ҳамчун матн нишон дода мешавад, ҳеҷ элемент/скрипт сохта намешавад;
 *  - сабад: таоми нестшуда сабади мизоҷро намешканад ва ҳангоми хатои меню хориҷ намешавад;
 *  - бронкунии офлайн паёми «банд шуд»-ро нишон намедиҳад;
 *  - фармоиш: паёми муваффақият ва равзанаи пардохт танҳо пас аз ҷавоби мусбати сервер;
 *  - фармоишҳои мизоҷ бо X-Order-Token; пардохт бо токен фиристода мешавад;
 *  - панели админ: XSS, тасдиқ/рад танҳо бо confirm ва ҷавоби сервер.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const PUBLIC = path.join(__dirname, "..", "public");
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 2000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("waitFor: вақт гузашт");
    await sleep(10);
  }
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/**
 * Саҳифаро бо скриптҳои худ бор мекунад. routes(url, init) → Response | undefined (404).
 */
function loadPage(file, scriptFile, { routes, storage = {}, confirmResult = true }) {
  const html = read(file).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  const calls = [];
  const alerts = [];
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.open = () => null;
  window.confirm = (msg) => { alerts.push(["confirm", msg]); return confirmResult; };
  window.prompt = () => "";
  window.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, (c) => "\\" + c) };
  window.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    const r = routes(url, init);
    if (r) return r;
    return json(404, { error: "Роҳ ёфт нашуд." });
  };
  window.eval(read(scriptFile));
  return { dom, window, document: window.document, calls, alerts };
}

const MENU_SAFE = [
  { id: 1, name: "Паста", category: "Асосӣ", price: 68, image: "", description: "Паста", available: true, weightG: null, ingredients: [], allergens: [], tags: [], nutrition: { status: "none", calories: null } },
  { id: 2, name: "Стейк", category: "Асосӣ", price: 119, image: "", description: "Гӯшт", available: true, weightG: null, ingredients: [], allergens: [], tags: [], nutrition: { status: "none", calories: null } },
];

const MALICIOUS = '<img src=x onerror="window.__xss=1">';
const MENU_XSS = [
  {
    id: 9, name: MALICIOUS, category: "<b>cat</b>", price: 10, image: "javascript:alert(1)",
    description: "<script>window.__xss=2</script><b>bold</b>", available: true, weightG: null,
    ingredients: [], allergens: [], tags: [], nutrition: { status: "none", calories: null },
  },
];

describe("Сайти мизоҷ (index.html + script.js)", () => {
  test("XSS: номи таом ҳамчун матн нишон дода мешавад, элемент/скрипт сохта намешавад", async () => {
    const { window, document } = loadPage("index.html", "script.js", {
      routes: (url) => {
        if (url === "/api/config") return json(200, { currency: "TJS", aiEnabled: false, telegramBotUsername: null });
        if (url === "/api/foods") return json(200, MENU_XSS);
        return undefined;
      },
    });
    const h3 = await waitFor(() => document.querySelector("#foodGrid h3"));
    assert.equal(h3.textContent, MALICIOUS, "номи таом ҳамчун матни хом бояд бошад");
    assert.equal(document.querySelectorAll("#foodGrid img").length, 0, "расми беэътимод (javascript:) сохта нашавад");
    assert.equal(document.querySelectorAll("#foodGrid b").length, 0, "тег дар тавсиф ҳамчун элемент набояд бошад");
    assert.equal(document.querySelectorAll("script").length, 0, "скрипт дар саҳифа набояд пайдо шавад");
    assert.equal(window.__xss, undefined, "код набояд иҷро шавад");
    assert.match(document.querySelector("#filters").innerHTML, /&lt;b&gt;cat&lt;\/b&gt;/);
  });

  test("меню танҳо аз сервер меояд: таоми демо (бе сервер) нишон дода намешавад", async () => {
    const { document } = loadPage("index.html", "script.js", {
      routes: (url) => {
        if (url === "/api/config") return json(200, {});
        if (url === "/api/foods") return json(500, { error: "Хатогии дохилӣ" });
        return undefined;
      },
    });
    const box = await waitFor(() => (document.querySelector("#menuStatus").hidden === false ? document.querySelector("#menuStatus") : null));
    assert.equal(document.querySelectorAll("#foodGrid .food-card").length, 0, "меню-и демо нишон дода нашавад");
    assert.match(box.textContent, /дастнорас/);
  });

  test("сабад: таоми нестшуда сабадро мешканад ва ҳисоб дуруст аст", async () => {
    const { document, window } = loadPage("index.html", "script.js", {
      storage: { oshonaCart: JSON.stringify([{ id: 1, qty: 2 }, { id: 999, qty: 3 }]) },
      routes: (url) => {
        if (url === "/api/config") return json(200, {});
        if (url === "/api/foods") return json(200, MENU_SAFE);
        return undefined;
      },
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    await waitFor(() => window.localStorage.getItem("oshonaCart").includes("999") === false);
    assert.deepEqual(JSON.parse(window.localStorage.getItem("oshonaCart")), [{ id: 1, qty: 2 }]);
    assert.equal(document.querySelector("#cartTotal").textContent, "136 с.");
    assert.equal(document.querySelectorAll("#cartItems .cart-row").length, 1);
  });

  test("сабад бо корбардории ҳанӯз нест ҳангоми хатои меню хориҷ намешавад", async () => {
    const { document, window } = loadPage("index.html", "script.js", {
      storage: { oshonaCart: JSON.stringify([{ id: 1, qty: 2 }, { id: 999, qty: 3 }]) },
      routes: (url) => {
        if (url === "/api/config") return json(200, {});
        if (url === "/api/foods") return json(503, { error: "down" });
        return undefined;
      },
    });
    await waitFor(() => document.querySelector("#menuStatus").hidden === false);
    assert.equal(JSON.parse(window.localStorage.getItem("oshonaCart")).length, 2, "сабад набояд тоза шавад");
    assert.equal(document.querySelector("#cartCount").textContent, "5");
  });

  test("бронкунии офлайн: паёми «банд шуд» нест; маълумот нигоҳ дошта мешавад", async () => {
    const { document, window } = loadPage("index.html", "script.js", {
      routes: (url, init) => {
        if (url === "/api/config") return json(200, {});
        if (url === "/api/foods") return json(200, MENU_SAFE);
        if (url === "/api/reservations" && init.method === "POST") return json(500, { error: "Хатогии дохилӣ" });
        return undefined;
      },
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    const form = document.querySelector("#reservationForm");
    form.elements.name.value = "Алӣ";
    form.elements.phone.value = "+992 90 000 00 00";
    form.elements.date.value = "2026-12-31";
    form.elements.time.value = "20:00";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    const t = await waitFor(() => (document.querySelector("#toast").classList.contains("show") ? document.querySelector("#toast") : null));
    assert.doesNotMatch(t.textContent, /банд карда шуд!/, "муваффақият гуфта намешавад");
    assert.match(t.textContent, /анҷом наёфт/);
    assert.equal(form.elements.name.value, "Алӣ", "маълумоти форма нест намешавад");
  });

  test("фармоиши онлайн: равзанаи пардохт танҳо пас аз 201; токен нигоҳ дошта мешавад", async () => {
    const order = {
      id: 7, orderId: 7, status: "AWAITING_PAYMENT", paymentStatus: "AWAITING_PAYMENT", paymentMethod: "online",
      paymentCode: "OSH-ABCDE", total: 68, currency: "TJS", items: [], accessToken: "tok_" + "x".repeat(30),
      paymentInstructions: { comment: "OSH-ABCDE", amount: 68, dushanbeCity: "034 (OSHONA)", alif: "034 (OSHONA)", dcWallet: "034", alifWallet: "034", qr: null },
    };
    const { document, window, calls } = loadPage("index.html", "script.js", {
      storage: { oshonaCart: JSON.stringify([{ id: 1, qty: 1 }]) },
      routes: (url, init) => {
        if (url === "/api/config") return json(200, {});
        if (url === "/api/foods") return json(200, MENU_SAFE);
        if (url === "/api/orders" && init.method === "POST") return json(201, order);
        if (url === "/api/orders/7/payment-submitted") return json(200, { ...order, status: "PAYMENT_REVIEW", paymentStatus: "IN_REVIEW" });
        return undefined;
      },
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#checkoutBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const form = document.querySelector("#checkoutForm");
    form.elements.name.value = "Алӣ Тест";
    form.elements.phone.value = "+992 90 111 22 33";
    form.elements.address.value = "Душанбе, кӯчаи Сино 1";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector("#paySheet").classList.contains("show"));
    assert.equal(document.querySelector("#payOrderId").textContent, "#7");
    assert.equal(document.querySelector("#payCode").textContent, "OSH-ABCDE");
    const stored = JSON.parse(window.localStorage.getItem("oshonaOrders"));
    assert.equal(stored[0].id, 7);
    assert.equal(stored[0].token, order.accessToken);
    assert.equal(JSON.parse(window.localStorage.getItem("oshonaCart")).length, 0, "сабад пас аз фармоиш холӣ мешавад");

    // Пардохт: токен бояд ба сарлавҳа равад
    document.querySelector("#payDoneBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => calls.some((c) => c.url === "/api/orders/7/payment-submitted"));
    const pay = calls.find((c) => c.url === "/api/orders/7/payment-submitted");
    assert.equal(pay.headers["X-Order-Token"], order.accessToken);
    await waitFor(() => /фиристода шуд/.test(document.querySelector("#toast").textContent));
  });

  test("фармоиш рад шуд (400): муваффақият нест, равзанаи пардохт кушода намешавад, сабад нигоҳ дошта мешавад", async () => {
    const { document, window } = loadPage("index.html", "script.js", {
      storage: { oshonaCart: JSON.stringify([{ id: 1, qty: 1 }]) },
      routes: (url, init) => {
        if (url === "/api/config") return json(200, {});
        if (url === "/api/foods") return json(200, MENU_SAFE);
        if (url === "/api/orders" && init.method === "POST") return json(400, { error: "Телефон: формати нодуруст" });
        return undefined;
      },
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#checkoutBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const form = document.querySelector("#checkoutForm");
    form.elements.name.value = "Алӣ Тест";
    form.elements.phone.value = "1";
    form.elements.address.value = "Душанбе, кӯчаи Сино 1";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    const err = await waitFor(() => (document.querySelector("#checkoutError").hidden === false ? document.querySelector("#checkoutError") : null));
    assert.match(err.textContent, /Телефон/);
    assert.equal(document.querySelector("#paySheet").classList.contains("show"), false);
    assert.equal(JSON.parse(window.localStorage.getItem("oshonaCart")).length, 1);
    assert.equal(window.localStorage.getItem("oshonaOrders"), null);
  });

  test("фармоишҳои ман: бо токен (X-Order-Token) ва бе телефон", async () => {
    const { document, window, calls } = loadPage("index.html", "script.js", {
      storage: { oshonaOrders: JSON.stringify([{ id: 3, token: "tok_" + "y".repeat(30) }]) },
      routes: (url) => {
        if (url === "/api/config") return json(200, {});
        if (url === "/api/foods") return json(200, MENU_SAFE);
        if (url === "/api/orders/3") return json(200, { id: 3, status: "CONFIRMED", paymentStatus: "PAID", paymentMethod: "online", total: 68, items: [{ name: "Паста", quantity: 1 }] });
        return undefined;
      },
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector('#tabbar button[data-tab="orders"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => /Пардохт тасдиқ шуд/.test(document.querySelector("#moList").textContent));
    const c = calls.find((x) => x.url === "/api/orders/3");
    assert.equal(c.headers["X-Order-Token"], "tok_" + "y".repeat(30));
    assert.equal(document.querySelector("#moPhone"), null, "ҷустуҷӯ бо телефон набояд бошад");
  });

  test("AI: ҷавоби модел (бо HTML) ҳамчун матн нишон дода мешавад; POST бо мехоҳишҳо", async () => {
    const aiReply = {
      reply: "<img src=x onerror=\"window.__ai=1\">Хуб",
      source: "ai",
      notice: null,
      notes: [],
      disclaimer: "Маълумоти ғизоӣ тахминӣ аст.",
      recommendations: [{ foodId: 1, name: "<b>Паста</b>", price: 68, reason: "таъм", nutrition: null }],
    };
    const { document, window, calls } = loadPage("index.html", "script.js", {
      routes: (url, init) => {
        if (url === "/api/config") return json(200, { aiEnabled: true });
        if (url === "/api/foods") return json(200, MENU_SAFE);
        if (url === "/api/ai/chat") return json(200, aiReply);
        return undefined;
      },
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#aiBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const input = document.querySelector("#aiInput");
    input.value = "Ман гушт намехӯрам";
    document.querySelector("#aiForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector(".ai-card"));
    assert.equal(window.__ai, undefined, "HTML-и модел иҷро нашавад");
    assert.equal(document.querySelectorAll(".ai-bot img").length, 0);
    assert.equal(document.querySelectorAll(".ai-card b").length, 0);
    assert.match(document.querySelector(".ai-card h4").textContent, /<b>Паста<\/b>/);
    const req = calls.find((c) => c.url === "/api/ai/chat");
    assert.equal(req.body.message, "Ман гушт намехӯрам");
    assert.equal(req.body.preferences.minor, false);
    assert.equal(req.headers.Authorization, undefined, "AI-дархост калиди админ надорад");
  });
});

describe("Панели админ (admin.html + admin.js)", () => {
  const ORDER_PENDING = {
    id: 5, customerName: '<img src=x onerror="window.__adm=1">', phone: "+992 90 111 22 33", address: "Суроға",
    method: "delivery", paymentMethod: "online", paymentStatus: "IN_REVIEW", paymentCode: "OSH-ABCDE", status: "PAYMENT_REVIEW",
    items: [{ name: "Паста", price: 68, quantity: 1 }], subtotal: 68, discount: 0, total: 68, currency: "TJS",
    createdAt: "2026-10-09T08:00:00.000Z", events: [], rejectReason: null,
    reviewActions: ["approve", "reject"], allowedStatuses: ["CANCELLED"],
  };
  const STATS = { orders: 1, newOrders: 1, collectedNet: 0, pendingOnline: 68, pendingCash: 0, foods: 2, reservations: 0, uploads: 0, currency: "TJS", ai: { requestsToday: 0, dailyRequestLimit: 500 } };

  function adminRoutes(overrides = {}) {
    return (url, init) => {
      if (overrides[url]) return overrides[url](init);
      if (url === "/api/admin/stats") return json(200, STATS);
      if (url === "/api/admin/foods") return json(200, []);
      if (url === "/api/orders") return json(200, [ORDER_PENDING]);
      if (url === "/api/reservations") return json(200, []);
      return undefined;
    };
  }

  test("XSS: ном/телефон/суроғаи мизоҷ ҳамчун матн; тасдиқ танҳо бо confirm ва ҷавоби 200", async () => {
    let approveHeaders;
    const { document, window, calls, alerts } = loadPage("admin.html", "admin.js", {
      storage: { oshonaAdminToken: "tok-admin" },
      confirmResult: true,
      routes: adminRoutes({
        "/api/orders/5/approve-payment": (init) => {
          approveHeaders = init.headers;
          return json(200, { ...ORDER_PENDING, paymentStatus: "PAID", status: "CONFIRMED" });
        },
      }),
    });
    await waitFor(() => document.querySelector("#content .card"));
    assert.equal(window.__adm, undefined, "номи мизоҷ иҷро нашавад");
    assert.equal(document.querySelectorAll("#content img").length, 0);
    assert.match(document.querySelector("#content .card-head b").textContent, /<img src=x/);
    const approve = document.querySelector('[data-action="approve"]');
    assert.ok(approve, "тугмаи тасдиқ бояд бошад");
    approve.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => /пардохт тасдиқ шуд/.test(document.querySelector("#toast").textContent));
    assert.equal(alerts.filter((a) => a[0] === "confirm").length, 1, "тасдиқи ниҳоӣ бо confirm");
    assert.equal(approveHeaders.Authorization, "Bearer tok-admin");
    assert.ok(calls.some((c) => c.url === "/api/orders/5/approve-payment" && c.method === "POST"));
  });

  test("рад кардани тасдиқ аз ҷониби сервер (409): паёми муваффақият нест, хато нишон дода мешавад", async () => {
    const { document, window } = loadPage("admin.html", "admin.js", {
      storage: { oshonaAdminToken: "tok-admin" },
      confirmResult: true,
      routes: adminRoutes({
        "/api/orders/5/approve-payment": () => json(409, { error: "Пардохт дар ҳолати «CANCELLED» тасдиқ карда намешавад." }),
      }),
    });
    await waitFor(() => document.querySelector('[data-action="approve"]'));
    document.querySelector('[data-action="approve"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const t = await waitFor(() => (/CANCELLED/.test(document.querySelector("#toast").textContent) ? document.querySelector("#toast") : null));
    assert.equal(t.classList.contains("bad"), true);
    assert.doesNotMatch(t.textContent, /тасдиқ шуд ✓/);
  });

  test("тасдиқ бекор мешавад агар confirm рад шавад — дархост фиристода намешавад", async () => {
    const { document, window, calls } = loadPage("admin.html", "admin.js", {
      storage: { oshonaAdminToken: "tok-admin" },
      confirmResult: false,
      routes: adminRoutes(),
    });
    await waitFor(() => document.querySelector('[data-action="approve"]'));
    document.querySelector('[data-action="approve"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(30);
    assert.equal(calls.filter((c) => c.url.includes("approve-payment")).length, 0);
  });

  test("токени нодуруст (401) → форма ворид нишон дода мешавад", async () => {
    const { document } = loadPage("admin.html", "admin.js", {
      storage: { oshonaAdminToken: "bad" },
      routes: () => json(401, { error: "Токен нодуруст" }),
    });
    await waitFor(() => document.querySelector("#loginCard").hidden === false);
    assert.equal(document.querySelector("#app").hidden, true);
  });

  test("ворид: логин → токен дар localStorage нигоҳ дошта мешавад", async () => {
    const { document, window, calls } = loadPage("admin.html", "admin.js", {
      routes: (url) => {
        if (url === "/api/auth/login") return json(200, { token: "tok-new" });
        if (url === "/api/admin/stats") return json(200, STATS);
        if (url === "/api/orders") return json(200, []);
        if (url === "/api/admin/foods") return json(200, []);
        return undefined;
      },
    });
    document.querySelector("#loginPass").value = "Test-Admin-Pass-2026!";
    document.querySelector("#loginCard").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => window.localStorage.getItem("oshonaAdminToken") === "tok-new");
    const login = calls.find((c) => c.url === "/api/auth/login");
    assert.equal(login.body.password, "Test-Admin-Pass-2026!");
  });

  test("админ: amali 'reject' ва sabab ба сервер меравад", async () => {
    let body;
    const { document, window } = loadPage("admin.html", "admin.js", {
      storage: { oshonaAdminToken: "tok-admin" },
      routes: adminRoutes({
        "/api/orders/5/reject-payment": (init) => {
          body = JSON.parse(init.body);
          return json(200, { ...ORDER_PENDING, paymentStatus: "REJECTED", status: "PAYMENT_REJECTED", rejectReason: body.reason });
        },
      }),
    });
    window.prompt = () => "Пул нарасид";
    await waitFor(() => document.querySelector('[data-action="reject"]'));
    document.querySelector('[data-action="reject"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => body);
    assert.equal(body.reason, "Пул нарасид");
  });
});
