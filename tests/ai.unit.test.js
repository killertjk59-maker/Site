/**
 * Тестҳои воҳидии OpenRouter-клиент ва OSHONA AI (бо fetch-и сохта, бе шабакаи берунӣ).
 * Калиди ФЕЙК: sk-test-key-123 — ҳеҷ гоҳ ба лог ё ҷавоб намерасад.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createOpenRouterClient, AiError } = require("../src/ai/openrouter");
const assistant = require("../src/ai/assistant");
const nutritionLib = require("../src/nutrition");
const menu = require("../src/menu");

const FAKE_KEY = "sk-test-key-123";
const catalog = nutritionLib.loadIngredientCatalog(path.join(__dirname, "..", "seed", "ingredients.json"));

const okBody = (content, model = "m1") => JSON.stringify({ id: "x", model, choices: [{ message: { role: "assistant", content } }] });
const jsonRes = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** Скрипт барои fetch: ҳар даъват натиҷаи навбатиро бармегардонад (ё хато меандозад) */
function scriptedFetch(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, model: JSON.parse(init.body).model });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (typeof step === "function") return step(url, init);
    // Response-и шаблон бояд нусхабардорӣ шавад (бадан танҳо як бор хонда мешавад)
    return step instanceof Response ? step.clone() : step;
  };
  return { fetchImpl, calls };
}

const hangUntilAbort = (url, init) =>
  new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      reject(e);
    });
  });

function makeClient(over = {}) {
  const logs = [];
  const logger = {
    log: (...a) => logs.push(a.join(" ")),
    warn: (...a) => logs.push(a.join(" ")),
    error: (...a) => logs.push(a.join(" ")),
  };
  const sleeps = [];
  const { fetchImpl, calls } = over.fetchImpl ? { fetchImpl: over.fetchImpl, calls: over.calls } : scriptedFetch([jsonRes(200, okBody("ok"))]);
  const client = createOpenRouterClient({
    apiKey: FAKE_KEY,
    baseUrl: "https://fake.openrouter.test/api/v1",
    models: ["m1", "m2"],
    timeoutMs: 50,
    maxRetriesPerModel: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 4000,
    maxRetryAfterMs: 5000,
    dailyRequestLimit: 100,
    maxInputChars: 5000,
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0, // jitter = 50% → backoff(0)=250, backoff(1)=500
    logger,
    ...over.opts,
  });
  return { client, calls: over.calls || calls, sleeps, logs };
}

const MSG = [{ role: "user", content: "Чи хӯрам?" }];

