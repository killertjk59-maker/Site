"use strict";

/**
 * Тавсияҳои қоидавӣ (бе AI): буҷет, таъм, ҳадаф, ва гуногунии категорияҳо.
 * Ин механизм ҳамеша дастрас аст ва ҳамчун захира ба AI истифода мешавад.
 * Ҳеҷ нишондиҳандаи ғизоиеро ихтироъ намекунад: калория танҳо аз nutrition-и таом.
 */
const { normalizeKey } = require("./util");

const TASTE_HINTS = {
  "гӯшт": ["meat", "гов", "мурғ", "гушт", "гӯшт", "бургер", "стейк", "steak"],
  "гушт": ["meat"],
  "мурғ": ["poultry", "мурғ", "курица", "chicken"],
  "моҳӣ": ["fish", "seafood", "лосось", "майгу"],
  "сабзавот": ["vegetable", "салат", "сабзавот", "помидор", "занбӯруғ"],
  "вегетариан": ["vegetarian", "vegetable"],
  "ширин": ["sugar", "ширин", "десерт", "чизкейк", "тути", "шакар"],
  "тунд": ["тунд", "spicy", "чили", "перец"],
  "нӯшокӣ": ["drink", "нӯшок", "напит", "мохито", "лимонад", "шарбат"],
  "паста": ["паста", "pasta"],
  "пицца": ["пицца", "pizza"],
};

const WORDS_FROM = (s) => normalizeKey(s).split(/[\s,;|/]+/).filter((w) => w.length >= 3);

function tasteScore(food, tastes) {
  if (!tastes.length) return { score: 0, hits: [] };
  const hay = normalizeKey(`${food.name} ${food.category} ${food.description || ""} ${(food.tags || []).join(" ")}`);
  const hits = [];
  for (const t of tastes) {
    const key = normalizeKey(t);
    const hints = TASTE_HINTS[key] || [];
    const words = [key, ...hints, ...WORDS_FROM(t)].map(normalizeKey).filter((w) => w.length >= 3);
    if (words.some((w) => hay.includes(w))) hits.push(t);
  }
  return { score: hits.length * 3, hits };
}

function reasonFor(food, facts) {
  const parts = [];
  if (facts.taste.length) parts.push(`ба таъми шумо мувофиқ аст (${facts.taste.join(", ")})`);
  if (facts.budget) parts.push(`дар доираи буҷети шумо (${food.price} с.)`);
  if (facts.protein && food.nutrition && food.nutrition.protein !== null) {
    parts.push(`сафедаи баланд: ${food.nutrition.protein} г (ҳисоби таркиб)`);
  }
  if (facts.light && food.nutrition && food.nutrition.calories !== null) {
    parts.push(`калорияи пасттар: ${food.nutrition.calories} ккал (ҳисоби таркиб)`);
  }
  if (!parts.length) parts.push("аз менюи мо; таркиб ва ғизо дар карточка")
  return parts.join("; ");
}

/**
 * Тартиб додани таомҳо.
 * @param {Array} foods — DTO-и публикии таомҳо (menu.publicFood) бо nutrition
 * @param {object} prefs — аз normalizePreferences
 */
function rankFoods(foods, prefs, { max = 4 } = {}) {
  const budget = prefs.budget;
  const goal = prefs.goal;
  const cals = foods.map((f) => f.nutrition && f.nutrition.calories).filter((x) => x !== null && x !== undefined);
  const prots = foods.map((f) => f.nutrition && f.nutrition.protein).filter((x) => x !== null && x !== undefined);
  const maxCal = cals.length ? Math.max(...cals) : null;
  const maxProt = prots.length ? Math.max(...prots) : null;

  const scored = foods.map((food) => {
    const t = tasteScore(food, prefs.tastes || []);
    let score = 1 + t.score;
    const facts = { taste: t.hits, budget: false, light: false, protein: false };
    if (budget !== null && budget !== undefined && food.price <= budget) {
      score += 1;
      facts.budget = true;
    }
    const n = food.nutrition || {};
    if (goal === "light" && n.calories !== null && n.calories !== undefined && maxCal) {
      score += 2 * (1 - n.calories / maxCal);
      facts.light = true;
    }
    if (goal === "protein" && n.protein !== null && n.protein !== undefined && maxProt) {
      score += 2 * (n.protein / maxProt);
      facts.protein = true;
    }
    if (n.calories !== null && n.calories !== undefined) score += 0.2; // маълумоти тасдиқшуда афзалият дорад
    return { food, score, facts };
  });
  scored.sort((a, b) => b.score - a.score || a.food.price - b.food.price || a.food.id - b.food.id);

  const picked = [];
  const usedCats = new Set();
  let spent = 0;
  const fits = (f) => budget === null || budget === undefined || spent + f.price <= budget;

  // Аввал як таом аз ҳар категория (гуногунӣ), сипас бақия
  for (const pass of [0, 1]) {
    for (const s of scored) {
      if (picked.length >= max) break;
      if (picked.some((p) => p.food.id === s.food.id)) continue;
      if (pass === 0 && usedCats.has(s.food.category)) continue;
      if (!fits(s.food)) continue;
      picked.push(s);
      usedCats.add(s.food.category);
      spent += s.food.price;
    }
  }

  return picked.map((s) => ({
    foodId: s.food.id,
    name: s.food.name,
    price: s.food.price,
    category: s.food.category,
    reason: reasonFor(s.food, s.facts),
    nutrition: s.food.nutrition && s.food.nutrition.status === "computed"
      ? {
          calories: s.food.nutrition.calories,
          protein: s.food.nutrition.protein,
          fat: s.food.nutrition.fat,
          carbs: s.food.nutrition.carbs,
          confidence: s.food.nutrition.confidence,
          source: s.food.nutrition.source,
        }
      : null,
  }));
}

module.exports = { rankFoods, tasteScore, TASTE_HINTS };
