/**
 * OSHONA — Backend
 * Node.js + Express + JSON-файлҳо (бе базаи алоҳида)
 *
 * Иҷро:  npm install  →  npm start
 * Сайт:  http://localhost:3000
 * Админ: http://localhost:3000/admin.html
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "oshona_secret_change_me";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const CURRENCY = process.env.CURRENCY || "TJS";
const APP_VERSION = "1.5.0";

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------- JSON storage (data/*.json) ----------
// Дар Railway: Volume бояд ба /app/data пайваст шавад (ниг. README).
// Агар ҷузвдони DATA_DIR холӣ бошад — меню аз seed/foods.json нусхабардорӣ мешавад.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SEED_DIR = path.join(__dirname, "seed");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Seed: агар foods холӣ/нест бошад — аз seed пур кун (барои деплойи аввал дар Railway)
function ensureSeeded() {
  for (const f of ["foods.json", "promos.json"]) {
    try {
      const dataPath = path.join(DATA_DIR, f);
      const seedPath = path.join(SEED_DIR, f);
      const needsSeed =
        !fs.existsSync(dataPath) || (JSON.parse(fs.readFileSync(dataPath, "utf8") || "[]").length === 0);
      if (needsSeed && fs.existsSync(seedPath)) {
        fs.copyFileSync(seedPath, dataPath);
        console.log(`🌱 ${f} аз seed пур карда шуд.`);
      }
    } catch (e) {
      console.warn("Seed хатогӣ:", e.message);
    }
  }
}
ensureSeeded();

function readJSON(file, fallback) {
  const p = path.join(DATA_DIR, file);
  try {
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return JSON.parse(fs.readFileSync(p, "utf8") || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

let foods = readJSON("foods.json", []);
let orders = readJSON("orders.json", []);
let reservations = readJSON("reservations.json", []);
let promos = readJSON("promos.json", []);

// Промокодро санҷида, тахфифро ҳисоб мекунад
function applyPromo(code, subtotal) {
  if (!code) return { promo: null, discount: 0, total: subtotal };
  const clean = String(code).trim().toUpperCase();
  const p = promos.find((x) => x.code === clean && x.active !== false);
  if (!p) return { error: "Промокод нодуруст ё ғайрифаъол." };
  if (p.minTotal && subtotal < p.minTotal)
    return { error: `Барои ин промокод ҳадди ақал ${p.minTotal} с. лозим.` };
  let discount = p.type === "amount" ? p.value : Math.round((subtotal * p.value) / 100);
  discount = Math.min(discount, subtotal);
  return { promo: p.code, discount, total: subtotal - discount };
}

// Пароли админ (ҳеш бо bcrypt)
let adminPasswordHash;
if (process.env.ADMIN_PASSWORD_HASH) {
  adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
} else {
  const plain = process.env.ADMIN_PASSWORD || "admin123";
  adminPasswordHash = bcrypt.hashSync(plain, 10);
}

const nextId = (arr) => (arr.length ? Math.max(...arr.map((x) => x.id)) + 1 : 1);
const makePaymentCode = () => "OSH-" + Math.random().toString(36).slice(2, 7).toUpperCase();

// Барои мутобиқати фронтенд/admin кӯҳна: ҳам camelCase, ҳам snake_case бармегардонем
function orderDTO(o) {
  return {
    ...o,
    orderId: o.id,
    customer_name: o.customerName,
    payment_method: o.paymentMethod,
    payment_status: o.paymentStatus,
    payment_code: o.paymentCode,
  };
}

// ---------- Auth ----------
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Токен лозим аст (аввал ворид шавед)." });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Токен нодуруст ё мӯҳлаташ гузаштааст." });
  }
}

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ error: "Логин ё парол нодуруст." });
  }
  const ok = await bcrypt.compare(String(password || ""), adminPasswordHash);
  if (!ok) return res.status(401).json({ error: "Логин ё парол нодуруст." });
  const token = jwt.sign({ username, role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, username });
});

// ---------- Health ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, version: APP_VERSION, foods: foods.length, orders: orders.length, reservations: reservations.length });
});

// ---------- Upload расм (барои меню) ----------
// Дар DATA_DIR/uploads нигоҳ дошта мешавад → дар Railway Volume (/app/data) онро мепӯшонад
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // max 15MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Танҳо файли расм (JPG/PNG) иҷозат аст."));
  },
});

app.post("/api/upload", authRequired, (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      let msg = err.message || "Хатогӣ дар боркунии расм.";
      if (err.code === "LIMIT_FILE_SIZE") msg = "Расм хеле калон аст (ҳадди аксар 15MB).";
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: "Расм интихоб нашудааст." });
    console.log(`📷 Upload: ${req.file.filename} (${Math.round(req.file.size/1024)}KB)`);
    res.status(201).json({ url: "/uploads/" + req.file.filename });
  });
});
app.use("/uploads", express.static(UPLOAD_DIR));
app.get("/sw.js", (req, res) => res.sendFile(require("path").join(__dirname, "public", "sw.js"), { headers: { "Cache-Control": "no-cache" } }));

// Санҷиши хотира (админ) — дидани расмҳои боршуда дар сервер
app.get("/api/debug/storage", authRequired, (req, res) => {
  let files = [];
  try { files = fs.readdirSync(UPLOAD_DIR).filter((f) => !f.startsWith(".")); } catch {}
  res.json({ dataDir: DATA_DIR, uploads: files.length, files: files.slice(0, 50), version: APP_VERSION });
});

// ---------- Foods / Меню ----------
app.get("/api/foods", (req, res) => res.json(foods));

app.get("/api/foods/:id", (req, res) => {
  const f = foods.find((x) => x.id === Number(req.params.id));
  if (!f) return res.status(404).json({ error: "Таом ёфт нашуд." });
  res.json(f);
});

// Илова/тағйир/нест кардани таом — танҳо админ
app.post("/api/foods", authRequired, (req, res) => {
  const { name, category, price, image, description } = req.body || {};
  if (!name || price == null) return res.status(400).json({ error: "Ном ва нарх ҳатмӣ." });
  const food = {
    id: nextId(foods),
    name,
    category: category || "Асосӣ",
    price: Number(price),
    image: image || "",
    description: description || "",
  };
  foods.push(food);
  writeJSON("foods.json", foods);
  res.status(201).json(food);
});

app.put("/api/foods/:id", authRequired, (req, res) => {
  const f = foods.find((x) => x.id === Number(req.params.id));
  if (!f) return res.status(404).json({ error: "Таом ёфт нашуд." });
  const { name, category, price, image, description } = req.body || {};
  if (name !== undefined) f.name = name;
  if (category !== undefined) f.category = category;
  if (price !== undefined) f.price = Number(price);
  if (image !== undefined) f.image = image;
  if (description !== undefined) f.description = description;
  writeJSON("foods.json", foods);
  res.json(f);
});

app.delete("/api/foods/:id", authRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!foods.some((x) => x.id === id)) return res.status(404).json({ error: "Таом ёфт нашуд." });
  foods = foods.filter((x) => x.id !== id);
  writeJSON("foods.json", foods);
  res.json({ ok: true });
});

// ---------- Orders / Фармоишҳо ----------
app.post("/api/orders", async (req, res) => {
  const { customerName, name, phone, address, method, paymentMethod, paymentProvider, items } = req.body || {};

  const clientName = customerName || name;
  if (!clientName || !phone) {
    return res.status(400).json({ error: "Ном ва телефон ҳатмӣ." });
  }
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "Сабад холӣ аст." });
  }

  // Нархро сервер ҳисоб мекунад (на фронтенд — барои бехатарӣ)
  let total = 0;
  const detailedItems = [];
  for (const it of items) {
    const food = foods.find((f) => f.id === Number(it.foodId || it.id));
    if (!food) return res.status(400).json({ error: `Таом бо id=${it.foodId || it.id} ёфт нашуд.` });
    const qty = Math.max(1, Number(it.quantity || it.qty || 1));
    total += food.price * qty;
    detailedItems.push({ foodId: food.id, name: food.name, price: food.price, quantity: qty });
  }

  const subtotal = total;
  const pr = applyPromo((req.body || {}).promo, subtotal);
  if (pr.error) return res.status(400).json({ error: pr.error });
  total = pr.total;

  const payMethod = paymentMethod === "cash" ? "cash" : "online";
  const order = {
    id: nextId(orders),
    customerName: clientName,
    phone,
    address: address || "",
    method: method || "delivery",
    paymentMethod: payMethod,
    paymentProvider: payMethod === "online" ? paymentProvider || "manual" : null,
    paymentCode: makePaymentCode(),
    paymentStatus: payMethod === "cash" ? "CASH_ON_DELIVERY" : "AWAITING_PAYMENT",
    status: payMethod === "cash" ? "NEW" : "AWAITING_PAYMENT",
    items: detailedItems,
    subtotal,
    discount: pr.discount,
    promo: pr.promo,
    total,
    currency: CURRENCY,
    createdAt: new Date().toISOString(),
  };
  orders.unshift(order);
  writeJSON("orders.json", orders);

  // Ҳамёнҳо ва линкҳои пардохт (Алиф / Душанбе Сити)
  // Агар DC_PAY_URL / ALIF_PAY_URL (формати merchant) дода шавад — тугмаҳо app-ро мекушоянд
  const dcWallet = process.env.DUSHANBE_CITY_WALLET || process.env.DUSHANBE_CITY_CARD || "034392828";
  const alifWallet = process.env.ALIF_WALLET || process.env.ALIF_CARD || "034392828";
  const fillLink = (tpl, wallet) => tpl
    ? tpl.split("{wallet}").join(wallet).split("{amount}").join(String(order.total)).split("{code}").join(order.paymentCode)
    : null;
  const dcLink = fillLink(process.env.DC_PAY_URL || "", dcWallet);
  const alifLink = fillLink(process.env.ALIF_PAY_URL || "", alifWallet);

  let qr = null;
  try {
    qr = await QRCode.toDataURL(
      `OSHONA | Сумма: ${order.total} ${CURRENCY} | Хамён: ${dcWallet} | Код: ${order.paymentCode}`,
      { width: 240, margin: 2 }
    );
  } catch (e) { console.warn("QR хатогӣ:", e.message); }

  res.status(201).json({
    ...orderDTO(order),
    total: order.total,
    currency: order.currency,
    paymentInstructions: {
      dushanbeCity: `${dcWallet} (${process.env.DUSHANBE_CITY_NAME || "OSHONA"})`,
      alif: `${alifWallet} (${process.env.ALIF_NAME || "OSHONA"})`,
      dcWallet, alifWallet, dcLink, alifLink,
      comment: order.paymentCode,
      amount: order.total,
      promo: order.promo,
      discount: order.discount || 0,
      qr,
    },
  });
});

// Рӯйхати фармоишҳо — админ
app.get("/api/orders", authRequired, (req, res) => {
  res.json(orders.map(orderDTO));
});

// Фармоишҳои муштарӣ аз рӯи телефон (бе логин)
app.get("/api/orders/by-phone", (req, res) => {
  const q = String(req.query.phone || "").replace(/\D/g, "");
  if (q.length < 6) return res.status(400).json({ error: "Рақами телефонро дуруст нависед." });
  const tail = q.slice(-9);
  const list = orders.filter((o) => {
    const p = String(o.phone || "").replace(/\D/g, "");
    return p && (p.endsWith(tail) || q.endsWith(p.slice(-9)));
  });
  res.json(list.map(orderDTO));
});

// Маълумоти пардохт барои фармоиши кӯҳна (пардохти дубора)
app.get("/api/orders/:id/pay-info", async (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Фармоиш ёфт нашуд." });
  const dcWallet = process.env.DUSHANBE_CITY_WALLET || process.env.DUSHANBE_CITY_CARD || "034392828";
  const alifWallet = process.env.ALIF_WALLET || process.env.ALIF_CARD || "034392828";
  const fillLink = (tpl, wallet) => tpl
    ? tpl.split("{wallet}").join(wallet).split("{amount}").join(String(o.total)).split("{code}").join(o.paymentCode)
    : null;
  let qr = null;
  try {
    qr = await QRCode.toDataURL(
      `OSHONA | Сумма: ${o.total} ${CURRENCY} | Хамён: ${dcWallet} | Код: ${o.paymentCode}`,
      { width: 240, margin: 2 }
    );
  } catch {}
  res.json({
    orderId: o.id, total: o.total, currency: o.currency,
    paymentInstructions: {
      dushanbeCity: `${dcWallet} (${process.env.DUSHANBE_CITY_NAME || "OSHONA"})`,
      alif: `${alifWallet} (${process.env.ALIF_NAME || "OSHONA"})`,
      dcWallet, alifWallet,
      dcLink: fillLink(process.env.DC_PAY_URL || "", dcWallet),
      alifLink: fillLink(process.env.ALIF_PAY_URL || "", alifWallet),
      comment: o.paymentCode, amount: o.total, qr,
    },
  });
});

// Як фармоишро дидан (муштарӣ бо id, админ бо токен)
app.get("/api/orders/:id", (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Фармоиш ёфт нашуд." });
  res.json(orderDTO(o));
});

// Муштарӣ: "пардохт кардам" — меравад ба санҷиши админ
app.post("/api/orders/:id/payment-submitted", (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Фармоиш ёфт нашуд." });
  if (o.paymentMethod !== "online") return res.status(400).json({ error: "Ин фармоиш нақдӣ аст." });
  o.paymentStatus = "IN_REVIEW";
  o.status = "PAYMENT_REVIEW";
  writeJSON("orders.json", orders);
  res.json(orderDTO(o));
});

// Админ: тасдиқ / рад кардани пардохт
app.post("/api/orders/:id/approve-payment", authRequired, (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Фармоиш ёфт нашуд." });
  o.paymentStatus = "PAID";
  o.status = "CONFIRMED";
  writeJSON("orders.json", orders);
  res.json(orderDTO(o));
});

app.post("/api/orders/:id/reject-payment", authRequired, (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Фармоиш ёфт нашуд." });
  o.paymentStatus = "REJECTED";
  o.status = "PAYMENT_REJECTED";
  writeJSON("orders.json", orders);
  res.json(orderDTO(o));
});

// Админ: иваз кардани статус (NEW → COOKING → DELIVERING → DONE / CANCELLED)
app.patch("/api/orders/:id/status", authRequired, (req, res) => {
  const o = orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Фармоиш ёфт нашуд." });
  const { status } = req.body || {};
  const allowed = ["NEW", "AWAITING_PAYMENT", "PAYMENT_REVIEW", "CONFIRMED", "COOKING", "DELIVERING", "DONE", "CANCELLED", "PAYMENT_REJECTED"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Статус нодуруст." });
  o.status = status;
  writeJSON("orders.json", orders);
  res.json(orderDTO(o));
});

// ---------- Reservations / Бронкунии миз ----------
app.post("/api/reservations", (req, res) => {
  const { name, phone, date, time, guests } = req.body || {};
  if (!name || !phone || !date || !time) {
    return res.status(400).json({ error: "Ном, телефон, сана ва вақт ҳатмӣ." });
  }
  const r = {
    id: nextId(reservations),
    name,
    phone,
    date,
    time,
    guests: guests || "2 нафар",
    status: "NEW",
    createdAt: new Date().toISOString(),
  };
  reservations.unshift(r);
  writeJSON("reservations.json", reservations);
  res.status(201).json(r);
});

app.get("/api/reservations", authRequired, (req, res) => res.json(reservations));

app.patch("/api/reservations/:id", authRequired, (req, res) => {
  const r = reservations.find((x) => x.id === Number(req.params.id));
  if (!r) return res.status(404).json({ error: "Брон ёфт нашуд." });
  const { status } = req.body || {};
  if (status) r.status = status;
  writeJSON("reservations.json", reservations);
  res.json(r);
});

// ---------- Promo / Промокодҳо ----------
app.get("/api/promos", authRequired, (req, res) => res.json(promos));

app.post("/api/promos", authRequired, (req, res) => {
  let { code, type, value, minTotal } = req.body || {};
  code = String(code || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!code || value == null || Number(value) <= 0)
    return res.status(400).json({ error: "Код ва миқдори дуруст лозим." });
  if (promos.some((p) => p.code === code))
    return res.status(400).json({ error: "Ин код аллакай ҳаст." });
  const promo = {
    code, type: type === "amount" ? "amount" : "percent",
    value: Number(value), minTotal: Math.max(0, Number(minTotal) || 0), active: true,
  };
  promos.unshift(promo);
  writeJSON("promos.json", promos);
  res.status(201).json(promo);
});

app.post("/api/promos/:code/toggle", authRequired, (req, res) => {
  const p = promos.find((x) => x.code === String(req.params.code).toUpperCase());
  if (!p) return res.status(404).json({ error: "Промокод ёфт нашуд." });
  p.active = p.active === false;
  writeJSON("promos.json", promos);
  res.json(p);
});

app.delete("/api/promos/:code", authRequired, (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!promos.some((x) => x.code === code))
    return res.status(404).json({ error: "Промокод ёфт нашуд." });
  promos = promos.filter((x) => x.code !== code);
  writeJSON("promos.json", promos);
  res.json({ ok: true });
});

// Санҷиши промокод ҳангоми фармоиш (бе логин)
app.post("/api/promos/validate", (req, res) => {
  const { code, total } = req.body || {};
  const r = applyPromo(code, Number(total) || 0);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ promo: r.promo, discount: r.discount, total: r.total });
});

// ---------- Admin stats ----------
app.get("/api/admin/stats", authRequired, (req, res) => {
  const revenue = orders
    .filter((o) => o.paymentStatus === "PAID" || o.paymentMethod === "cash")
    .reduce((s, o) => s + o.total, 0);
  res.json({
    foods: foods.length,
    orders: orders.length,
    newOrders: orders.filter((o) => ["NEW", "PAYMENT_REVIEW", "AWAITING_PAYMENT"].includes(o.status)).length,
    reservations: reservations.length,
    revenue,
    currency: CURRENCY,
  });
});

// ---------- Frontend (файлҳои статикӣ) ----------
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🍽️  OSHONA backend кор мекунад!`);
  console.log(`   Сайт:  http://localhost:${PORT}`);
  console.log(`   Админ: http://localhost:${PORT}/admin.html`);
  console.log(`   API:   http://localhost:${PORT}/api/health\n`);
});
