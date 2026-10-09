"use strict";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round1 = (n) => Math.round((Number(n) + Number.EPSILON) * 10) / 10;
const round0 = (n) => Math.round(Number(n) + Number.EPSILON);

/** Калиди рӯз (YYYY-MM-DD) дар минтақаи Душанбе (UTC+5, бе DST) */
function dayKey(date, offsetHours = 5) {
  const d = date instanceof Date ? date : new Date(date);
  const shifted = new Date(d.getTime() + offsetHours * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** Оғози рӯзи ҷорӣ (UTC-миллисония) дар минтақаи Душанбе */
function startOfTodayMs(now = Date.now(), offsetHours = 5) {
  const key = dayKey(now, offsetHours);
  return Date.parse(`${key}T00:00:00Z`) - offsetHours * 3600 * 1000;
}

/** Рӯйхат ба ID-и адади мусбат табдил меёбад (нодурустҳо партофта мешаванд) */
function toIdList(values) {
  return [...new Set((values || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Ҷустуҷӯи нишондиҳанда (нормализатсия: lower, фазоҳо, ё/е) */
function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { round0, round1, round2, dayKey, startOfTodayMs, toIdList, normalizeKey };