describe("OpenRouter: муваффақият ва калид", () => {
  test("дархости муваффақ: model=m1, як даъват, калид танҳо дар Authorization", async () => {
    const { client, calls, sleeps, logs } = makeClient({
      fetchImpl: scriptedFetch([jsonRes(200, okBody("Салом"))]).fetchImpl,
    });
    const { fetchImpl, calls: c2 } = scriptedFetch([jsonRes(200, okBody("Салом"))]);
    const cl = createOpenRouterClient({ apiKey: FAKE_KEY, baseUrl: "https://f/api/v1", models: ["m1"], fetchImpl, sleep: async () => {}, logger: { log() {}, warn() {}, error() {} } });
    const out = await cl.chat({ messages: MSG });
    assert.equal(out.content, "Салом");
    assert.equal(out.model, "m1");
    assert.equal(c2.length, 1);
    assert.equal(c2[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
    const body = JSON.parse(c2[0].init.body);
    assert.equal(body.stream, false);
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 700, "max_tokens бояд маҳдуд бошад");
    void client; void calls; void sleeps; void logs;
  });

  test("калид ҳеҷ гоҳ дар лог ва хатогиҳо нест", async () => {
    const logs = [];
    const logger = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
    const { fetchImpl } = scriptedFetch([
      jsonRes(500, { error: { code: 500, message: `echo ${FAKE_KEY}` } }),
      jsonRes(500, { error: { code: 500, message: "boom" } }),
      jsonRes(500, { error: { code: 500, message: "boom" } }),
      jsonRes(200, okBody("ok", "m2")),
    ]);
    const cl = createOpenRouterClient({ apiKey: FAKE_KEY, models: ["m1", "m2"], maxRetriesPerModel: 2, fetchImpl, sleep: async () => {}, random: () => 0, logger });
    const out = await cl.chat({ messages: MSG });
    assert.equal(out.model, "m2");
    assert.ok(!logs.join("\n").includes(FAKE_KEY), "калид дар лог набояд бошад");
  });

  test("калиди холӣ → disabled (бе дархост)", async () => {
    const { fetchImpl, calls } = scriptedFetch([jsonRes(200, okBody("x"))]);
    const cl = createOpenRouterClient({ apiKey: "", models: ["m1"], fetchImpl });
    assert.equal(cl.enabled, false);
    await assert.rejects(cl.chat({ messages: MSG }), (e) => e instanceof AiError && e.code === "disabled");
    assert.equal(calls.length, 0);
  });
});

describe("OpenRouter: 429 / 5xx / timeout / холӣ", () => {
  test("429 → бозгашт бо backoff (250ms) → муваффақ", async () => {
    const { client, calls, sleeps } = makeClient({
      fetchImpl: scriptedFetch([jsonRes(429, { error: { code: 429, message: "rate" } }), jsonRes(200, okBody("баъд"))]).fetchImpl,
    });
    const out = await client.chat({ messages: MSG });
    assert.equal(out.content, "баъд");
    assert.equal(out.model, "m1");
    assert.deepEqual(sleeps, [250]);
    void calls;
  });

  test("429 бо Retry-After: 1 → интизории 1000ms", async () => {
    const { client, sleeps } = makeClient({
      fetchImpl: scriptedFetch([jsonRes(429, { error: { code: 429, message: "r" } }, { "Retry-After": "1" }), jsonRes(200, okBody("ok"))]).fetchImpl,
    });
    await client.chat({ messages: MSG });
    assert.deepEqual(sleeps, [1000]);
  });

  test("Retry-After аз ҳад зиёд (60s) → интизорӣ нест, модели навбатӣ", async () => {
    const sc = scriptedFetch([
      jsonRes(429, { error: { code: 429, message: "r" } }, { "Retry-After": "60" }),
      jsonRes(200, okBody("from m2", "m2")),
    ]);
    const { client, sleeps } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    const out = await client.chat({ messages: MSG });
    assert.equal(out.model, "m2");
    assert.deepEqual(sleeps, []);
    assert.deepEqual(sc.calls.map((c) => c.model), ["m1", "m2"]);
  });

  test("503 ҳамеша → 3 даъват ба m1, 3 ба m2, сипас unavailable", async () => {
    const sc = scriptedFetch([jsonRes(503, { error: { code: 503, message: "down" } })]);
    const { client, sleeps } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    await assert.rejects(client.chat({ messages: MSG }), (e) => e instanceof AiError && e.code === "unavailable");
    assert.equal(sc.calls.length, 6);
    assert.deepEqual(sc.calls.map((c) => c.model), ["m1", "m1", "m1", "m2", "m2", "m2"]);
    assert.deepEqual(sleeps, [250, 500, 250, 500], "backoff экспоненсиалӣ");
  });

  test("timeout → outcome=timeout, сипас модели навбатӣ", async () => {
    const sc = scriptedFetch([hangUntilAbort, hangUntilAbort, hangUntilAbort, jsonRes(200, okBody("m2 ok", "m2"))]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls, opts: { timeoutMs: 15 } });
    const out = await client.chat({ messages: MSG });
    assert.equal(out.model, "m2");
    assert.equal(out.content, "m2 ok");
    const timeouts = out.attempts.filter((a) => a.outcome === "timeout").length;
    assert.equal(timeouts, 3);
  });

  test("timeout ҳамеша → unavailable (бе ҳанг ва бе ҳадди нодуруст)", async () => {
    const sc = scriptedFetch([hangUntilAbort]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls, opts: { timeoutMs: 10 } });
    await assert.rejects(client.chat({ messages: MSG }), (e) => e instanceof AiError && (e.code === "unavailable" || e.code === "timeout"));
  });

  test("посухи холӣ (choices=[]) → empty; сипас муваффақ", async () => {
    const sc = scriptedFetch([jsonRes(200, { choices: [] }), jsonRes(200, okBody("ok2"))]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    const out = await client.chat({ messages: MSG });
    assert.equal(out.content, "ok2");
    assert.equal(out.attempts[0].outcome, "empty");
  });

  test("content-и холӣ/пробел → empty; ҳама холӣ → unavailable", async () => {
    const sc = scriptedFetch([jsonRes(200, okBody("   "))]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    await assert.rejects(client.chat({ messages: MSG }), (e) => e.code === "unavailable");
    assert.ok(sc.calls.length >= 2);
  });

  test("200 бо error дар бадана (429) → такрор", async () => {
    const sc = scriptedFetch([jsonRes(200, { error: { code: 429, message: "slow down" } }), jsonRes(200, okBody("ok3"))]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    const out = await client.chat({ messages: MSG });
    assert.equal(out.content, "ok3");
  });

  test("шабакаи вайроншуда (network error) → такрор ва модели навбатӣ", async () => {
    const sc = scriptedFetch([
      () => { throw new TypeError("fetch failed"); },
      () => { throw new TypeError("fetch failed"); },
      () => { throw new TypeError("fetch failed"); },
      jsonRes(200, okBody("m2", "m2")),
    ]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    const out = await client.chat({ messages: MSG });
    assert.equal(out.model, "m2");
  });
});

describe("OpenRouter: хатогиҳои қатъикунанда ва модели дастнорас", () => {
  test("401 → auth, бе такрор ва бе модели дигар", async () => {
    const sc = scriptedFetch([jsonRes(401, { error: { code: 401, message: "No auth credentials found" } })]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    await assert.rejects(client.chat({ messages: MSG }), (e) => e.code === "auth" && !e.message.includes(FAKE_KEY));
    assert.equal(sc.calls.length, 1);
  });

  test("402 → credits, бе такрор", async () => {
    const sc = scriptedFetch([jsonRes(402, { error: { code: 402, message: "Insufficient credits" } })]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    await assert.rejects(client.chat({ messages: MSG }), (e) => e.code === "credits");
    assert.equal(sc.calls.length, 1);
  });

  test("403 (модерация/фильтр) → blocked, бе такрор", async () => {
    const sc = scriptedFetch([jsonRes(403, { error: { code: 403, message: "Request blocked" } })]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    await assert.rejects(client.chat({ messages: MSG }), (e) => e.code === "blocked");
    assert.equal(sc.calls.length, 1);
  });

  test("404 (модели дастнорас) → фавран модели навбатӣ, бе такрор", async () => {
    const sc = scriptedFetch([jsonRes(404, { error: { code: 404, message: "No endpoints found" } }), jsonRes(200, okBody("m2", "m2"))]);
    const { client, sleeps } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls });
    const out = await client.chat({ messages: MSG });
    assert.equal(out.model, "m2");
    assert.equal(sleeps.length, 0);
    assert.deepEqual(sc.calls.map((c) => c.model), ["m1", "m2"]);
  });

  test("ҳадди рӯзонаи дархостҳо → quota бе fetch", async () => {
    const sc = scriptedFetch([jsonRes(200, okBody("ok"))]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls, opts: { dailyRequestLimit: 2 } });
    await client.chat({ messages: MSG });
    await client.chat({ messages: MSG });
    await assert.rejects(client.chat({ messages: MSG }), (e) => e.code === "quota");
    assert.equal(sc.calls.length, 2);
  });

  test("матни дарозтар аз ҳад → too_large бе fetch", async () => {
    const sc = scriptedFetch([jsonRes(200, okBody("ok"))]);
    const { client } = makeClient({ fetchImpl: sc.fetchImpl, calls: sc.calls, opts: { maxInputChars: 50 } });
    await assert.rejects(client.chat({ messages: [{ role: "user", content: "x".repeat(200) }] }), (e) => e.code === "too_large");
    assert.equal(sc.calls.length, 0);
  });
});

// ---------- OSHONA AI: қабати assistant ----------

const FOODS = [
  menu.normalizeFood({ id: 1, name: "Паста Трюфель", category: "Асосӣ", price: 68, description: "Паста бо пармезан", ingredients: [{ name: "Паста (пухта)", grams: 200 }, { name: "Пармезан", grams: 20 }], nutritionConfidence: "high" }),
  menu.normalizeFood({ id: 2, name: "Пицца Моцарелла", category: "Пицца", price: 90, ingredients: [{ name: "Моцарелла", grams: 120 }, { name: "Орди гандум", grams: 150 }], nutritionConfidence: "medium" }),
  menu.normalizeFood({ id: 3, name: "Салат Сезар", category: "Салат", price: 45, description: "Бо мурғ", ingredients: [{ name: "Салат (романо)", grams: 100 }, { name: "Сина (мурғ, пухта)", grams: 100 }], nutritionConfidence: "medium" }),
  menu.normalizeFood({ id: 4, name: "Таом бе таркиб", category: "Асосӣ", price: 30 }),
  menu.normalizeFood({ id: 5, name: "Оби газнок", category: "Нӯшокӣ", price: 15, ingredients: [{ name: "Оби газнок", grams: 300 }], nutritionConfidence: "medium" }),
];

const CONFIG = { currency: "TJS", ai: { maxUserMessageChars: 500, maxHistoryTurns: 4 } };

function fakeAi(contentOrError, { enabled = true } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      enabled,
      models: ["m1"],
      chat: async (args) => {
        calls.push(args);
        if (contentOrError instanceof Error) throw contentOrError;
        return { content: contentOrError, model: "m1", attempts: [] };
      },
    },
  };
}

const deps = (client) => ({ foods: FOODS, catalog, client, config: CONFIG, logger: { warn() {} } });

describe("OSHONA AI: санитизатсия ва тафтиш", () => {
  test("телефон ва email аз савол пок мешаванд", () => {
    const s = assistant.sanitizeUserText("Занг занед +992 90 123 45 67 ё mail@test.tj", 500);
    assert.ok(!/90\s?123/.test(s));
    assert.ok(s.includes("[телефон]") && s.includes("[email]"));
  });

  test("рақамҳои калория/макро аз меню тасдиқ мешаванд; тахминӣ пок мешаванд", () => {
    const allowed = new Set([402, 182]);
    const out = assistant.sanitizeNutritionClaims("Паста 402 ккал, салат 999 kcal, сафедаи 19.3 г белка", allowed);
    assert.ok(out.includes("402 ккал"));
    assert.ok(!out.includes("999"));
    assert.ok(out.includes("[рақам дар карточкаи таом]"));
  });

  test("JSON бо fence-и ```json таҳлил мешавад", () => {
    const p = assistant.parseModelOutput('```json\n{"reply":"Хуб","recommendations":[{"foodId":3,"reason":"мурғ"}]}\n```');
    assert.equal(p.parsed, true);
    assert.equal(p.reply, "Хуб");
    assert.equal(p.recs[0].foodId, 3);
  });

  test("матни озод (без JSON) ҳамчун reply гирифта мешавад", () => {
    const p = assistant.parseModelOutput("Салом, паста тавсия мекунам.");
    assert.equal(p.parsed, false);
    assert.equal(p.reply, "Салом, паста тавсия мекунам.");
  });

  test("validateRecommendations ID-ҳои номаълум ва такрорӣ рад мекунад", () => {
    const out = assistant.validateRecommendations(
      [{ foodId: 999 }, { foodId: 3, reason: "a" }, { foodId: 3, reason: "b" }, { foodId: "x" }],
      new Set([1, 2, 3])
    );
    assert.deepEqual(out.map((r) => r.foodId), [3]);
  });
});

describe("OSHONA AI: answerChat", () => {
  test("тавсия аз рӯйхати меню; ID-ҳои номаълум рад мешаванд", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "Ман паста тавсия медиҳам.", recommendations: [{ foodId: 999, reason: "x" }, { foodId: 1, reason: "таъми шумо" }] }));
    const r = await assistant.answerChat({ message: "Чи бихӯрам?" }, deps(ai.client));
    assert.equal(r.source, "ai");
    assert.deepEqual(r.recommendations.map((x) => x.foodId), [1]);
    assert.equal(r.recommendations[0].nutrition.calories, 402);
    assert.equal(r.recommendations[0].nutrition.source !== null, true);
    assert.match(r.disclaimer, /аллергия/i);
    // Паёми system барои модел: қоидаҳо ва меню
    const sys = ai.calls[0].messages[0].content;
    assert.match(sys, /ТОЛЬКО блюда из списка МЕНЮ/);
    const user = ai.calls[0].messages[ai.calls[0].messages.length - 1].content;
    assert.match(user, /"id":1/);
  });

  test("ҳисоби калория дар ҷавоби модел ҳаст, аммо рақами бегона нест", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "Паста 900 ккал дорад; салат 182 ккал.", recommendations: [{ foodId: 1 }, { foodId: 3 }] }));
    const r = await assistant.answerChat({ message: "Калория?" }, deps(ai.client));
    assert.ok(!r.reply.includes("900"));
    assert.ok(r.reply.includes("182 ккал"), "182 аз меню аст (17+165)");
  });

  test("телефон ба модел фиристода намешавад", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "ok", recommendations: [] }));
    await assistant.answerChat({ message: "Телефони ман +992 91 555 44 33, тавсия диҳед" }, deps(ai.client));
    const all = JSON.stringify(ai.calls[0].messages);
    assert.ok(!all.includes("555 44 33") && !all.includes("91 555"), "рақами телефон набояд ба модел бирасад");
    assert.ok(all.includes("[телефон]"));
  });

  test("аллергия: таом бо шир ва таом бе таркиб барои тавсия намеоянд", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "ok", recommendations: [{ foodId: 1 }, { foodId: 2 }, { foodId: 4 }, { foodId: 3 }] }));
    const r = await assistant.answerChat({ message: "Тавсия", preferences: { avoid: ["шир"] } }, deps(ai.client));
    const ids = r.recommendations.map((x) => x.foodId);
    assert.ok(!ids.includes(1), "паста бо пармезан (шир) — рад");
    assert.ok(!ids.includes(2), "пицца бо моцарелла (шир) — рад");
    assert.ok(!ids.includes(4), "таоми бе таркиб — рад");
    assert.deepEqual(ids, [3]);
    assert.ok(r.notes.some((n) => /истисно|аллергия|таркиб/i.test(n)));
  });

  test("буҷет: таомҳо аз буҷет зиёд нестанд", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "ok", recommendations: [] }));
    await assistant.answerChat({ message: "Тавсия", preferences: { budget: 50 } }, deps(ai.client));
    const user = ai.calls[0].messages[ai.calls[0].messages.length - 1].content;
    const menuJson = JSON.parse(user.match(/МЕНЮ[^:]*: (\[.*?\])\n/)[1]);
    assert.ok(menuJson.every((m) => m.price <= 50));
    assert.deepEqual(menuJson.map((m) => m.id).sort(), [3, 4, 5]);
  });

  test("наврас (15 сол): калорияҳо пок мешаванд; ҳадафи лоғаршавӣ манъ; огоҳӣ", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "Паста 402 ккал барои шумо хуб аст.", recommendations: [{ foodId: 3 }] }));
    const r = await assistant.answerChat({ message: "Ман 15 сол ҳастам, калория кам мехоҳам", preferences: { goal: "light" } }, deps(ai.client));
    assert.ok(!r.reply.includes("402"), "барои наврас рақами калория набояд бошад");
    assert.match(ai.calls[0].messages[0].content, /ВНИМАНИЕ/);
    assert.ok(r.notes.some((n) => /наврасон|лоғаршав/i.test(n)));
  });

  test("хостани лоғаршавӣ: ҷавоб ҳадди калория надорад", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "Барои лоғарӣ 1200 ккал бихӯред.", recommendations: [{ foodId: 3 }] }));
    const r = await assistant.answerChat({ message: "Хочу похудеть, сколько калорий есть?" }, deps(ai.client));
    assert.ok(!r.reply.includes("1200"));
  });

  test("AI дастнорас → source=rules, notice, тавсияҳои қоидавӣ", async () => {
    const { AiError: E } = require("../src/ai/openrouter");
    const ai = fakeAi(new E("unavailable", "down"));
    const r = await assistant.answerChat({ message: "Тавсия", preferences: { tastes: ["гӯшт"] } }, deps(ai.client));
    assert.equal(r.source, "rules");
    assert.ok(r.notice && r.notice.length > 10);
    assert.ok(r.recommendations.length > 0);
  });

  test("ҳадди рӯзона → source=rules бо паёми дуруст", async () => {
    const { AiError: E } = require("../src/ai/openrouter");
    const ai = fakeAi(new E("quota", "quota"));
    const r = await assistant.answerChat({ message: "Тавсия" }, deps(ai.client));
    assert.equal(r.source, "rules");
    assert.match(r.notice, /ҳадди/);
  });

  test("AI хомӯш аст → модел даъват намешавад", async () => {
    const ai = fakeAi("unused", { enabled: false });
    const r = await assistant.answerChat({ message: "Тавсия" }, deps(ai.client));
    assert.equal(r.source, "rules");
    assert.equal(ai.calls.length, 0);
  });

  test("ҷавоби матнии модел (бе JSON) — reply мешавад; тавсияҳо қоидавӣ", async () => {
    const ai = fakeAi("Пешниҳод: салат бо мурғ.");
    const r = await assistant.answerChat({ message: "Тавсия" }, deps(ai.client));
    assert.equal(r.source, "ai");
    assert.equal(r.reply, "Пешниҳод: салат бо мурғ.");
    assert.ok(r.recommendations.length > 0);
  });

  test("таърих кӯтоҳ карда мешавад (ҳадди maxHistoryTurns)", async () => {
    const ai = fakeAi(JSON.stringify({ reply: "ok", recommendations: [] }));
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `msg ${i}` }));
    await assistant.answerChat({ message: "Тавсия", history }, deps(ai.client));
    // system + ≤4 таърих + user
    assert.ok(ai.calls[0].messages.length <= 6);
  });
});
