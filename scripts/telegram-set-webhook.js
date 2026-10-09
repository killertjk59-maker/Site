#!/usr/bin/env node
"use strict";

/**
 * Танзими webhook-и Telegram-бот (як бор, пас аз деплой).
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... PUBLIC_URL=https://your-app.up.railway.app \
 *     node scripts/telegram-set-webhook.js
 * Ин скрипт токенро дар журнал чоп намекунад.
 */
const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const publicUrl = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const apiBase = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

if (!token) fail("TELEGRAM_BOT_TOKEN танзим нашудааст.");
if (!secret || secret.length < 16) fail("TELEGRAM_WEBHOOK_SECRET танзим нашудааст ё кӯтоҳ аст (камаш 16 аломат, ҳарфу рақам).");
if (!/^https:\/\//.test(publicUrl)) fail("PUBLIC_URL бояд бо https:// оғоз шавад (масалан https://app.example.tj).");

(async () => {
  const url = `${publicUrl}/api/telegram/webhook`;
  const res = await fetch(`${apiBase}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) fail(`setWebhook ноком: ${res.status} ${body.description || ""}`);
  console.log(`✅ Webhook танзим шуд: ${url}`);
})().catch((err) => fail(`Хатогии шабака: ${err.message}`));
