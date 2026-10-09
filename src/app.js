"use strict";

/**
 * Сохтани Express-app: ҳамаи роҳҳо, амният, ва пайвастани домен/нигоҳдорӣ.
 * Сайт, админ ва Telegram-бот аз як backend ва як маълумоти нигоҳдорӣ истифода мебаранд.
 */
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const express = require("express");

const sec = require("./security");
const v = require("./validation");
const menu = require("./menu");
const promosLib = require("./promos");
const ordersLib = require("./orders");
const payments = require("./payments");
const reports = require("./reports");
const forecast = require("./forecast");
const uploads = require("./uploads");
const nutrition = require("./nutrition");
const { JsonStore } = require("./storage");
const { createOpenRouterClient } = require("./ai/openrouter");
const assistant = require("./ai/assistant");
const { normalizePreferences } = require("./preferences");
const { rankFoods } = require("./recommend");
const { createTelegramBot } = require("./telegram");
const { dayKey, startOfTodayMs, toIdList } = require("./util");

const { HttpError } = sec;

const FILE_FOR = {
  foods: "foods.json",
  orders: "orders.json",
  reservations: "reservations.json",
  promos: "promos.json",
  telegram: "telegram.json",
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 1e12 ? n : null;
}

function nextId(list) {
  return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
}

function parseTrustProxy(value) {
  const s = String(value);
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "true") return true;
  if (s === "false" || s === "") return false;
  return s;
}

function loadSeed(seedDir, file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(seedDir, file), "utf8"));
  } catch {
    return fallback;
  }
}

