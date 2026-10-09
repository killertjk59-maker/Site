"use strict";

/**
 * Мехоҳишҳои мизоҷ (буҷет, таъм, истисноҳо, ҳадаф) ва ҳимояи наврасон/лоғаршавӣ.
 * Аллергия ва истисноҳо ҷиддӣ гирифта мешаванд: номаълум → рад (бе бахшиш).
 */
const v = require("./validation");
const { resolveAvoidTerms } = require("./nutrition");
const { normalizeKey } = require("./util");

const WEIGHT_LOSS_WORDS = [
  "лоғар", "лоғарӣ", "вазни худро кам", "вазн кам", "вазнро кам", "парҳез", "диет", "похуд", "похудеть",
  "худро ланд", "калорияро кам", "калория кам", "ҳадди калория", "голод", "голодать", "weight loss",
  "lose weight", "diet", "slim", "слим", "калорийность кам", "минус килограмм", "кг кам",
];

const GOALS = ["balanced", "light", "protein"];
const TASTE_MAX = 8;
const AVOID_MAX = 12;

/** Синну соли аз матн: «ман 15 сол», «мне 15 лет», «I am 15 years old» */
function ageFromText(text) {
  const s = normalizeKey(text);
  const m = /(?<!\d)(\d{1,2})\s*(сол|соли|сола|лет|год|years?|yo)(?!\p{L})/u.exec(s);
  if (!m) return null;
  const age = Number(m[1]);
  return age >= 1 && age <= 110 ? age : null;
}

/** Ошкор кардани ҳолатҳои ҳимояшаванда: наврасӣ ва хостани лоғаршавӣ/ҳадди калория */
function detectSafetyIntents(text, { age = null } = {}) {
  const s = normalizeKey(text);
  const textAge = ageFromText(s);
  const effectiveAge = age ?? textAge;
  const minor = Boolean(effectiveAge !== null && effectiveAge < 18) || /наврас|школьник|teen|подрост/.test(s);
  const weightLoss = WEIGHT_LOSS_WORDS.some((w) => s.includes(normalizeKey(w)));
  return { minor, weightLoss, age: effectiveAge };
}

function normalizePreferences(raw, { text = "", age = null } = {}) {
  const b = raw && typeof raw === "object" ? raw : {};
  let budget = null;
  if (b.budget !== undefined && b.budget !== null && b.budget !== "") {
    budget = v.num(b.budget, { field: "Буҷет", min: 1, max: 100000, decimals: 2 });
  }
  const tastes = (Array.isArray(b.tastes) ? b.tastes : [])
    .slice(0, TASTE_MAX)
    .map((t) => v.str(t, { field: "Таъм", max: 30 }))
    .filter(Boolean);
  const avoidRaw = (Array.isArray(b.avoid) ? b.avoid : [])
    .slice(0, AVOID_MAX)
    .map((t) => v.str(t, { field: "Истисно", max: 40 }))
    .filter(Boolean);
  const goal = GOALS.includes(b.goal) ? b.goal : "balanced";
  const intents = detectSafetyIntents(`${text} ${tastes.join(" ")} ${avoidRaw.join(" ")}`, {
    age: b.age !== undefined ? Number(b.age) : age,
  });
  // Наврасон ва ҳадафи лоғаршавӣ: ҳадафи «сабук» (калория кам) ғайрифаъол мешавад
  const effectiveGoal = intents.minor || intents.weightLoss ? (goal === "light" ? "balanced" : goal) : goal;
  return {
    budget,
    tastes,
    avoidRaw,
    avoid: resolveAvoidTerms(avoidRaw),
    goal: effectiveGoal,
    requestedGoal: goal,
    minor: intents.minor || b.minor === true,
    weightLoss: intents.weightLoss,
    age: intents.age,
    restrictedAdvice: intents.minor || intents.weightLoss,
  };
}

module.exports = { normalizePreferences, detectSafetyIntents, ageFromText, WEIGHT_LOSS_WORDS };
