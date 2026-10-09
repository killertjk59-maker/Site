"use strict";

/**
 * Амният: хатогиҳои HTTP, сарлавҳо, маҳдудияти дархостҳо, JWT-и админ,
 * ва санҷиши токенҳои дастрасии фармоиш.
 */
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/** Муқоисаи тавонмандонаи ҳешҳо (бе leaks-и вақт) */
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function safeEqualString(a, b) {
  const x = crypto.createHash("sha256").update(String(a || "")).digest();
  const y = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Токени тасодуфии дастрасӣ барои як фармоиш (URL-safe, 24 байт) */
const newAccessToken = () => crypto.randomBytes(24).toString("base64url");

/**
 * Сарлавҳаҳои амниятӣ барои ҳама ҷавобҳо.
 * CSP — барои саҳифаҳои HTML ва API (скрипти беруна/inline манъ, clickjacking манъ).
 */
function securityHeaders({ production }) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", csp);
    if (production) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

/**
 * Маҳдудияти оддии дархостҳо (fixed window) дар хотира барои ҳар IP ё калид.
 * Барои як нусхаи сервер кофист; барои бисёр нусхаҳо — Redis лозим аст.
 */
function createRateLimiter({ windowMs, max, name = "limit", message = "Дархостҳо аз ҳад зиёданд. Каме интизор шавед.", keyFn }) {
  const buckets = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < windowMs && buckets.size < 10000) return;
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const middleware = (req, res, next) => {
    const now = Date.now();
    sweep(now);
    const key = `${name}:${keyFn ? keyFn(req) : req.ip}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: message, code: "RATE_LIMITED" });
    }
    return next();
  };
  middleware.reset = (req) => buckets.delete(`${name}:${keyFn ? keyFn(req) : req.ip}`);
  return middleware;
}

/** JWT-и админ (HS256) */
function createAuth({ jwtSecret, expiresIn }) {
  const signAdmin = (username) =>
    jwt.sign({ sub: username, username, role: "admin" }, jwtSecret, {
      algorithm: "HS256",
      expiresIn,
    });

  const verifyAdminToken = (token) => {
    try {
      const claims = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
      if (!claims || claims.role !== "admin") return null;
      return claims;
    } catch {
      return null;
    }
  };

  const bearer = (req) => {
    const header = req.headers.authorization || "";
    return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  };

  const requireAdmin = (req, res, next) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "Токен лозим аст (аввал ворид шавед).", code: "AUTH_REQUIRED" });
    const claims = verifyAdminToken(token);
    if (!claims) return res.status(401).json({ error: "Токен нодуруст ё мӯҳлаташ гузаштааст.", code: "AUTH_INVALID" });
    req.admin = claims;
    return next();
  };

  const isAdminRequest = (req) => {
    const token = bearer(req);
    return Boolean(token && verifyAdminToken(token));
  };

  return { signAdmin, verifyAdminToken, requireAdmin, isAdminRequest, bearer };
}

/** Хатогиҳои API: JSON, бе stack trace ба клиент */
function apiNotFound(req, res, next) {
  // Дар mount-и "/api" req.path кӯтоҳ мешавад — барои ошкорсозӣ originalUrl истифода мешавад
  if ((req.originalUrl || req.url || "").split("?")[0].startsWith("/api")) {
    return res.status(404).json({ error: "Роҳ ёфт нашуд.", code: "NOT_FOUND" });
  }
  return next();
}

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
    if (err && err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON-и дархост нодуруст аст.", code: "BAD_JSON" });
    }
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({ error: "Дархост хеле калон аст.", code: "PAYLOAD_TOO_LARGE" });
    }
    if (err && err.type === "charset.unsupported") {
      return res.status(415).json({ error: "Кодировка дастгирӣ намешавад.", code: "UNSUPPORTED_CHARSET" });
    }
    logger.error("Хатогии дохилӣ:", err && err.stack ? err.stack.split("\n")[0] : err);
    return res.status(500).json({ error: "Хатогии дохилии сервер. Баъдтар кӯшиш кунед.", code: "INTERNAL" });
  };
}

module.exports = {
  HttpError,
  hashToken,
  safeEqualHex,
  safeEqualString,
  newAccessToken,
  securityHeaders,
  createRateLimiter,
  createAuth,
  apiNotFound,
  errorHandler,
};
