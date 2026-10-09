/* OSHONA Service Worker (v2)
 * Қоидаҳо:
 *  - кэши кӯҳна (oshona-v1, ки API-и хусусиро нигоҳ медошт) ҳангоми activate нест карда мешавад;
 *  - ҳеҷ гоҳ ҷавоби /api/ (фармоиш, админ, пардохт, бронкунӣ, AI) кэш намешавад;
 *  - дархостҳо бо Authorization ё X-Order-Token ҳеҷ гоҳ кэш намешаванд;
 *  - танҳо GET /api/foods (меню, ҷамъиятӣ) network-first кэш мешавад;
 *  - саҳифаҳои админ ва /uploads/ ҳеҷ гоҳ кэш намешаванд;
 *  - файлҳои статикии сайт cache-first; install ба ҳар як файл тобовар аст (як 404 нақшаро вайрон намекунад).
 */
const CACHE = "oshona-v2";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.webmanifest",
  "/icons/apple-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];
const PUBLIC_API = ["/api/foods"];

function isPrivate(request, url) {
  if (request.headers && typeof request.headers.has === "function") {
    if (request.headers.has("authorization") || request.headers.has("x-order-token")) return true;
  }
  if (url.pathname.startsWith("/api/") && !PUBLIC_API.includes(url.pathname)) return true;
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/uploads/")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(STATIC_ASSETS.map((u) => cache.add(u).catch(() => undefined)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok && res.type === "basic") cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!request || request.method !== "GET") return;
  const origin = (self.location && self.location.origin) || "";
  const url = new URL(request.url, origin || undefined);
  if (origin && url.origin !== origin) return; // шрифтҳо/расмҳои берунӣ — бевосита аз шабака
  if (isPrivate(request, url)) return; // ҳеҷ гоҳ кэш намешавад

  if (PUBLIC_API.includes(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request).catch(() => caches.match("/index.html")));
    return;
  }
  event.respondWith(cacheFirst(request));
});
