"use strict";

/**
 * Промокодҳо: санҷиш, ҳисоби тахфиф, ҳудуди амал (мӯҳлат, ҳадди истифода).
 */
const { HttpError } = require("./security");
const v = require("./validation");
const { round2 } = require("./util");

const MAX_AMOUNT_DISCOUNT = 100000;

function normalizeCode(code) {
  return String(code ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .toUpperCase()
    .slice(0, 32);
}

function normalizePromo(raw) {
  return {
    code: normalizeCode(raw.code),
    type: raw.type === "amount" ? "amount" : "percent",
    value: Number(raw.value),
    minTotal: Math.max(0, Number(raw.minTotal) || 0),
    active: raw.active !== false,
    expiresAt: raw.expiresAt || null,
    maxUses: raw.maxUses ? Number(raw.maxUses) : null,
    uses: Number(raw.uses) || 0,
    createdAt: raw.createdAt || null,
  };
}

/** Санҷиши ворид барои промои нав */
function validatePromoInput(body) {
  const b = v.object(body);
  const code = normalizeCode(b.code);
  if (!code || code.length < 3) throw v.fail("Код", "камаш 3 аломати A-Z/0-9 лозим аст");
  const type = v.oneOf(b.type || "percent", ["percent", "amount"], { field: "Намуд" });
  const value = v.num(b.value, { field: "Миқдор", required: true, min: 0.01, max: type === "percent" ? 100 : MAX_AMOUNT_DISCOUNT, decimals: 2 });
  const minTotal = v.num(b.minTotal, { field: "Ҳадди ақали сумма", min: 0, max: 100000, decimals: 2 }) ?? 0;
  let expiresAt = null;
  if (b.expiresAt) {
    const d = Date.parse(String(b.expiresAt));
    if (!Number.isFinite(d)) throw v.fail("Мӯҳлат", "формати санаи нодуруст");
    expiresAt = new Date(d).toISOString();
  }
  const maxUses = b.maxUses ? v.int(b.maxUses, { field: "Ҳадди истифода", min: 1, max: 1000000 }) : null;
  return { code, type, value, minTotal, expiresAt, maxUses };
}

/**
 * Ҳисоби тахфиф барои ҷамъи маҳсулот (subtotal).
 * Бозгашт: { promo, discount, total } ё HttpError(400) бо паёми фаҳмо.
 */
function applyPromo(promos, code, subtotal, { now = Date.now() } = {}) {
  if (!code) return { promo: null, discount: 0, total: round2(subtotal) };
  const clean = normalizeCode(code);
  if (!clean) throw new HttpError(400, "Промокод нодуруст аст.", "PROMO_INVALID");
  const p = promos.find((x) => x.code === clean);
  if (!p || p.active === false) throw new HttpError(400, "Промокод нодуруст ё ғайрифаъол.", "PROMO_INVALID");
  if (p.expiresAt && Date.parse(p.expiresAt) < now) {
    throw new HttpError(400, "Мӯҳлати промокод гузаштааст.", "PROMO_EXPIRED");
  }
  if (p.maxUses && (p.uses || 0) >= p.maxUses) {
    throw new HttpError(400, "Промокод аллакай ба ҳадди истифода расидааст.", "PROMO_EXHAUSTED");
  }
  if (p.minTotal && subtotal < p.minTotal) {
    throw new HttpError(400, `Барои ин промокод ҳадди ақал ${p.minTotal} с. лозим.`, "PROMO_MIN_TOTAL");
  }
  // Формулаи расмии кӯҳна: тахфиф фоизӣ то бутун (Math.round) — рафтори пардохт тағйир намеёбад
  let discount = p.type === "amount" ? Number(p.value) : Math.round((subtotal * p.value) / 100);
  discount = Math.min(Math.max(discount, 0), subtotal);
  return { promo: p.code, discount: round2(discount), total: round2(subtotal - discount) };
}

module.exports = { normalizeCode, normalizePromo, validatePromoInput, applyPromo, MAX_AMOUNT_DISCOUNT };