function createApp(config, { logger = console, fetchImpl = globalThis.fetch, clock = () => Date.now() } = {}) {
  // ---------------- Нигоҳдорӣ ----------------
  const store = new JsonStore(config.dataDir);
  store.cleanupTempFiles();
  const uploadDir = path.join(config.dataDir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });

  const catalog = nutrition.loadIngredientCatalog(path.join(config.seedDir, "ingredients.json"));

  const state = {
    foods: [],
    orders: [],
    reservations: [],
    promos: [],
    telegram: { chats: {} },
  };

  // Агар файли ҳолат нест — аз seed нусхабардорӣ мешавад (нусхаи намунавии меню бо demo:true)
  const seedFoods = loadSeed(config.seedDir, "foods.json", []);
  const seedPromos = loadSeed(config.seedDir, "promos.json", []);
  state.foods = store.read(FILE_FOR.foods, seedFoods).map(menu.normalizeFood);
  state.orders = store.read(FILE_FOR.orders, []);
  state.reservations = store.read(FILE_FOR.reservations, []);
  state.promos = store.read(FILE_FOR.promos, seedPromos).map(promosLib.normalizePromo);
  state.telegram = store.read(FILE_FOR.telegram, { chats: {} });
  if (!state.telegram.chats) state.telegram.chats = {};
  for (const name of Object.keys(FILE_FOR)) {
    if (!fs.existsSync(store.filePath(FILE_FOR[name]))) store.write(FILE_FOR[name], state[name]);
  }

  /**
   * Тағйири ҳолат бо навиштани атомӣ. Агар навиштан иҷро нашавад,
   * ҳолати хотира ба ҳолати пеш бармегардад (нусхаи пешина).
   */
  function mutate(keys, fn) {
    const snapshots = {};
    for (const k of keys) snapshots[k] = structuredClone(state[k]);
    try {
      const result = fn();
      for (const k of keys) store.write(FILE_FOR[k], state[k]);
      return result;
    } catch (err) {
      for (const k of keys) state[k] = snapshots[k];
      throw err;
    }
  }

  // ---------------- AI / Telegram ----------------
  const aiClient = createOpenRouterClient({
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
    models: [config.ai.primaryModel, ...config.ai.fallbackModels].filter(Boolean),
    timeoutMs: config.ai.timeoutMs,
    maxRetriesPerModel: config.ai.maxRetriesPerModel,
    baseBackoffMs: config.ai.baseBackoffMs,
    maxBackoffMs: config.ai.maxBackoffMs,
    maxRetryAfterMs: config.ai.maxRetryAfterMs,
    maxOutputTokens: config.ai.maxOutputTokens,
    temperature: config.ai.temperature,
    dailyRequestLimit: config.ai.dailyRequestLimit,
    fetchImpl,
    logger,
    now: clock,
  });

  const answerDeps = { foods: state.foods, catalog, client: aiClient, config, logger };
  const answerAi = (args) => assistant.answerChat(args, { ...answerDeps, foods: state.foods });

  // ---------------- Express ----------------
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", parseTrustProxy(config.trustProxy));
  app.use(sec.securityHeaders({ production: config.production }));
  app.use(corsMiddleware(config.corsOrigins));
  app.use(express.json({ limit: "64kb" }));

  const auth = sec.createAuth({ jwtSecret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const { requireAdmin, verifyAdminToken, bearer } = auth;
  // Пароли админ ҳамеша бо bcrypt муқоиса мешавад (агар ADMIN_PASSWORD-и матнӣ бошад — дар хотира ҳашиш мешавад)
  const adminHash = config.adminPasswordHash || bcrypt.hashSync(config.adminPassword, 10);

  const limit = (name, max, windowMs, message) =>
    sec.createRateLimiter({
      name,
      max: Math.max(1, Math.round(max * config.rateLimitScale)),
      windowMs,
      message,
    });
  const loginLimiter = limit("login", 10, 15 * 60 * 1000, "Кӯшишҳои вуруд аз ҳад зиёд. Баъд аз 15 дақиқа кӯшиш кунед.");
  const orderLimiter = limit("order", 20, 60 * 1000);
  const paymentLimiter = limit("paysub", 30, 60 * 1000);
  const reservationLimiter = limit("reserv", 10, 60 * 1000);
  const promoLimiter = limit("promo", 60, 60 * 1000);
  const aiLimiter = limit("ai", 12, 60 * 1000, "Саволҳо зуд-зуд аст. Каме интизор шавед.");
  const recLimiter = limit("rec", 60, 60 * 1000);
  const uploadLimiter = limit("upload", 30, 60 * 1000);
  const webhookLimiter = limit("tgwh", 300, 60 * 1000);

  /**
   * Дастрасӣ ба фармоиш: админ (JWT) ё токени фармоиш (X-Order-Token).
   * Номаълум ва нодуруст → 404 (барои пинҳон кардани мавҷудияти фармоиш).
   */
  function resolveOrderAccess(req) {
    const id = parseId(req.params.id);
    // ID-и нодуруст (масалан, «by-phone») — фавран 404, бе санҷиши токен
    if (!id) throw new HttpError(404, "Фармоиш ёфт нашуд.", "NOT_FOUND");
    const order = state.orders.find((o) => o.id === id) || null;
    const claims = verifyAdminToken(bearer(req) || "");
    if (claims) {
      if (!order) throw new HttpError(404, "Фармоиш ёфт нашуд.", "NOT_FOUND");
      return { order, role: "admin", actor: `admin:${claims.username}` };
    }
    const token = req.get("X-Order-Token");
    if (!token) throw new HttpError(401, "Токени фармоиш лозим аст.", "ORDER_TOKEN_REQUIRED");
    if (order && order.accessTokenHash && sec.safeEqualHex(sec.hashToken(token), order.accessTokenHash)) {
      return { order, role: "customer", actor: "customer" };
    }
    throw new HttpError(404, "Фармоиш ёфт нашуд.", "NOT_FOUND");
  }

  const viewFor = (role, order) => (role === "admin" ? ordersLib.adminView(order) : ordersLib.customerView(order));

  // ===== Health / config =====
  app.get("/api/health", (req, res) => res.json({ ok: true, version: config.version }));
  app.get("/api/config", (req, res) =>
    res.json({
      currency: config.currency,
      aiEnabled: aiClient.enabled,
      telegramBotUsername: config.telegram.botUsername || null,
      version: config.version,
    })
  );

  // ===== Вуруди админ =====
  app.post(
    "/api/auth/login",
    loginLimiter,
    asyncHandler(async (req, res) => {
      const b = req.body && typeof req.body === "object" ? req.body : {};
      const username = typeof b.username === "string" ? b.username.slice(0, 100) : "";
      const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
      const userOk = sec.safeEqualString(username, config.adminUsername);
      const passOk = password ? await bcrypt.compare(password, adminHash) : false;
      if (!(userOk && passOk)) {
        logger.warn("[auth] вуруди нодуруст");
        throw new HttpError(401, "Логин ё парол нодуруст аст.", "AUTH_FAILED");
      }
      res.json({ token: auth.signAdmin(config.adminUsername), username: config.adminUsername, expiresIn: config.jwtExpiresIn });
    })
  );

  // ===== Меню (ҷамъиятӣ) =====
  app.get("/api/foods", (req, res) =>
    res.json(state.foods.filter((f) => f.available !== false).map((f) => menu.publicFood(f, catalog)))
  );
  app.get("/api/foods/:id", (req, res, next) => {
    const id = parseId(req.params.id);
    const food = id ? state.foods.find((f) => f.id === id && f.available !== false) : null;
    if (!food) return next(new HttpError(404, "Таом ёфт нашуд.", "NOT_FOUND"));
    return res.json(menu.publicFood(food, catalog));
  });

  // ===== Меню (админ) =====
  app.get("/api/admin/foods", requireAdmin, (req, res) => res.json(state.foods.map((f) => menu.adminFood(f, catalog))));
  app.post("/api/foods", requireAdmin, (req, res) => {
    const data = menu.validateFoodInput(req.body, { partial: false });
    const now = new Date(clock()).toISOString();
    const food = menu.normalizeFood({
      ...data,
      id: nextId(state.foods),
      createdAt: now,
      updatedAt: now,
    });
    mutate(["foods"], () => state.foods.push(food));
    res.status(201).json(menu.adminFood(food, catalog));
  });
  app.put("/api/foods/:id", requireAdmin, (req, res, next) => {
    const id = parseId(req.params.id);
    const food = id ? state.foods.find((f) => f.id === id) : null;
    if (!food) return next(new HttpError(404, "Таом ёфт нашуд.", "NOT_FOUND"));
    const data = menu.validateFoodInput(req.body, { partial: true });
    mutate(["foods"], () => {
      Object.assign(food, data, { updatedAt: new Date(clock()).toISOString() });
    });
    res.json(menu.adminFood(food, catalog));
  });
  app.delete("/api/foods/:id", requireAdmin, (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id || !state.foods.some((f) => f.id === id)) return next(new HttpError(404, "Таом ёфт нашуд.", "NOT_FOUND"));
    mutate(["foods"], () => {
      state.foods = state.foods.filter((f) => f.id !== id);
    });
    res.json({ ok: true });
  });

  // ===== Боркунии расм (админ) =====
  app.post("/api/upload", requireAdmin, uploadLimiter, uploads.createUploadMiddleware(), (req, res) => {
    if (!req.file) throw new HttpError(400, "Расм интихоб нашудааст.", "UPLOAD_EMPTY");
    const saved = uploads.saveValidatedImage(req.file.buffer, uploadDir);
    res.status(201).json({ url: saved.url, size: saved.size, mime: saved.mime });
  });

  // ===== Фармоишҳо =====
  app.post(
    "/api/orders",
    orderLimiter,
    asyncHandler(async (req, res) => {
      const { order, accessToken } = ordersLib.buildOrder(req.body, {
        foods: state.foods,
        promos: state.promos,
        config,
        idForNew: nextId(state.orders),
        codeExists: (c) => state.orders.some((o) => o.paymentCode === c),
        actor: "customer",
        now: clock(),
      });
      mutate(["orders", "promos"], () => {
        state.orders.unshift(order);
        if (order.promo) {
          const p = state.promos.find((x) => x.code === order.promo);
          if (p) p.uses = (Number(p.uses) || 0) + 1;
        }
      });
      const paymentInstructions = order.paymentMethod === "online"
        ? await payments.buildPaymentInstructions(order, config)
        : null;
      const telegramLink = config.telegram.botUsername
        ? `https://t.me/${config.telegram.botUsername}?start=o${order.id}_${accessToken}`
        : null;
      res.status(201).json({
        ...ordersLib.customerView(order),
        accessToken,
        paymentInstructions,
        telegramLink,
      });
    })
  );

  app.get("/api/orders", requireAdmin, (req, res) => res.json(state.orders.map(ordersLib.adminView)));

  app.get("/api/orders/:id", (req, res) => {
    const { order, role } = resolveOrderAccess(req);
    res.json(viewFor(role, order));
  });

  app.get(
    "/api/orders/:id/pay-info",
    asyncHandler(async (req, res) => {
      const { order } = resolveOrderAccess(req);
      if (order.paymentMethod !== "online") throw new HttpError(400, "Ин фармоиш нақдӣ аст.", "NOT_ONLINE");
      const paymentInstructions = await payments.buildPaymentInstructions(order, config);
      res.json({
        orderId: order.id,
        total: order.total,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
        paymentInstructions,
      });
    })
  );

  app.post("/api/orders/:id/payment-submitted", paymentLimiter, (req, res) => {
    const { order, role, actor } = resolveOrderAccess(req);
    mutate(["orders"], () => ordersLib.submitPayment(order, actor));
    res.json(viewFor(role, order));
  });

  app.post("/api/orders/:id/approve-payment", requireAdmin, (req, res) => {
    const { order, actor } = resolveOrderAccess(req);
    mutate(["orders"], () => ordersLib.approvePayment(order, actor));
    res.json(ordersLib.adminView(order));
  });

  app.post("/api/orders/:id/reject-payment", requireAdmin, (req, res) => {
    const { order, actor } = resolveOrderAccess(req);
    const reason = v.str((req.body || {}).reason, { field: "Сабаб", max: 200 });
    mutate(["orders"], () => ordersLib.rejectPayment(order, actor, reason));
    res.json(ordersLib.adminView(order));
  });

  app.patch("/api/orders/:id/status", requireAdmin, (req, res) => {
    const { order, actor } = resolveOrderAccess(req);
    const status = (req.body || {}).status;
    if (typeof status !== "string") throw new HttpError(400, "Статус нодуруст.", "BAD_STATUS");
    mutate(["orders"], () => ordersLib.setStatus(order, status, actor));
    res.json(ordersLib.adminView(order));
  });

  // ===== Бронкунии миз =====
  app.post("/api/reservations", reservationLimiter, (req, res) => {
    const b = v.object(req.body);
    const name = v.str(b.name, { field: "Ном", required: true, min: 2, max: 80 });
    const phone = v.phone(b.phone, { field: "Телефон", required: true });
    const today = dayKey(clock(), config.timezoneOffsetHours);
    const date = v.isoDate(b.date, { field: "Сана", required: true });
    if (date < today) throw v.fail("Сана", "дар гузашта набояд бошад");
    const maxDate = dayKey(clock() + 180 * 86400000, config.timezoneOffsetHours);
    if (date > maxDate) throw v.fail("Сана", "то 180 рӯз пеш қабул мешавад");
    const time = v.timeHHMM(b.time, { field: "Вақт", required: true });
    if (time < "09:00" || time > "23:00") throw v.fail("Вақт", "аз 09:00 то 23:00");
    const guests = v.str(b.guests, { field: "Шумораи меҳмонон", max: 20 }) || "2 нафар";
    const reservation = {
      id: nextId(state.reservations),
      name,
      phone,
      date,
      time,
      guests,
      status: "NEW",
      createdAt: new Date(clock()).toISOString(),
    };
    mutate(["reservations"], () => state.reservations.unshift(reservation));
    res.status(201).json({
      id: reservation.id,
      name,
      date,
      time,
      guests,
      status: reservation.status,
      createdAt: reservation.createdAt,
    });
  });
  app.get("/api/reservations", requireAdmin, (req, res) => res.json(state.reservations));
  app.patch("/api/reservations/:id", requireAdmin, (req, res, next) => {
    const id = parseId(req.params.id);
    const r = id ? state.reservations.find((x) => x.id === id) : null;
    if (!r) return next(new HttpError(404, "Бронкунӣ ёфт нашуд.", "NOT_FOUND"));
    const status = v.oneOf((req.body || {}).status, ["NEW", "CONFIRMED", "CANCELLED"], { field: "Статус" });
    mutate(["reservations"], () => {
      r.status = status;
    });
    res.json(r);
  });

  // ===== Промокодҳо =====
  app.post("/api/promos/validate", promoLimiter, (req, res) => {
    const b = v.object(req.body);
    const total = v.num(b.total, { field: "Ҷамъ", min: 0, max: 100000, decimals: 2 }) ?? 0;
    const r = promosLib.applyPromo(state.promos, b.code, total, { now: clock() });
    res.json({ promo: r.promo, discount: r.discount, total: r.total });
  });
  app.get("/api/promos", requireAdmin, (req, res) => res.json(state.promos));
  app.post("/api/promos", requireAdmin, (req, res) => {
    const data = promosLib.validatePromoInput(req.body);
    if (state.promos.some((p) => p.code === data.code)) throw new HttpError(409, "Ин промокод аллакай ҳаст.", "EXISTS");
    const promo = promosLib.normalizePromo({ ...data, active: true, uses: 0, createdAt: new Date(clock()).toISOString() });
    mutate(["promos"], () => state.promos.unshift(promo));
    res.status(201).json(promo);
  });
  app.post("/api/promos/:code/toggle", requireAdmin, (req, res, next) => {
    const code = promosLib.normalizeCode(req.params.code);
    const p = state.promos.find((x) => x.code === code);
    if (!p) return next(new HttpError(404, "Промокод ёфт нашуд.", "NOT_FOUND"));
    mutate(["promos"], () => {
      p.active = !p.active;
    });
    res.json(p);
  });
  app.delete("/api/promos/:code", requireAdmin, (req, res, next) => {
    const code = promosLib.normalizeCode(req.params.code);
    if (!state.promos.some((x) => x.code === code)) return next(new HttpError(404, "Промокод ёфт нашуд.", "NOT_FOUND"));
    mutate(["promos"], () => {
      state.promos = state.promos.filter((x) => x.code !== code);
    });
    res.json({ ok: true });
  });

  // ===== Админ: ҳисобот, пешгӯӣ =====
  app.get("/api/admin/stats", requireAdmin, (req, res) => {
    const summary = reports.summarizeRevenue(state.orders);
    res.json({
      foods: state.foods.length,
      orders: state.orders.length,
      newOrders: state.orders.filter((o) => ["NEW", "PAYMENT_REVIEW", "AWAITING_PAYMENT"].includes(o.status)).length,
      reservations: state.reservations.length,
      uploads: uploads.countUploads(uploadDir),
      currency: config.currency,
      ...summary,
      ai: aiClient.stats(),
    });
  });
  app.get("/api/admin/forecast", requireAdmin, (req, res) => {
    res.json(
      forecast.buildForecast(state.orders, {
        asOfMs: startOfTodayMs(clock(), config.timezoneOffsetHours),
        tzOffsetHours: config.timezoneOffsetHours,
        foods: state.foods,
      })
    );
  });

  // ===== Тавсияҳо (бе AI) ва AI-чат =====
  app.post("/api/recommendations", recLimiter, (req, res) => {
    const prefs = normalizePreferences(req.body && req.body.preferences ? req.body.preferences : req.body || {});
    const dtos = assistant.buildCandidates(state.foods, catalog, prefs);
    res.json({ source: "rules", recommendations: rankFoods(dtos, prefs, { max: 4 }), disclaimer: assistant.DISCLAIMER });
  });

  app.post(
    "/api/ai/chat",
    aiLimiter,
    asyncHandler(async (req, res) => {
      const b = v.object(req.body);
      if (typeof b.message !== "string" || !b.message.trim()) throw new HttpError(400, "Савол нанавиштаед.", "VALIDATION");
      if (b.message.length > 2000) throw new HttpError(400, "Савол хеле дароз аст.", "VALIDATION");
      const history = Array.isArray(b.history) ? b.history.slice(-8) : [];
      const result = await answerAi({
        message: b.message,
        history,
        preferences: b.preferences,
        age: b.age !== undefined ? Number(b.age) : null,
      });
      res.json(result);
    })
  );

  // ===== Telegram =====
  if (config.telegram.enabled) {
    const services = {
      menu: () => state.foods.filter((f) => f.available !== false).map((f) => menu.publicFood(f, catalog)),
      ai: { answer: (args) => answerAi({ ...args, history: [] }) },
      prefs: {
        get: (chatId) => (state.telegram.chats[chatId] && state.telegram.chats[chatId].prefs) || {},
        update: (chatId, patch) =>
          mutate(["telegram"], () => {
            const chat = state.telegram.chats[chatId] || { linkedOrders: [], prefs: {} };
            chat.prefs = { ...chat.prefs, ...patch };
            chat.updatedAt = new Date(clock()).toISOString();
            state.telegram.chats[chatId] = chat;
          }),
      },
      orders: {
        linkByToken: (orderId, token, chatId) => {
          const order = state.orders.find((o) => o.id === orderId);
          if (!order || !order.accessTokenHash || !sec.safeEqualHex(sec.hashToken(token), order.accessTokenHash)) return null;
          mutate(["telegram"], () => {
            const chat = state.telegram.chats[chatId] || { linkedOrders: [], prefs: {} };
            chat.linkedOrders = toIdList([...(chat.linkedOrders || []), orderId]).slice(-10);
            chat.updatedAt = new Date(clock()).toISOString();
            state.telegram.chats[chatId] = chat;
          });
          return ordersLib.customerView(order);
        },
        linkedFor: (chatId) => {
          const ids = (state.telegram.chats[chatId] && state.telegram.chats[chatId].linkedOrders) || [];
          return state.orders.filter((o) => ids.includes(o.id)).map(ordersLib.customerView);
        },
      },
      admin: {
        pending: async () => state.orders.filter((o) => o.paymentMethod === "online" && o.paymentStatus === "IN_REVIEW").map(ordersLib.adminView),
        get: async (id) => {
          const o = state.orders.find((x) => x.id === id);
          return o ? ordersLib.adminView(o) : null;
        },
        approve: async (id, actor) => {
          const o = state.orders.find((x) => x.id === id);
          if (!o) throw new Error("Фармоиш ёфт нашуд.");
          mutate(["orders"], () => ordersLib.approvePayment(o, actor));
          return ordersLib.adminView(o);
        },
        reject: async (id, actor, reason) => {
          const o = state.orders.find((x) => x.id === id);
          if (!o) throw new Error("Фармоиш ёфт нашуд.");
          mutate(["orders"], () => ordersLib.rejectPayment(o, actor, reason));
          return ordersLib.adminView(o);
        },
        setStatus: async (id, status, actor) => {
          const o = state.orders.find((x) => x.id === id);
          if (!o) throw new Error("Фармоиш ёфт нашуд.");
          mutate(["orders"], () => ordersLib.setStatus(o, status, actor));
          return ordersLib.adminView(o);
        },
      },
    };
    const bot = createTelegramBot({ config, services, logger, fetchImpl });
    app.post(
      "/api/telegram/webhook",
      webhookLimiter,
      asyncHandler(async (req, res) => {
        const code = await bot.handleUpdate(req.body, req.get("X-Telegram-Bot-Api-Secret-Token") || "");
        res.status(code).json({ ok: code === 200 });
      })
    );
  }

  // ===== Файлҳои статикӣ =====
  const staticHeaders = (res, filePath) => {
    if (/\.(html|js|css|webmanifest)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
  };
  app.get("/sw.js", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Service-Worker-Allowed", "/");
    res.type("application/javascript");
    res.sendFile(path.join(config.publicDir, "sw.js"));
  });
  app.get(["/admin", "/admin/"], (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(config.publicDir, "admin.html"));
  });
  app.use(
    "/uploads",
    express.static(uploadDir, {
      dotfiles: "ignore",
      index: false,
      setHeaders: (res) => {
        // Файли боркардашуда ҳамчун скрипт иҷро намешавад (санҷиши сигнатура + sandbox)
        res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "public, max-age=86400");
      },
    })
  );
  app.use(express.static(config.publicDir, { index: "index.html", dotfiles: "ignore", setHeaders: staticHeaders }));

  // ===== Хатогиҳо =====
  app.use("/api", sec.apiNotFound);
  app.use(sec.errorHandler(logger));

  return {
    app,
    state,
    store,
    config,
    aiClient,
    catalog,
    mutate,
    close: () => {},
  };
}

/** CORS: танҳо origin-ҳои ба ро'йхат дохилшуда */
function corsMiddleware(allowlist) {
  const allowed = new Set(allowlist);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) res.setHeader("Vary", "Origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Order-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      return origin && allowed.has(origin) ? res.status(204).end() : res.status(403).end();
    }
    return next();
  };
}

module.exports = { createApp, parseId, nextId };
