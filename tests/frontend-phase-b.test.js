/**
 * Тестҳои Phase B (premium UI/UX):
 *  - B3: скелетонҳо ҳангоми боргирии меню (синфи ҷудогона, бе layout shift);
 *  - B4: нест кардани маҳсулот аз сабад бо feedback; ҳолати loading дар тугмаи checkout;
 *  - B5: pulse-и тугмаи «Ба сабад»;
 *  - B6: AI — тоза кардани сӯҳбат ва retry пас аз хатогӣ;
 *  - B1/B2: гардҳои статикӣ — палитраи токенӣ, prefers-reduced-motion, рейтинги қалбакӣ нест.
 * Ҳама jsdom; рафтори пардохт/backend даст нахӯрдааст.
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
  if (url === "/api/config") return json(200, { currency: "TJS", aiEnabled: true, telegramBotUsername: null, version: "2.0.0" });
  if (url === "/api/foods") return json(200, MENU);
  if (extra[url]) return extra[url](init);
  return undefined;
};

describe("Phase B: skeleton loading (B3)", () => {
  test("пеш аз боргирии меню скелетон нишон дода мешавад, баъд кортҳои воқеӣ", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { document } = loadPage("index.html", "script.js", {
      routes: (url, init) => {
        if (url === "/api/foods") return gate.then(() => json(200, MENU));
        return baseRoutes()(url, init);
      },
    });
    await waitFor(() => document.querySelector("#foodGrid .skeleton-card"));
    assert.equal(document.querySelectorAll("#foodGrid .food-card").length, 0, "скелетон синфи .food-card надорад (омехта намешавад)");
    release();
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    assert.equal(document.querySelectorAll("#foodGrid .skeleton-card").length, 0, "скелетонҳо пас аз боргирӣ тоза шуданд");
  });
});

describe("Phase B: сабад — нест кардан ва feedback (B4/B5)", () => {
  test("data-del маҳсулотро нест мекунад ва toast медиҳад; data-add pulse мегирад", async () => {
    const { document, window } = loadPage("index.html", "script.js", {
      storage: { oshonaCart: JSON.stringify([{ id: 1, qty: 2 }, { id: 2, qty: 1 }]) },
      routes: baseRoutes(),
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#cartBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const del = await waitFor(() => document.querySelector('[data-del="1"]'));
    del.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => !window.localStorage.getItem("oshonaCart").includes('"id":1'));
    assert.ok(window.localStorage.getItem("oshonaCart").includes('"id":2'), "маҳсулоти дигар боқӣ монд");
    assert.match(document.querySelector("#toast").textContent, /нест карда шуд/);

    const addBtn = document.querySelector('[data-add="1"]');
    addBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.ok(addBtn.classList.contains("pulse"), "feedback-и pulse");
  });

  test("ҳангоми фиристодани фармоиш тугма loading мешавад ва баъд барқарор", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let gotOrder = false;
    const { document, window } = loadPage("index.html", "script.js", {
      storage: { oshonaCart: JSON.stringify([{ id: 1, qty: 1 }]) },
      routes: baseRoutes({
        "/api/orders": () => gate.then(() => {
          gotOrder = true;
          return json(201, { id: 21, status: "NEW", paymentStatus: "CASH_ON_DELIVERY", paymentMethod: "cash", paymentCode: "OSH-T2", total: 68, currency: "TJS", items: [], accessToken: "tok_" + "q".repeat(30) });
        }),
      }),
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#checkoutBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const form = document.querySelector("#checkoutForm");
    form.elements.name.value = "Тест Loading";
    form.elements.phone.value = "+992 90 123 45 67";
    form.elements.method.value = "cash";
    const btn = document.querySelector("#checkoutSubmit");
    const original = btn.textContent;
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => btn.disabled === true);
    assert.match(btn.textContent, /фиристода мешавад/, "ҳолати loading");
    release();
    await waitFor(() => gotOrder && btn.disabled === false);
    assert.equal(btn.textContent, original, "матни тугма барқарор шуд");
  });
});

describe("Phase B: AI экран (B6)", () => {
  test("aiClear сӯҳбатро тоза мекунад ва саломро бармегардонад", async () => {
    const { document, window } = loadPage("index.html", "script.js", { routes: baseRoutes() });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#aiBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector("#aiLog .ai-msg"));
    const user = document.createElement("div");
    user.className = "ai-msg ai-user";
    user.textContent = "салом";
    document.querySelector("#aiLog").append(user);
    document.querySelector("#aiClear").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const msgs = document.querySelectorAll("#aiLog .ai-msg");
    assert.equal(msgs.length, 1, "танҳо салом боқӣ монд");
    assert.equal(msgs[0].classList.contains("ai-bot"), true);
    assert.match(document.querySelector("#toast").textContent, /тоза шуд/);
  });

  test("пас аз хатои AI тугмаи retry пайдо мешавад ва такроран дархост мекунад", async () => {
    let attempts = 0;
    const { document, window, calls } = loadPage("index.html", "script.js", {
      routes: baseRoutes({
        "/api/ai/chat": () => {
          attempts += 1;
          if (attempts === 1) return json(503, { error: "AI ҳозир дастнорас" });
          return json(200, { reply: "Тавсия: Паста", recommendations: [], notes: [], source: "rules" });
        },
      }),
    });
    await waitFor(() => document.querySelector("#foodGrid .food-card"));
    document.querySelector("#aiBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector("#aiLog .ai-msg"));
    document.querySelector("#aiInput").value = "чӣ бихӯрам?";
    document.querySelector("#aiForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    const retry = await waitFor(() => document.querySelector(".ai-retry"));
    assert.match(retry.textContent, /Аз нав/);
    assert.equal(calls.filter((c) => c.url === "/api/ai/chat").length, 1);
    retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => [...document.querySelectorAll("#aiLog .ai-msg p")].some((p) => /Тавсия: Паста/.test(p.textContent)));
    assert.equal(calls.filter((c) => c.url === "/api/ai/chat").length, 2, "retry дархости дуюм фиристод");
    assert.equal(document.querySelectorAll(".ai-retry").length, 0, "пахши хатогӣ тоза шуд");
  });
});

describe("Phase B: гардҳои статикӣ (B1/B2)", () => {
  test("style.css: токенҳои :root ва prefers-reduced-motion вуҷуд доранд", () => {
    const css = read("style.css");
    assert.ok(css.includes(":root{"), "токенҳо дар :root");
    for (const tok of ["--forest", "--green", "--cream", "--ink", "--muted"]) assert.ok(css.includes(tok + ":"), `токени ${tok}`);
    assert.ok(css.includes("prefers-reduced-motion"), "ҳимояи reduced motion");
    assert.ok(!/d6b675|d4b16d|8d682f/i.test(css), "палитраи тиллоӣ бо сабз иваз шуд");
  });

  test("index.html: рейтинги қалбакӣ нест; skip-link ва footer-и пурра ҳаст", () => {
    const html = read("index.html");
    assert.ok(!html.includes("4.9"), "рейтинги сохта нест");
    assert.ok(html.includes("skip-link"), "гузариш ба мундариҷа (a11y)");
    assert.ok(html.includes("footer-grid"), "footer-и касбӣ");
    assert.ok(html.includes('href="#"') === false || !/<a href="#">/.test(html), "линкҳои мурда нест");
  });

  test("seed: ҳамаи таомҳо акси худмизбон доранд", () => {
    const seed = JSON.parse(read("../seed/foods.json"));
    const items = seed.items || seed;
    for (const it of items) {
      assert.ok(it.image && it.image.startsWith("/img/"), `таоми ${it.id} акси локалӣ дорад`);
      assert.ok(fs.existsSync(path.join(PUBLIC, it.image)), `файли ${it.image} мавҷуд аст`);
    }
  });
});
