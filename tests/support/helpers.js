/**
 * Тестҳои HTTP-и сиёҳқуттӣ: сервери ҳақиқиро (`node server.js`) бо DATA_DIR-и муваққатӣ
 * ва портҳои озод роҳ медиҳад. Ҳамин ваҷҳ ҳам барои кодҳои кӯҳна ва ҳам барои
 * кодҳои нав кор мекунад.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const TEST_ADMIN_USER = "admin";
const TEST_ADMIN_PASSWORD = "Test-Admin-Pass-2026!";
const TEST_JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef";

// Муҳити мутлақи тоза: ҳеҷ калид/ҳолати production-и қуттии рушди шумо ба тест роҳ наёбад.
const STRIPPED_PREFIXES = ["RAILWAY_", "OPENROUTER_", "TELEGRAM_", "OSHONA_", "CORS_", "AI_"];
const STRIPPED_KEYS = new Set([
  "NODE_ENV", "APP_ENV", "JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH",
  "PORT", "DATA_DIR", "CURRENCY", "TRUST_PROXY", "DUSHANBE_CITY_WALLET", "ALIF_WALLET",
  "DC_PAY_URL", "ALIF_PAY_URL",
]);

function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (STRIPPED_KEYS.has(k)) continue;
    if (STRIPPED_PREFIXES.some((p) => k.startsWith(p))) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oshona-test-"));
}

/** Сервери асосиро роҳ медиҳад ва то омодагии /api/health интизор мешавад. */
async function startServer({ env = {}, dataDir, waitHealthy = true, timeoutMs = 15000 } = {}) {
  const port = await getFreePort();
  const ownDir = !dataDir;
  const dir = dataDir || tmpDataDir();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: dir, // cwd-и холӣ: .env-и рушди шумо ба тест роҳ намеёбад
    env: cleanEnv({
      PORT: String(port),
      DATA_DIR: dir,
      JWT_SECRET: TEST_JWT_SECRET,
      ADMIN_USERNAME: TEST_ADMIN_USER,
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      RATE_LIMIT_SCALE: "100", // тестҳо бисёр фармоиш месозанд; маҳдудияти ҳақиқиро тестҳои махсус месанҷанд
      ...env,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));

  const handle = {
    base, port, dir, child,
    getLog: () => log,
    exited,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
      await exited;
      // Директорияи муваққатии худи тест тоза карда мешавад
      if (ownDir) fs.rmSync(dir, { recursive: true, force: true });
    },
  };

  if (!waitHealthy) return handle;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = child.exitCode;
    if (code !== null) throw new Error(`Сервер пеш аз омода шудан хомӯш шуд (код ${code}):\n${log}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return handle;
    } catch { /* ҳанӯз омода нест */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  await handle.stop();
  throw new Error(`Сервер дар ${timeoutMs}ms омода нашуд:\n${log}`);
}

/** HTTP helper: JSON/raw body, Bearer, сарлавҳаҳои иловагӣ. */
async function http(base, method, urlPath, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  let payload;
  if (raw !== undefined) {
    payload = raw;
  } else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(base + urlPath, { method, headers: h, body: payload, redirect: "manual" });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, text, json };
}

async function adminLogin(base, { username = TEST_ADMIN_USER, password = TEST_ADMIN_PASSWORD } = {}) {
  const r = await http(base, "POST", "/api/auth/login", { body: { username, password } });
  if (r.status !== 200 || !r.json?.token) throw new Error(`Login ноком: ${r.status} ${r.text}`);
  return r.json.token;
}

/** Сохтани фармоиш ва баргардонидани ҳама маълумоти он (аз ҷумла токени дастрасӣ). */
async function createOrder(base, body) {
  return http(base, "POST", "/api/orders", {
    body: {
      customerName: "Тест Мизоҷ",
      phone: "+992 90 111 22 33",
      address: "Душанбе, кӯчаи Сино 1",
      method: "delivery",
      paymentMethod: "online",
      paymentProvider: "manual",
      items: [{ foodId: 1, quantity: 1 }],
      ...body,
    },
  });
}

/** Ҳеders барои дастрасии мизоҷ ба фармоиши худаш (агар сервер токен дода бошад). */
function orderAuth(order) {
  return order && order.accessToken ? { "X-Order-Token": order.accessToken } : {};
}

module.exports = {
  ROOT,
  TEST_ADMIN_USER,
  TEST_ADMIN_PASSWORD,
  TEST_JWT_SECRET,
  cleanEnv,
  getFreePort,
  tmpDataDir,
  startServer,
  http,
  adminLogin,
  createOrder,
  orderAuth,
};
