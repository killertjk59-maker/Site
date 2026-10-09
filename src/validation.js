"use strict";

/**
 * Санҷиши маълумоти воридшаванда. Ҳар функсия қиматро бо тип ва ҳудуд мегардонад
 * ё HttpError(400) мепартояд. Матн ҳамеша тоза (control chars, ҳад) ва бе тегҳои HTML аст.
 */
const { HttpError } = require("./security");

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAG_HINT = /[<>]/;

function fail(field, msg) {
  return new HttpError(400, `${field}: ${msg}`, "VALIDATION");
}

/** Матни озод: control chars → холӣ, фазоҳо ҷамъ, бе < > (барои амнияти XSS) */
function cleanText(value) {
  return String(value ?? "").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

function str(value, { field = "Майдон", min = 0, max = 200, required = false, allowHtml = false, pattern, label } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw fail(label || field, "ҳатмист");
    return "";
  }
  if (typeof value !== "string" && typeof value !== "number") throw fail(label || field, "матн бояд бошад");
  const v = cleanText(value);
  if (!v && required) throw fail(label || field, "ҳатмист");
  if (v.length < min) throw fail(label || field, `камаш ${min} аломат лозим аст`);
  if (v.length > max) throw fail(label || field, `аз ${max} аломат зиёд нест`);
  if (!allowHtml && HTML_TAG_HINT.test(v)) throw fail(label || field, "аломатҳои манъшуда (< >) дорад");
  if (pattern && !pattern.test(v)) throw fail(label || field, "формати нодуруст дорад");
  return v;
}

function num(value, { field = "Адад", min = -Infinity, max = Infinity, required = false, decimals = 2, label } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw fail(label || field, "ҳатмист");
    return null;
  }
  if (typeof value === "boolean" || (typeof value !== "number" && typeof value !== "string")) {
    throw fail(label || field, "адади дуруст лозим аст");
  }
  const s = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (typeof s === "string" && !/^-?\d+(\.\d+)?$/.test(s)) throw fail(label || field, "адади дуруст лозим аст");
  const n = Number(s);
  if (!Number.isFinite(n)) throw fail(label || field, "адади дуруст лозим аст");
  if (n < min || n > max) throw fail(label || field, `бояд дар ҳудуди ${min}…${max} бошад`);
  const factor = 10 ** decimals;
  const scaled = n * factor;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-7) {
    throw fail(label || field, `то ${decimals} рақами касрӣ`);
  }
  return Math.round(scaled) / factor;
}

function int(value, { field = "Адад", min = -Infinity, max = Infinity, required = false, label } = {}) {
  const n = num(value, { field, min, max, required, decimals: 0, label });
  return n === null ? null : n;
}

function oneOf(value, list, { field = "Майдон", required = true, label } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw fail(label || field, "ҳатмист");
    return null;
  }
  if (!list.includes(value)) throw fail(label || field, `яке аз: ${list.join(", ")}`);
  return value;
}

const PHONE_RE = /^\+?[0-9][0-9 ()\-]{6,22}[0-9]$/;

/** Телефон: 9–15 рақам, ихтиёран бо +992 */
function phone(value, { field = "Телефон", required = true } = {}) {
  const raw = str(value, { field, required, max: 25 });
  if (!raw) return "";
  if (!PHONE_RE.test(raw)) throw fail(field, "формати нодуруст (масалан +992 90 000 00 00)");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) throw fail(field, "бояд 9 то 15 рақам дошта бошад");
  return raw;
}

/** Сана YYYY-MM-DD ва воқеӣ (мисли 2026-02-30 рад мешавад) */
function isoDate(value, { field = "Сана", required = true } = {}) {
  const v = str(value, { field, required, max: 10 });
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) throw fail(field, "формати YYYY-MM-DD лозим аст");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw fail(field, "санаи нодуруст");
  }
  return v;
}

/** Вақт HH:MM (00:00–23:59) */
function timeHHMM(value, { field = "Вақт", required = true } = {}) {
  const v = str(value, { field, required, max: 5 });
  if (!v) return "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw fail(field, "формати HH:MM лозим аст");
  return v;
}

/** Чен кардани объект ва майдонҳои иҷозатдодашуда */
function object(value, field = "Дархост") {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw fail(field, "объект лозим аст");
  return value;
}

function array(value, { field = "Рӯйхат", min = 0, max = 100, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw fail(field, "ҳатмист");
    return [];
  }
  if (!Array.isArray(value)) throw fail(field, "рӯйхат лозим аст");
  if (value.length < min) throw fail(field, `камаш ${min} unsur лозим аст`);
  if (value.length > max) throw fail(field, `зиёда аз ${max} unsur нест`);
  return value;
}

module.exports = {
  cleanText,
  str,
  num,
  int,
  oneOf,
  phone,
  isoDate,
  timeHHMM,
  object,
  array,
  fail,
};
