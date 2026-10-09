"use strict";

/**
 * Telegram-бот: ҳамон backend ва ҳамон маълумоти сайт.
 *  - webhook бо сарлавҳаи X-Telegram-Bot-Api-Secret-Token (timing-safe);
 *  - фармонҳои админ танҳо барои ID-и рақамии TELEGRAM_ADMIN_IDS (на username);
 *  - пайвастшавӣ ба фармоиш: deep link /start o<id>_<token> (токени дастрасии фармоиш);
 *  - матни оддӣ (бе parse_mode) — тақлиди HTML/Markdown-и бегона намешавад.
 */
const { safeEqualString } = require("./security");

const STATUS_TEXT = {
  AWAITING_PAYMENT: "Интизори пардохт (ба ҳамён пул фиристед, коди фармоишро дар шарҳ нависед)",
  PAYMENT_REVIEW: "Пардохт санҷида мешавад",
  PAYMENT_REJECTED: "Пардохт рад шуд — бо ресторан тамос гиред ё дубора фиристед",
  NEW: "Қабул шуд (пардохти нақдӣ ҳангоми расонидан)",
  CONFIRMED: "Пардохт тасдиқ шуд, ба ошпазӣ омода мешавад",
  COOKING: "Дар ошпазӣ",
  DELIVERING: "Дар роҳ",
  DONE: "Анҷом ёфт",
  CANCELLED: "Бекор шуд",
};

const MAX_TEXT = 3900;

function clip(s) {
  const t = String(s || "");
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + "…" : t;
}

