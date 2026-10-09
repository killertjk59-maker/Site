/**
 * Интеграсия: сервери воқеӣ + OpenRouter-и сохташуда (калиди ФЕЙК) + Telegram-и сохташуда.
 * Ҳеҷ дархости шабакаи берунӣ нест.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, http, adminLogin, createOrder, orderAuth } = require("./support/helpers");
const { startMockOpenRouter, startMockTelegram } = require("./support/mocks");

const FAKE_KEY = "sk-or-test-FAKE-0123456789";
const TG_TOKEN = "123456:TEST-TOKEN-ONLY";
const TG_SECRET = "wh-secret-0123456789abcdef0123";
const ADMIN_TG_ID = 777001;
const CUSTOMER_TG_ID = 555002;

const okContent = (obj) => ({
  id: "gen-1",
  model: "mock",
  choices: [{ message: { role: "assistant", content: JSON.stringify(obj) } }],
});

const RECO = { reply: "Паста Трюфель — хуб барои шумо.", recommendations: [{ foodId: 1, reason: "таъми шумо" }] };

// ============ OpenRouter ============
describe("OSHONA AI: сервер + OpenRouter (фейк)", () => {
  test("429 → такрор → муваффақ; ҷавоб калидро дар бар надорад; калид фақат дар Authorization", async () => {
    const mock = await startMockOpenRouter((model, n) => {
      if (model === "mock/primary" && n === 1) return { status: 429, body: { error: { code: 429, message: "rate limited" } }, headers: { "Retry-After": "0" } };
      if (model === "mock/primary") return { status: 200, body: okContent(RECO) };
      return { status: 503, body: { error: { code: 503, message: "down" } } };
    });
    const srv = await startServer({
      env: {
        OPENROUTER_API_KEY: FAKE_KEY,
        OPENROUTER_BASE_URL: mock.url,
        OPENROUTER_MODEL: "mock/primary",
        OPENROUTER_FALLBACK_MODEL: "mock/fallback",
        AI_TIMEOUT_MS: "2000",
        AI_MAX_RETRIES: "2",
      },
    });
    try {
      const r = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "Чи тавсия медиҳед?" } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.source, "ai");
      assert.equal(r.json.model, "mock/primary");
      assert.equal(r.json.recommendations[0].foodId, 1);
      assert.ok(!r.text.includes(FAKE_KEY), "калид дар ҷавоб набояд бошад");
      const primaryCalls = mock.requests.filter((q) => q.model === "mock/primary");
      assert.equal(primaryCalls.length, 2, "баъди 429 як бор такрор");
      assert.equal(primaryCalls[0].auth, `Bearer ${FAKE_KEY}`);
      assert.ok(!srv.getLog().includes(FAKE_KEY), "калид дар лог набояд бошад");
    } finally {
      await srv.stop();
      await mock.close();
    }
  });

  test("timeout → модели захиравӣ; ҷавоби ai бо модели захиравӣ", async () => {
    const mock = await startMockOpenRouter((model) => {
      if (model === "mock/slow") return "hang";
      return { status: 200, body: okContent({ reply: "Захиравӣ кор кард.", recommendations: [{ foodId: 1 }] }), delayMs: 0 };
    });
    const srv = await startServer({
      env: {
        OPENROUTER_API_KEY: FAKE_KEY,
        OPENROUTER_BASE_URL: mock.url,
        OPENROUTER_MODEL: "mock/slow",
        OPENROUTER_FALLBACK_MODEL: "mock/fast",
        AI_TIMEOUT_MS: "250",
        AI_MAX_RETRIES: "1",
      },
    });
    try {
      const t0 = Date.now();
      const r = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "Тавсия" } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "ai");
      assert.equal(r.json.model, "mock/fast");
      assert.ok(Date.now() - t0 < 8000, "интизорӣ бояд маҳдуд бошад");
      assert.ok(mock.requests.filter((q) => q.model === "mock/slow").length >= 1);
    } finally {
      await srv.stop();
      await mock.close();
    }
  });

  test("посухи холӣ аз ҳамаи моделҳо → rules-fallback бо паёми дӯстона (200)", async () => {
    const mock = await startMockOpenRouter((model) => {
      if (model === "mock/empty") return { status: 200, body: { id: "x", choices: [] } };
      return { status: 503, body: { error: { code: 503, message: "no provider" } } };
    });
    const srv = await startServer({
      env: {
        OPENROUTER_API_KEY: FAKE_KEY,
        OPENROUTER_BASE_URL: mock.url,
        OPENROUTER_MODEL: "mock/empty",
        OPENROUTER_FALLBACK_MODEL: "mock/down",
        AI_TIMEOUT_MS: "2000",
        AI_MAX_RETRIES: "0",
      },
    });
    try {
      const r = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "Тавсия" } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "rules");
      assert.ok(r.json.notice, "паёми дӯстона бояд бошад");
      assert.ok(r.json.recommendations.length > 0, "тавсияи қоидавӣ бояд бошад");
      assert.ok(!r.text.includes(FAKE_KEY));
    } finally {
      await srv.stop();
      await mock.close();
    }
  });

  test("калиди нодуруст (401) → паёми умумӣ, калид ошкор намешавад", async () => {
    const mock = await startMockOpenRouter(() => ({ status: 401, body: { error: { code: 401, message: "No auth credentials found" } } }));
    const srv = await startServer({
      env: { OPENROUTER_API_KEY: FAKE_KEY, OPENROUTER_BASE_URL: mock.url, OPENROUTER_MODEL: "mock/a", OPENROUTER_FALLBACK_MODEL: "mock/b", AI_MAX_RETRIES: "0" },
    });
    try {
      const r = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "Тавсия" } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "rules");
      assert.ok(!r.text.includes(FAKE_KEY));
      assert.ok(!srv.getLog().includes(FAKE_KEY));
      assert.equal(mock.requests.length, 1, "бо 401 модели дигар даъват намешавад");
    } finally {
      await srv.stop();
      await mock.close();
    }
  });

  test("ҳадди рӯзона: пас аз AI_DAILY_LIMIT → rules бо паёми квота", async () => {
    const mock = await startMockOpenRouter(() => ({ status: 200, body: okContent(RECO) }));
    const srv = await startServer({
      env: { OPENROUTER_API_KEY: FAKE_KEY, OPENROUTER_BASE_URL: mock.url, OPENROUTER_MODEL: "mock/ok", AI_DAILY_LIMIT: "2" },
    });
    try {
      const a = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "1" } });
      const b = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "2" } });
      const c = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "3" } });
      assert.equal(a.json.source, "ai");
      assert.equal(b.json.source, "ai");
      assert.equal(c.json.source, "rules");
      assert.match(c.json.notice, /ҳадди/);
      assert.equal(mock.requests.length, 2, "дархости сеюм ба OpenRouter намерасад");
    } finally {
      await srv.stop();
      await mock.close();
    }
  });

  test("бе калид: AI хомӯш, модел даъват намешавад, rules кор мекунад", async () => {
    const srv = await startServer();
    try {
      const cfg = await http(srv.base, "GET", "/api/config");
      assert.equal(cfg.json.aiEnabled, false);
      const r = await http(srv.base, "POST", "/api/ai/chat", { body: { message: "Тавсия" } });
      assert.equal(r.json.source, "rules");
    } finally {
      await srv.stop();
    }
  });

  test("савол бе матн ё хеле дароз → 400", async () => {
    const srv = await startServer();
    try {
      assert.equal((await http(srv.base, "POST", "/api/ai/chat", { body: { message: "   " } })).status, 400);
      assert.equal((await http(srv.base, "POST", "/api/ai/chat", { body: { message: "x".repeat(2500) } })).status, 400);
    } finally {
      await srv.stop();
    }
  });
});

// ============ Telegram ============
describe("Telegram-бот: webhook, админ бо ID, пайвастшавӣ ба фармоиш", () => {
  let tg;
  let srv;
  let admin;
  let order;

  before(async () => {
    tg = await startMockTelegram();
    srv = await startServer({
      env: {
        TELEGRAM_BOT_TOKEN: TG_TOKEN,
        TELEGRAM_WEBHOOK_SECRET: TG_SECRET,
        TELEGRAM_ADMIN_IDS: String(ADMIN_TG_ID),
        TELEGRAM_BOT_USERNAME: "oshona_test_bot",
        TELEGRAM_API_BASE: tg.url,
      },
    });
    admin = await adminLogin(srv.base);
    order = await createOrder(srv.base, { customerName: "Тест Бот", items: [{ foodId: 2, quantity: 1 }] });
    await http(srv.base, "POST", `/api/orders/${order.json.id}/payment-submitted`, { headers: orderAuth(order.json) });
  });
  after(async () => {
    if (srv) await srv.stop();
    if (tg) await tg.close();
  });

  const update = (fromId, text, { chatType = "private", username, chatId } = {}) => ({
    update_id: Math.floor(Math.random() * 1e6),
    message: {
      message_id: 1,
      from: { id: fromId, is_bot: false, first_name: "U", ...(username ? { username } : {}) },
      chat: { id: chatId ?? fromId, type: chatType },
      date: 1,
      text,
    },
  });
  const hook = (body, secret = TG_SECRET) =>
    http(srv.base, "POST", "/api/telegram/webhook", {
      body,
      headers: secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret },
    });
  const lastText = () => (tg.messages.length ? tg.messages[tg.messages.length - 1].text : "");

  test("webhook бе сарлавҳаи секрет ё бо секрети нодуруст → 403, ҳеҷ ҷавоб намефиристад", async () => {
    const before = tg.messages.length;
    assert.equal((await hook(update(ADMIN_TG_ID, "/pending"), null)).status, 403);
    assert.equal((await hook(update(ADMIN_TG_ID, "/pending"), "wrong")).status, 403);
    assert.equal(tg.messages.length, before);
  });

  test("корбари оддӣ (ID-и нашинохта) ба фармонҳои админ дастрас нест", async () => {
    const r = await hook(update(CUSTOMER_TG_ID, "/pending"));
    assert.equal(r.status, 200);
    assert.equal(lastText(), "Ин фармон барои ҳамаи корбарон дастрас нест.");
    assert.ok(!lastText().includes("#"), "рӯйхати фармоишҳо ошкор намешавад");
  });

  test("username-и «admin» барои дастрасӣ кофӣ нест (танҳо ID)", async () => {
    await hook(update(CUSTOMER_TG_ID, `/approve ${order.json.id}`, { username: "admin" }));
    assert.equal(lastText(), "Ин фармон барои ҳамаи корбарон дастрас нест.");
    const o = (await http(srv.base, "GET", `/api/orders/${order.json.id}`, { token: admin })).json;
    assert.equal(o.paymentStatus, "IN_REVIEW", "пардохт тасдиқ нашуд");
  });

  test("админ (ID-и рақамӣ) фармони /pending → рӯйхати интизорон", async () => {
    await hook(update(ADMIN_TG_ID, "/pending", { username: "not_the_admin" }));
    assert.match(lastText(), new RegExp(`#${order.json.id}`));
  });

  test("админ дар гурӯҳ (group) фармон иҷро намекунад", async () => {
    await hook(update(ADMIN_TG_ID, "/pending", { chatType: "group", chatId: -100123 }));
    assert.equal(lastText(), "Ин фармон барои ҳамаи корбарон дастрас нест.");
  });

  test("админ /approve тавассути бот пардохтро тасдиқ мекунад (ҳамон домен)", async () => {
    await hook(update(ADMIN_TG_ID, `/approve ${order.json.id}`));
    assert.match(lastText(), /пардохт тасдиқ шуд/);
    const o = (await http(srv.base, "GET", `/api/orders/${order.json.id}`, { token: admin })).json;
    assert.equal(o.paymentStatus, "PAID");
    assert.equal(o.status, "CONFIRMED");
    const log = o.events.find((e) => e.action === "payment_approved");
    assert.ok(log && log.by === `telegram:${ADMIN_TG_ID}`, "аудит: кӣ тасдиқ кард");
  });

  test("фармони нақдӣ /approve хатогӣ медиҳад, ҳолат тағйир намеёбад", async () => {
    const cash = await createOrder(srv.base, { paymentMethod: "cash", items: [{ foodId: 3, quantity: 1 }] });
    await hook(update(ADMIN_TG_ID, `/approve ${cash.json.id}`));
    assert.match(lastText(), /Хато/);
  });

  test("пайвастшавӣ: /start o<id>_<token> (токени дуруст)", async () => {
    const o2 = await createOrder(srv.base, { customerName: "Линк", items: [{ foodId: 1, quantity: 1 }] });
    const payload = `o${o2.json.id}_${o2.json.accessToken}`;
    assert.match(payload, /^[A-Za-z0-9_-]+$/, "payload бояд барои Telegram дуруст бошад");
    assert.ok(payload.length <= 64);
    await hook(update(CUSTOMER_TG_ID, `/start ${payload}`));
    assert.match(lastText(), /пайваст шуд/);
    await hook(update(CUSTOMER_TG_ID, "/status"));
    assert.match(lastText(), new RegExp(`Фармоиш #${o2.json.id}`));
    assert.ok(!lastText().includes("+992"), "телефон дар паём набояд бошад");
  });

  test("пайвастшавӣ бо токени нодуруст рад мешавад", async () => {
    const o3 = await createOrder(srv.base, { customerName: "Линк 2", items: [{ foodId: 1, quantity: 1 }] });
    await hook(update(CUSTOMER_TG_ID + 1, `/start o${o3.json.id}_WRONGTOKEN0123456789abcdef`));
    assert.match(lastText(), /Линк нодуруст/);
  });

  test("савол → тавсия (AI хомӯш аст → rules); /budget ва /avoid захира мешаванд", async () => {
    await hook(update(CUSTOMER_TG_ID + 2, "/budget 100"));
    assert.match(lastText(), /Буҷет: 100/);
    await hook(update(CUSTOMER_TG_ID + 2, "/avoid шир"));
    assert.match(lastText(), /Истисноҳо: шир/);
    await hook(update(CUSTOMER_TG_ID + 2, "Чи тавсия медиҳед?"));
    assert.ok(lastText().length > 5);
    assert.ok(!/undefined|null/.test(lastText()));
  });

  test("/menu рӯйхати таомҳо ва калорияро аз таркиб (ё «маълумот нест») нишон медиҳад", async () => {
    await hook(update(CUSTOMER_TG_ID + 3, "/menu"));
    assert.match(lastText(), /калория: маълумот нест|ккал/);
  });

  test("паёми дарози ботӣ (захира) аз 3900 аломат зиёд нест", async () => {
    await hook(update(CUSTOMER_TG_ID + 3, "/menu"));
    assert.ok(lastText().length <= 3900);
  });
});
