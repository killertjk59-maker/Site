"use strict";

/**
 * Бор кардани танзимот аз муҳити сервер (env) ва санҷиши онҳо.
 * Дар production қиматҳои заифи пешфарзӣ (JWT_SECRET, пароли админ) рад карда мешаванд.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const VERSION = "2.0.0";

const WEAK_JWT_SECRETS = new Set([
  "oshona_secret_change_me",
  "oshona_super_secret_2026_change_me",
  "change_me",
  "secret",
  "changeme",
]);
const WEAK_ADMIN_PASSWORDS = new Set([
  "admin", "admin123", "password", "password123", "123456", "12345678", "oshona", "changeme", "qwerty",
]);

class ConfigError extends Error {
  constructor(problems) {
    super("Танзимоти нодуруст:\n  - " + problems.join("\n  - "));
    this.name = "ConfigError";
    this.problems = problems;
  }
}

function isProductionEnv(env) {
  if (env.NODE_ENV === "production" || env.APP_ENV === "production") return true;
  // Railway ҳар дам як сарлавҳаи RAILWAY_* -ро дар муҳит мегузорад
  return Object.keys(env).some((k) => k.startsWith("RAILWAY_") && Boolean(env[k]));
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function readAiSettings() {
  const file = path.join(ROOT, "config", "ai.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadConfig(env = process.env) {
  const production = isProductionEnv(env);
  const problems = [];
  const warnings = [];

  // ---- JWT ----
  let jwtSecret = String(env.JWT_SECRET || "").trim();
  if (!jwtSecret) {
    if (production) problems.push("JWT_SECRET танзим нашудааст. Дар production он ҳатмист (камаш 32 аломати тасодуфӣ).");
    else {
      jwtSecret = crypto.randomBytes(32).toString("hex");
      warnings.push("JWT_SECRET танзим нашудааст: калиди муваққатии тасодуфӣ истифода мешавад (танҳо барои рушд).");
    }
  } else if (WEAK_JWT_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
    if (production) problems.push("JWT_SECRET заиф аст (пешфарзӣ ё кӯтоҳ). Камаш 32 аломати тасодуфӣ гузоред.");
    else warnings.push("JWT_SECRET заиф аст — дар production рад мешавад.");
  }

  // ---- Админ ----
  const adminUsername = String(env.ADMIN_USERNAME || "admin").trim();
  let adminPasswordHash = String(env.ADMIN_PASSWORD_HASH || "").trim();
  let adminPassword = String(env.ADMIN_PASSWORD || "");
  if (!adminPasswordHash) {
    if (!adminPassword) {
      if (production) problems.push("ADMIN_PASSWORD ё ADMIN_PASSWORD_HASH танзим нашудааст.");
      else {
        adminPassword = "admin123";
        warnings.push("ADMIN_PASSWORD танзим нашудааст: пароли пешфарзии рушд ('admin123') истифода мешавад.");
      }
    } else if (WEAK_ADMIN_PASSWORDS.has(adminPassword.toLowerCase()) || adminPassword.length < 10) {
      if (production) problems.push("ADMIN_PASSWORD заиф аст (камаш 10 аломат; 'admin123' ва ҳамонанд манъ аст).");
      else warnings.push("ADMIN_PASSWORD заиф аст — дар production рад мешавад.");
    }
  }

  if (problems.length) throw new ConfigError(problems);

  // ---- AI (калиди OpenRouter танҳо аз муҳит) ----
  const aiFile = readAiSettings();
  const ai = {
    enabled: Boolean(String(env.OPENROUTER_API_KEY || "").trim()),
    apiKey: String(env.OPENROUTER_API_KEY || "").trim(),
    baseUrl: (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    primaryModel: String(env.OPENROUTER_MODEL || aiFile.primaryModel).trim(),
    fallbackModels: env.OPENROUTER_FALLBACK_MODEL
      ? splitList(env.OPENROUTER_FALLBACK_MODEL)
      : aiFile.fallbackModels.slice(),
    timeoutMs: Number(env.AI_TIMEOUT_MS) || aiFile.timeoutMs,
    maxRetriesPerModel: env.AI_MAX_RETRIES !== undefined && env.AI_MAX_RETRIES !== ""
      ? Number(env.AI_MAX_RETRIES)
      : aiFile.maxRetriesPerModel,
    baseBackoffMs: aiFile.baseBackoffMs,
    maxBackoffMs: aiFile.maxBackoffMs,
    maxRetryAfterMs: aiFile.maxRetryAfterMs,
    maxOutputTokens: aiFile.maxOutputTokens,
    temperature: aiFile.temperature,
    dailyRequestLimit: Number(env.AI_DAILY_LIMIT) || aiFile.dailyRequestLimit,
    maxUserMessageChars: aiFile.maxUserMessageChars,
    maxHistoryTurns: aiFile.maxHistoryTurns,
    verifiedAt: aiFile.verifiedAt,
  };

  // ---- Telegram ----
  const telegram = {
    enabled: Boolean(String(env.TELEGRAM_BOT_TOKEN || "").trim()),
    botToken: String(env.TELEGRAM_BOT_TOKEN || "").trim(),
    botUsername: String(env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim(),
    webhookSecret: String(env.TELEGRAM_WEBHOOK_SECRET || "").trim(),
    // Танҳо ID-и рақамии Telegram (на username) барои фармонҳои админ
    adminIds: new Set(splitList(env.TELEGRAM_ADMIN_IDS).filter((x) => /^\d{3,20}$/.test(x))),
    apiBase: (env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, ""),
  };
  if (telegram.enabled && !telegram.webhookSecret) {
    if (production) problems.push("TELEGRAM_WEBHOOK_SECRET танзим нашудааст (бе он webhook қабул намешавад).");
    else warnings.push("TELEGRAM_WEBHOOK_SECRET танзим нашудааст — webhook фаъол намешавад.");
  }
  if (problems.length) throw new ConfigError(problems);

  const port = Number(env.PORT) || 3000;
  return {
    version: VERSION,
    root: ROOT,
    production,
    port,
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, "data")),
    publicDir: path.join(ROOT, "public"),
    seedDir: path.join(ROOT, "seed"),
    configDir: path.join(ROOT, "config"),
    jwtSecret,
    jwtExpiresIn: "12h",
    adminUsername,
    adminPassword,
    adminPasswordHash,
    currency: String(env.CURRENCY || "TJS").trim() || "TJS",
    timezoneOffsetHours: 5, // Душанбе (UTC+5, бе DST)
    corsOrigins: splitList(env.CORS_ORIGINS),
    // Зарбкунаки маҳдудияти дархостҳо (1 = пешфарз). Барои IP-и умумии мизоҷон (CGNAT) ва санҷишҳо.
    rateLimitScale: Math.min(1000, Math.max(0.01, Number(env.RATE_LIMIT_SCALE) || 1)),
    trustProxy: env.TRUST_PROXY !== undefined ? env.TRUST_PROXY : production ? "1" : "false",
    wallets: {
      dushanbeCity: {
        wallet: String(env.DUSHANBE_CITY_WALLET || env.DUSHANBE_CITY_CARD || "034392828"),
        name: String(env.DUSHANBE_CITY_NAME || "OSHONA"),
        payUrl: String(env.DC_PAY_URL || ""),
      },
      alif: {
        wallet: String(env.ALIF_WALLET || env.ALIF_CARD || "034392828"),
        name: String(env.ALIF_NAME || "OSHONA"),
        payUrl: String(env.ALIF_PAY_URL || ""),
      },
    },
    ai,
    telegram,
    warnings,
  };
}

module.exports = { loadConfig, ConfigError, isProductionEnv, VERSION, ROOT };
