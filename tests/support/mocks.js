/**
 * Серверҳои сохтаи HTTP барои санҷиши интеграсия:
 *  - mock OpenRouter (chat/completions) бо натиҷаҳои скриптӣ (429, timeout, посухи холӣ, 401...);
 *  - mock Telegram Bot API (sendMessage) — паёмҳоро ҷамъ мекунад.
 * Ҳеҷ дархости берунии воқеӣ нест.
 */
const http = require("node:http");

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/**
 * handler(model, callIndexForModel, parsedBody) → { status, body, headers?, delayMs? } | "hang"
 */
async function startMockOpenRouter(handler) {
  const requests = [];
  const counts = new Map();
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { /* ҳеҷ */ }
    const model = parsed.model || "";
    const n = (counts.get(model) || 0) + 1;
    counts.set(model, n);
    requests.push({ url: req.url, method: req.method, auth: req.headers.authorization || "", model, body: parsed });
    const r = await handler(model, n, parsed);
    if (r === "hang") return; // сервер ҷавоб намедиҳад (timeout-и мизоҷ)
    if (r.delayMs) await new Promise((x) => setTimeout(x, r.delayMs));
    // OpenRouter ҷавобро бо майдони model (модели иҷрокунанда) бармегардонад
    let body = r.body;
    if (body && typeof body === "object" && body.choices) body = { ...body, model };
    res.writeHead(r.status, { "Content-Type": "application/json", ...(r.headers || {}) });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    requests,
    counts,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

async function startMockTelegram() {
  const messages = [];
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { /* ҳеҷ */ }
    if (/\/sendMessage$/.test(req.url)) messages.push({ ...parsed, _path: req.url });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { message_id: messages.length } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    messages,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { startMockOpenRouter, startMockTelegram };
