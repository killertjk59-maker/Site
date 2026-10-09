"use strict";

/**
 * Дастурҳои пардохти онлайн (ҳамён/линк/QR). Пардохт ҳамон тавр дастӣ аст:
 * мизоҷ ба ҳамёни OSHONA пул мефиристад ва бо коди фармоиш (comment) он муайян мешавад.
 * Тасдиқ/рад танҳо аз ҷониби админ (AI ҳеҷ гоҳ).
 */
const crypto = require("node:crypto");
const QRCode = require("qrcode");

// Ҳарфҳои бе ихтилоф (бе 0/O, 1/I/L)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Коди фармоиш бо crypto (на Math.random) */
function makePaymentCode() {
  let out = "";
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `OSH-${out}`;
}

function fillLink(template, { wallet, amount, code }) {
  if (!template) return null;
  return template
    .split("{wallet}").join(encodeURIComponent(wallet))
    .split("{amount}").join(encodeURIComponent(String(amount)))
    .split("{code}").join(encodeURIComponent(code));
}

async function makeQr({ amount, wallet, code, currency }) {
  try {
    return await QRCode.toDataURL(`OSHONA | Сумма: ${amount} ${currency} | Хамён: ${wallet} | Код: ${code}`, {
      width: 240,
      margin: 2,
    });
  } catch {
    return null;
  }
}

/** Дастурҳои пардохт барои фармоиши онлайн (сумма аз сервер) */
async function buildPaymentInstructions(order, config) {
  const { dushanbeCity, alif } = config.wallets;
  const amount = order.total;
  const dcLink = fillLink(dushanbeCity.payUrl, { wallet: dushanbeCity.wallet, amount, code: order.paymentCode });
  const alifLink = fillLink(alif.payUrl, { wallet: alif.wallet, amount, code: order.paymentCode });
  const qr = await makeQr({
    amount,
    wallet: dushanbeCity.wallet,
    code: order.paymentCode,
    currency: config.currency,
  });
  return {
    dushanbeCity: `${dushanbeCity.wallet} (${dushanbeCity.name})`,
    alif: `${alif.wallet} (${alif.name})`,
    dcWallet: dushanbeCity.wallet,
    alifWallet: alif.wallet,
    dcLink,
    alifLink,
    comment: order.paymentCode,
    amount,
    promo: order.promo,
    discount: order.discount || 0,
    qr,
  };
}

module.exports = { makePaymentCode, buildPaymentInstructions, fillLink, CODE_ALPHABET };
