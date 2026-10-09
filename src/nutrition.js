"use strict";

/**
 * Ҳисоби ғизоӣ дар backend: калория, сафеда, равған, карбогидрат аз рӯи таркиб ва вазни маҳсулот.
 * Модели забонӣ ҳеҷ гоҳ арзишҳои ғизоиро ихтироъ намекунад — онҳо аз ин модул меоянд.
 *
 * Қоида: агар барои ягон ингредиент маълумоти маҳсулот (маълумотнома) ё вазн набошад,
 * маҷмӯи калория ҳисоб намешавад (null) ва ин ошкоро нишон дода мешавад.
 */
const fs = require("node:fs");
const path = require("node:path");
const { normalizeKey, round0, round1 } = require("./util");

const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };
const CONFIDENCE_LEVELS = Object.keys(CONFIDENCE_RANK);

const ALLERGEN_LABELS = {
  gluten: "Глютен (ғалладонагиҳо)",
  crustaceans: "Харчанг ва майгу",
  eggs: "Тухм",
  fish: "Моҳӣ",
  peanuts: "Зардчӯба",
  soy: "Соя",
  milk: "Шир ва маҳсулоти ширӣ",
  nuts: "Меваҳои пӯстдор",
  celery: "Карафс",
  mustard: "Хардал",
  sesame: "Кунҷид",
  sulphites: "Сулфитҳо",
  lupin: "Лупин",
  molluscs: "Моллюскҳо",
};
const ALLERGEN_KEYS = Object.keys(ALLERGEN_LABELS);

/** Синонимҳо барои истисноҳои мизоҷ (аллергия/номатлуб) → калиди стандартӣ */
const AVOID_SYNONYMS = {
  gluten: ["глютен", "дарун", "ғалла", "гандум", "нон", "wheat", "gluten", "пшеница"],
  crustaceans: ["харчанг", "майгу", "креветка", "shrimp", "crustacean", "lobster", "краб"],
  eggs: ["тухм", "яйцо", "егг", "egg", "eggs", "тухмҳо"],
  fish: ["моҳӣ", "рыба", "fish", "лосось", "salmon"],
  peanuts: ["зардчӯба", "арахис", "peanut", "peanuts"],
  soy: ["соя", "soy", "соевый"],
  milk: ["шир", "молоко", "milk", "лактоза", "lactose", "панир", "сыр", "cheese", "қаймоқ", "сливки"],
  nuts: ["мағз", "орех", "nuts", "nut", "гӯзи", "бодом", "миндаль"],
  celery: ["карафс", "сельдерей", "celery"],
  mustard: ["хардал", "горчица", "mustard"],
  sesame: ["кунҷид", "кунжут", "sesame"],
  sulphites: ["сулфит", "sulphite", "sulfite", "шароб", "wine"],
  lupin: ["лупин", "lupin"],
  molluscs: ["моллюск", "мидия", "устриц", "mollusc", "mollusk"],
};

/** Тегҳо (барои номатлубҳои гуруҳӣ: гӯшт, хук, алкогол ...) */
const TAG_SYNONYMS = {
  meat: ["гӯшт", "гушт", "meat", "гов", "мол", "beef", "мурғ", "курица", "chicken", "хук", "pork", "гӯштӣ"],
  pork: ["хук", "pork", "свинина"],
  poultry: ["мурғ", "курица", "chicken", "poultry"],
  fish: ["моҳӣ", "рыба", "fish", "seafood", "баҳрӣ"],
  seafood: ["баҳрӣ", "seafood", "морепродукт"],
  alcohol: ["алкоголь", "шароб", "спирт", "alcohol", "wine", "пиво", "beer"],
  dairy: ["шир", "панир", "dairy", "сыр", "молочн"],
  vegetarian: ["вегетариан", "vegetarian", "бе гӯшт", "бегушт", "вегетар"],
  sugar: ["шакар", "sugar", "ширин", "сладк"],
};

const DEFAULT_CATALOG_PATH = path.join(__dirname, "..", "seed", "ingredients.json");

function loadIngredientCatalog(file = DEFAULT_CATALOG_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const items = Array.isArray(raw.items) ? raw.items : [];
  const index = new Map();
  for (const it of items) {
    const keys = [it.id, it.name, ...(it.aliases || [])].map(normalizeKey).filter(Boolean);
    for (const k of keys) if (!index.has(k)) index.set(k, it);
  }
  return {
    source: raw._meta?.source || "маълумотномаи ориентировӣ",
    items,
    find(name) {
      return index.get(normalizeKey(name)) || null;
    },
  };
}

function minConfidence(levels) {
  const valid = levels.filter((c) => CONFIDENCE_RANK[c]);
  if (!valid.length) return "low";
  return valid.reduce((a, b) => (CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b));
}

/**
 * Ҳисоби ғизоии як таом.
 * food.ingredients = [{ name, grams }], food.weightG (вазни порсия), food.nutritionSource, food.nutritionConfidence
 */
