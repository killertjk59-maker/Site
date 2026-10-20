/**
 * Тестҳои Phase A (audit docs/AUDIT-PHASE1-2026-10-20.md):
 *  - B2: pickup дар checkout — суроға ихтиёрӣ, method=pickup ба сервер меравад;
 *  - B1: фармоиши PAYMENT_REJECTED тугмаи «Аз нав пардохт кардан» дорад ва бо токен pay-info мегирад;
 *  - дастрасӣ: ESC қабатҳоро мепӯшад; корти таом бо Enter кушода мешавад;
 *  - расмҳои худмизбон (/img/...) нишон дода мешаванд (safeImageUrl).
 * Ин тестҳо рафтори пардохтро тағйир намедиҳанд — танҳо UI-ро месанҷанд.
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

function loadPage(file, scriptFile, { routes, storage = {} }) {
  const html = read(file).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  const calls = [];
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.open = () => null;
  window.confirm = () => true;
  window.prompt = () => "";
  window.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, (c) => "\\" + c) };
  window.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    return routes(url, init) || json(404, { error: "Роҳ ёфт нашуд." });
  };
  window.eval(read(scriptFile));
  return { dom, window, document: window.document, calls };
}

const MENU = [
  { id: 1, name: "Паста", category: "Асосӣ", price: 68, image: "/img/foods/pasta-truffle.jpg", description: "Паста", available: true, weightG: null, ingredients: [], allergens: [], tags: [], nutrition: { status: "none", calories: null } },
  { id: 2, name: "Стейк", category: "Асосӣ", price: 119, image: "", description: "Гӯшт", available: true, weightG: null, ingredients: [], allergens: [], tags: [], nutrition: { status: "none", calories: null } },
];
const baseRoutes = (extra = {}) => (url, init) => {
  if (url === "/api/config") return json(200, { currency: "TJS", aiEnabled: false, telegramBotUsername: null, version: "2.0.0" });
  if (url === "/api/foods") return json(200, MENU);
  if (extra[url]) return extra[url](init);
  return undefined;
};

describe("Phase A: checkout бо pickup (B2)", () => {
  test("delivery пешфарз: суроға ҳатмӣ; pickup: суроға ихтиёрӣ ва method=pickup меравад", async () => {
    let orderBody;
    const { document, window, calls } = loadPage("index.html", "script.js", {
      storage: { oshonaCart: JSON.stringify([{ id: 1, qty: 1 }]) },
      routes: baseRoutes({
        "/api/orders": (init) => {
          orderBody = JSON.parse(init.body);
          return json(201, {
            id: 11, orderId: 11, status: "NEW", paymentStatus: "CASH_ON_DELIVERY", paymentMethod: "cash",
            paymentCode: "OSH-TEST1", total: 68, currency: "TJS", items: [], accessToken: "tok_" + "p".repeat(30),
          });
        },
      }),
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#checkoutBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const form = document.querySelector("#checkoutForm");
    assert.equal(document.querySelector("#addressField").hidden, false, "delivery: суроға нишон дода мешавад");
    assert.equal(document.querySelector("#addressInput").required, true, "delivery: суроға ҳатмӣ");

    const sel = document.querySelector("#fulfilmentSelect");
    sel.value = "pickup";
    sel.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(document.querySelector("#addressField").hidden, true, "pickup: суроға пинҳон");
    assert.equal(document.querySelector("#addressInput").required, false, "pickup: суроға ихтиёрӣ");

    form.elements.name.value = "Тест Pickup";
    form.elements.phone.value = "+992 90 123 45 67";
    form.elements.method.value = "cash";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => orderBody);
    assert.equal(orderBody.method, "pickup", "ба сервер method=pickup меравад");
    assert.equal(orderBody.address, "", "pickup суроға надорад");
    assert.equal(orderBody.paymentMethod, "cash");
  });
});

describe("Phase A: пардохти такрорӣ пас аз рад (B1)", () => {
  test("PAYMENT_REJECTED тугмаи «Аз нав пардохт кардан» дорад; pay-info бо токен; равзана кушода мешавад", async () => {
    const token = "tok_" + "r".repeat(30);
    const { document, window, calls } = loadPage("index.html", "script.js", {
      storage: { oshonaOrders: JSON.stringify([{ id: 3, token }]) },
      routes: baseRoutes({
        "/api/orders/3": () => json(200, {
          id: 3, status: "PAYMENT_REJECTED", paymentStatus: "REJECTED", paymentMethod: "online",
          total: 68, currency: "TJS", items: [{ name: "Паста", quantity: 1 }], rejectReason: "Пул нарасид",
        }),
        "/api/orders/3/pay-info": () => json(200, {
          orderId: 3, total: 68, currency: "TJS", paymentStatus: "REJECTED",
          paymentInstructions: { comment: "OSH-RETRY", amount: 68, dushanbeCity: "034 (OSHONA)", alif: "034 (OSHONA)", dcWallet: "034", alifWallet: "034", qr: null },
        }),
      }),
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector('#tabbar button[data-tab="orders"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const btn = await waitFor(() => document.querySelector("[data-order-pay]"));
    assert.match(btn.textContent, /Аз нав пардохт кардан/);
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector("#paySheet").classList.contains("show"));
    assert.equal(document.querySelector("#payCode").textContent, "OSH-RETRY");
    const pi = calls.find((c) => c.url === "/api/orders/3/pay-info");
    assert.equal(pi.headers["X-Order-Token"], token, "pay-info бо токени фармоиш");
  });
});

describe("Phase A: дастрасӣ (клавиатура)", () => {
  test("ESC сабадро мепӯшад", async () => {
    const { document, window } = loadPage("index.html", "script.js", { routes: baseRoutes() });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#cartBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.equal(document.querySelector("#cartDrawer").classList.contains("open"), true);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(document.querySelector("#cartDrawer").classList.contains("open"), false, "ESC сабадро пӯшид");
  });

  test("Enter дар корти таом модалро мекушояд", async () => {
    const { document, window } = loadPage("index.html", "script.js", { routes: baseRoutes() });
    const card = await waitFor(() => document.querySelector("#foodGrid .food-card"));
    assert.equal(card.getAttribute("tabindex"), "0", "корт бо клавиатура дастрас аст");
    card.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(document.querySelector("#foodModal").classList.contains("show"), true, "Enter модали таомро кушод");
  });
});

describe("Phase A: расмҳои худмизбон", () => {
  test("/img/... қабул мешавад; javascript: ҳамчунон рад", async () => {
    const { document } = loadPage("index.html", "script.js", { routes: baseRoutes() });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    const withImg = [...document.querySelectorAll("#foodGrid .food-image")].find((d) => (d.getAttribute("style") || "").includes("/img/"));
    assert.ok(withImg, "расми худмизбон нишон дода мешавад");
    const bad = { ...MENU[0], id: 42, image: "javascript:alert(1)" };
    const { document: d2 } = loadPage("index.html", "script.js", {
      routes: (url) => (url === "/api/config" ? json(200, {}) : url === "/api/foods" ? json(200, [bad]) : undefined),
    });
    await waitFor(() => d2.querySelector("#foodGrid .food-card"));
    assert.equal(d2.querySelectorAll("#foodGrid .food-image[style]").length, 0, "javascript: сохта намешавад");
  });
});