function createTelegramBot({ config, services, logger = console, fetchImpl = globalThis.fetch }) {
  const tg = config.telegram;
  const apiUrl = (method) => `${tg.apiBase}/bot${tg.botToken}/${method}`;

  const rate = new Map();
  function allowChat(chatId, max = 20, windowMs = 60000) {
    const now = Date.now();
    const b = rate.get(chatId) || { count: 0, resetAt: now + windowMs };
    if (b.resetAt <= now) {
      b.count = 0;
      b.resetAt = now + windowMs;
    }
    b.count += 1;
    rate.set(chatId, b);
    return b.count <= max;
  }

  async function send(chatId, text) {
    if (!tg.botToken) return false;
    try {
      const res = await fetchImpl(apiUrl("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: clip(text), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        logger.warn(`[telegram] sendMessage статус=${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      logger.warn(`[telegram] sendMessage хатогӣ: ${err && err.name}`);
      return false;
    }
  }

  const isAdminUser = (from) => Boolean(from && tg.adminIds.has(String(from.id)));

  function parseCommand(text) {
    const m = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(String(text || "").trim());
    if (!m) return null;
    return { cmd: m[1].toLowerCase(), arg: (m[2] || "").trim() };
  }

  function fmtMoney(n) {
    return `${n} ${config.currency}`;
  }

  function formatOrderLine(o) {
    const parts = [`Фармоиш #${o.id}: ${STATUS_TEXT[o.status] || o.status}`];
    if (o.paymentMethod === "online" && o.paymentStatus !== "PAID" && o.status !== "CANCELLED") {
      parts.push(`Код барои шарҳ: ${o.paymentCode}`);
    }
    parts.push(`Маблағ: ${fmtMoney(o.total)}`);
    return parts.join("\n");
  }

  function formatMenu(foods) {
    if (!foods.length) return "Меню ҳоло холӣ аст.";
    return foods
      .map((f) => {
        const cal = f.nutrition && f.nutrition.status === "computed" ? `, ${f.nutrition.calories} ккал (ҳисоби таркиб)` : ", калория: маълумот нест";
        return `• ${f.name} — ${fmtMoney(f.price)}${cal}`;
      })
      .join("\n");
  }

  function formatRecommendations(list, notes, notice, disclaimer) {
    const lines = [];
    if (notice) lines.push(notice);
    for (const r of list) {
      lines.push(`• ${r.name} — ${fmtMoney(r.price)}${r.reason ? `\n  ${r.reason}` : ""}`);
    }
    if (!list.length) lines.push("Ба талаботи шумо таом ёфт нашуд.");
    if (notes && notes.length) lines.push("", ...notes.map((n) => `ⓘ ${n}`));
    if (disclaimer && list.length) lines.push("", `ⓘ ${disclaimer}`);
    return lines.join("\n");
  }

  const HELP = [
    "OSHONA — ёрдамчии Telegram",
    "",
    "/menu — меню ва нархҳо",
    "/tavsiya [савол] — тавсия (AI ё қоидаҳо)",
    "/budget 50 — буҷет (с.); /budget 0 — бекор",
    "/taste шириниро дӯст дорам, тунд — таъм",
    "/avoid шир, тухм — истисноҳо/аллергия",
    "/prefs — мехоҳишҳои ҷорӣ; /clear — тоза кардан",
    "/status — ҳолати фармоишҳои шумо",
    "",
    "Барои пайваста кардани фармоиш, линки «Telegram»-ро дар сайт пас аз фармоиш кушоед.",
    "Ҳамчунин ҳар саволи озод навишта метавонед.",
  ].join("\n");

  const ADMIN_HELP = [
    "Фармонҳои админ:",
    "/pending — фармоишҳои интизори санҷиши пардохт",
    "/approve <id> — тасдиқи пардохт",
    "/reject <id> [сабаб] — рад кардани пардохт",
    "/order <id> — ҳолати фармоиш",
    "/setstatus <id> <СТАТУС> — тағйири ҳолат (масалан COOKING)",
  ].join("\n");

  async function handleAdmin(chat, from, cmd, arg) {
    if (cmd === "pending") {
      const list = await services.admin.pending();
      if (!list.length) return send(chat.id, "Фармоиши интизори санҷиш нест.");
      return send(chat.id, list.map((o) => `#${o.id} — ${fmtMoney(o.total)} — код ${o.paymentCode} (${o.customerName})`).join("\n"));
    }
    if (cmd === "approve" || cmd === "reject") {
      const [idRaw, ...rest] = arg.split(/\s+/);
      const id = Number(idRaw);
      if (!Number.isInteger(id) || id < 1) return send(chat.id, `Истифода: /${cmd} <id>${cmd === "reject" ? " [сабаб]" : ""}`);
      try {
        const actor = `telegram:${from.id}`;
        const o = cmd === "approve"
          ? await services.admin.approve(id, actor)
          : await services.admin.reject(id, actor, rest.join(" "));
        return send(chat.id, `Фармоиш #${o.id}: ${cmd === "approve" ? "пардохт тасдиқ шуд" : "пардохт рад шуд"}. Ҳолат: ${o.status}`);
      } catch (err) {
        return send(chat.id, `Хато: ${err.message}`);
      }
    }
    if (cmd === "order") {
      const id = Number(arg);
      const o = Number.isInteger(id) ? await services.admin.get(id) : null;
      if (!o) return send(chat.id, "Фармоиш ёфт нашуд.");
      return send(chat.id, `${formatOrderLine(o)}\nМизоҷ: ${o.customerName}\nТелефон: ${o.phone}\nПардохт: ${o.paymentMethod}/${o.paymentStatus}`);
    }
    if (cmd === "setstatus") {
      const [idRaw, statusRaw] = arg.split(/\s+/);
      const id = Number(idRaw);
      if (!Number.isInteger(id) || !statusRaw) return send(chat.id, "Истифода: /setstatus <id> <СТАТУС>");
      try {
        const o = await services.admin.setStatus(id, statusRaw.toUpperCase(), `telegram:${from.id}`);
        return send(chat.id, `Фармоиш #${o.id}: ҳолат → ${o.status}`);
      } catch (err) {
        return send(chat.id, `Хато: ${err.message}`);
      }
    }
    return send(chat.id, ADMIN_HELP);
  }

  async function handleMessage(message) {
    const chat = message.chat;
    const from = message.from || {};
    const text = String(message.text || "").trim();
    if (!text) return send(chat.id, "Матн нависед ё /help-ро пахш кунед.");
    if (!allowChat(String(chat.id))) return send(chat.id, "Хеле зуд менависед. Каме интизор шавед.");

    const cmdInfo = parseCommand(text);
    const chatKey = String(chat.id);

    if (!cmdInfo) {
      // Савол → AI/қоидаҳо
      const prefs = services.prefs.get(chatKey);
      const r = await services.ai.answer({ message: text, preferences: prefs, history: [] });
      return send(chat.id, formatRecommendations(r.recommendations, r.notes, r.reply ? `${r.reply}` : null, r.disclaimer));
    }

    const { cmd, arg } = cmdInfo;
    switch (cmd) {
      case "start": {
        const m = /^o(\d+)_([A-Za-z0-9_-]{16,80})$/.exec(arg);
        if (m) {
          const order = await services.orders.linkByToken(Number(m[1]), m[2], chatKey);
          if (!order) return send(chat.id, "Линк нодуруст ё мӯҳлаташ гузаштааст. Фармоишро дар сайт аз нав кушоед.");
          return send(chat.id, `Telegram пайваст шуд.\n${formatOrderLine(order)}\nНавбатӣ ҳолатро бо /status дидан мумкин.`);
        }
        return send(chat.id, `Хуш омадед ба OSHONA!\n\n${HELP}`);
      }
      case "help":
        return send(chat.id, HELP + (isAdminUser(from) && chat.type === "private" ? `\n\n${ADMIN_HELP}` : ""));
      case "menu":
        return send(chat.id, formatMenu(services.menu()));
      case "tavsiya": {
        const q = arg || "";
        const r = await services.ai.answer({ message: q || "Тавсия диҳед", preferences: services.prefs.get(chatKey), history: [] });
        return send(chat.id, [r.reply, "", formatRecommendations(r.recommendations, r.notes, null, r.disclaimer)].join("\n"));
      }
      case "budget": {
        const n = Number(arg.replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 100000) return send(chat.id, "Истифода: /budget 50 (ё /budget 0 барои бекор)");
        services.prefs.update(chatKey, { budget: n > 0 ? n : null });
        return send(chat.id, n > 0 ? `Буҷет: ${n} ${config.currency}` : "Буҷет бекор шуд.");
      }
      case "taste": {
        const list = arg.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
        services.prefs.update(chatKey, { tastes: list });
        return send(chat.id, list.length ? `Таъмҳо: ${list.join(", ")}` : "Таъмҳо тоза шуданд.");
      }
      case "avoid": {
        const list = arg.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
        services.prefs.update(chatKey, { avoid: list });
        return send(chat.id, list.length
          ? `Истисноҳо: ${list.join(", ")}. Таомҳои номаълум таркиб тавсия дода намешаванд.`
          : "Истисноҳо тоза шуданд.");
      }
      case "prefs": {
        const p = services.prefs.get(chatKey);
        return send(chat.id, [
          `Буҷет: ${p.budget ? fmtMoney(p.budget) : "—"}`,
          `Таъмҳо: ${(p.tastes || []).join(", ") || "—"}`,
          `Истисноҳо: ${(p.avoid || []).join(", ") || "—"}`,
        ].join("\n"));
      }
      case "clear":
        services.prefs.update(chatKey, { budget: null, tastes: [], avoid: [] });
        return send(chat.id, "Мехоҳишҳо тоза шуданд.");
      case "status": {
        const list = services.orders.linkedFor(chatKey);
        if (!list.length) return send(chat.id, "Фармоиши пайвастшуда нест. Линки Telegram-ро аз сайт кушоед.");
        return send(chat.id, list.map(formatOrderLine).join("\n\n"));
      }
      case "pending":
      case "approve":
      case "reject":
      case "order":
      case "setstatus":
        if (!isAdminUser(from) || chat.type !== "private") {
          // Ҷавоби бетарафона: ошкор накардани мавҷудияти фармон/рӯйхат
          return send(chat.id, "Ин фармон барои ҳамаи корбарон дастрас нест.");
        }
        return handleAdmin(chat, from, cmd, arg);
      default:
        return send(chat.id, "Фармони номаълум. /help-ро пахш кунед.");
    }
  }

  /** Webhook: сарлавҳа санҷида мешавад, сипас update коркард мешавад. Бозгашт: HTTP status */
  async function handleUpdate(update, headerSecret) {
    if (!tg.webhookSecret || !safeEqualString(headerSecret, tg.webhookSecret)) return 403;
    const message = update && (update.message || update.edited_message);
    if (!message || !message.chat) return 200;
    try {
      await handleMessage(message);
    } catch (err) {
      logger.error(`[telegram] коркарди update: ${err && err.message}`);
    }
    return 200;
  }

  return { handleUpdate, send, isAdminUser, formatOrderLine, STATUS_TEXT, HELP };
}

module.exports = { createTelegramBot, STATUS_TEXT };