function computeFoodNutrition(food, catalog) {
  const ingredients = Array.isArray(food.ingredients) ? food.ingredients : [];
  const declaredConfidence = CONFIDENCE_RANK[food.nutritionConfidence] ? food.nutritionConfidence : "low";
  const base = {
    weightG: food.weightG || null,
    calories: null,
    protein: null,
    fat: null,
    carbs: null,
    per100g: null,
    missingIngredients: [],
    source: food.nutritionSource || null,
    confidence: null,
    warnings: [],
  };

  if (!ingredients.length) {
    base.status = "none";
    base.warnings.push("no_recipe");
    return base;
  }

  let kcal = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  let sumGrams = 0;
  const refConfidences = [];

  for (const ing of ingredients) {
    const grams = Number(ing.grams);
    const ref = catalog.find(ing.name);
    if (!ref) {
      base.missingIngredients.push(ing.name);
      continue;
    }
    if (!(grams > 0)) {
      base.missingIngredients.push(ing.name);
      continue;
    }
    const k = grams / 100;
    kcal += ref.kcal * k;
    protein += ref.protein * k;
    fat += ref.fat * k;
    carbs += ref.carbs * k;
    sumGrams += grams;
    refConfidences.push(ref.confidence);
  }

  if (base.missingIngredients.length) {
    base.status = "partial";
    base.confidence = "low";
    base.warnings.push("missing_ingredient_data");
    return base;
  }

  const portion = food.weightG && food.weightG > 0 ? Number(food.weightG) : sumGrams;
  let confidence = minConfidence([declaredConfidence, ...refConfidences]);
  if (food.weightG && sumGrams && Math.abs(sumGrams - food.weightG) / food.weightG > 0.3) {
    base.warnings.push("weight_mismatch");
    confidence = "low";
  }

  base.status = "computed";
  base.calories = round0(kcal);
  base.protein = round1(protein);
  base.fat = round1(fat);
  base.carbs = round1(carbs);
  base.weightG = portion;
  base.per100g = {
    calories: round0((kcal * 100) / portion),
    protein: round1((protein * 100) / portion),
    fat: round1((fat * 100) / portion),
    carbs: round1((carbs * 100) / portion),
  };
  base.confidence = confidence;
  if (!base.source) base.source = `ҳисоб аз маълумотномаи ориентировӣ: ${catalog.source}`;
  return base;
}

/** Аллергенҳо/тегҳои ҳосилшуда: эълоншуда + аз таркиби ингредиентҳо */
function deriveSafetyFacts(food, catalog) {
  const allergens = new Set((food.allergens || []).filter((a) => ALLERGEN_KEYS.includes(a)));
  const tags = new Set((food.tags || []).map((t) => String(t).toLowerCase()));
  for (const ing of food.ingredients || []) {
    const ref = catalog.find(ing.name);
    if (!ref) continue;
    for (const a of ref.allergens || []) if (ALLERGEN_KEYS.includes(a)) allergens.add(a);
    for (const t of ref.tags || []) tags.add(t);
  }
  return { allergens: [...allergens].sort(), tags: [...tags].sort() };
}

/**
 * Истисноҳо (аллергия/номатлуб) → ҳалли стандартӣ.
 * Қоида: агар матн калиди аллерген/тег бошад, он ба аллерген ё тег мепайвандад;
 * дар акси ҳол матни озод (ном/ингредиент) истифода мешавад.
 */
function resolveAvoidTerms(terms) {
  const out = [];
  for (const raw of terms || []) {
    const t = normalizeKey(raw);
    if (!t) continue;
    let matched = false;
    for (const [key, syns] of Object.entries(AVOID_SYNONYMS)) {
      if (t === key || syns.some((s) => normalizeKey(s) === t || (t.length >= 4 && normalizeKey(s).startsWith(t)))) {
        out.push({ type: "allergen", key, raw: t });
        matched = true;
        break;
      }
    }
    if (matched) continue;
    for (const [key, syns] of Object.entries(TAG_SYNONYMS)) {
      if (t === key || syns.some((s) => normalizeKey(s) === t)) {
        out.push({ type: "tag", key, raw: t });
        matched = true;
        break;
      }
    }
    if (!matched) out.push({ type: "text", key: t, raw: t });
  }
  return out;
}

/** Оё таом бо истисноҳо мувофиқат мекунад? (true = бояд рад шавад) */
function violatesAvoid(food, catalog, avoid) {
  if (!avoid || !avoid.length) return false;
  const facts = deriveSafetyFacts(food, catalog);
  const name = normalizeKey(food.name);
  const hay = normalizeKey(`${food.name} ${food.description || ""} ${food.category || ""}`);
  const ingNames = (food.ingredients || []).map((i) => normalizeKey(i.name));
  for (const a of avoid) {
    if (a.type === "allergen" && facts.allergens.includes(a.key)) return true;
    if (a.type === "tag" && facts.tags.includes(a.key)) return true;
    if (a.type === "text") {
      if (name.includes(a.key) || ingNames.some((n) => n.includes(a.key) || a.key.includes(n))) return true;
      if (a.key.length >= 4 && hay.includes(a.key)) return true;
    }
  }
  return false;
}

module.exports = {
  ALLERGEN_LABELS,
  ALLERGEN_KEYS,
  CONFIDENCE_LEVELS,
  CONFIDENCE_RANK,
  loadIngredientCatalog,
  computeFoodNutrition,
  deriveSafetyFacts,
  resolveAvoidTerms,
  violatesAvoid,
  minConfidence,
};
