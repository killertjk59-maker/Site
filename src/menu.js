"use strict";

/**
 * Меню (таомҳо): нормализатсия, санҷиши воридшаванда, DTO-ҳо.
 */
const { HttpError } = require("./security");
const v = require("./validation");
const nutrition = require("./nutrition");

const IMAGE_LOCAL_RE = /^\/uploads\/[A-Za-z0-9._-]{1,120}$/;
const IMAGE_HTTPS_RE = /^https:\/\/[^\s"'<>]{4,500}$/i;

/** Майдонҳои стандартӣ барои таомҳои нав ё қадимӣ (файлҳои кӯҳна) */
function normalizeFood(raw) {
  return {
    id: Number(raw.id),
    name: String(raw.name || ""),
    category: String(raw.category || raw.cat || "Асосӣ"),
    price: Number(raw.price),
    image: String(raw.image || raw.img || ""),
    description: String(raw.description || raw.desc || ""),
    available: raw.available !== false,
    weightG: raw.weightG ? Number(raw.weightG) : null,
    ingredients: Array.isArray(raw.ingredients)
      ? raw.ingredients.map((i) => ({ name: String(i.name), grams: Number(i.grams) }))
      : [],
    allergens: Array.isArray(raw.allergens) ? raw.allergens.filter((a) => nutrition.ALLERGEN_KEYS.includes(a)) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).toLowerCase()).slice(0, 12) : [],
    nutritionSource: raw.nutritionSource ? String(raw.nutritionSource) : null,
    nutritionConfidence: nutrition.CONFIDENCE_RANK[raw.nutritionConfidence] ? raw.nutritionConfidence : null,
    demo: raw.demo === true,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

function validateImage(value) {
  const s = v.str(value, { field: "Расм", max: 500 });
  if (!s) return "";
  if (IMAGE_LOCAL_RE.test(s) || IMAGE_HTTPS_RE.test(s)) return s;
  throw v.fail("Расм", "танҳо URL-и https:// ё файли аз сервер боршуда (/uploads/...) иҷозат аст");
}

/**
 * Санҷиши таом. partial=true барои PUT (танҳо майдонҳои фиристодашуда).
 */
function validateFoodInput(body, { partial = false } = {}) {
  const b = v.object(body);
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;

  if (!partial || has("name")) out.name = v.str(b.name, { field: "Ном", required: true, min: 2, max: 120 });
  if (!partial || has("category")) out.category = v.str(b.category, { field: "Категория", max: 40, min: 0 }) || "Асосӣ";
  if (!partial || has("price")) out.price = v.num(b.price, { field: "Нарх", required: true, min: 0.01, max: 100000, decimals: 2 });
  if (has("image")) out.image = validateImage(b.image);
  if (!partial && b.image === undefined) out.image = "";
  if (!partial || has("description")) out.description = v.str(b.description, { field: "Тавсиф", max: 500 });
  if (has("available")) {
    if (typeof b.available !== "boolean") throw v.fail("Фаъол", "бул (true/false) лозим аст");
    out.available = b.available;
  }
  if (has("weightG")) out.weightG = v.num(b.weightG, { field: "Вазни порсия", min: 1, max: 5000, decimals: 0 });
  if (has("ingredients")) {
    const list = v.array(b.ingredients, { field: "Таркиб", max: 60 });
    out.ingredients = list.map((it, i) => {
      if (!it || typeof it !== "object") throw v.fail("Таркиб", `unsur #${i + 1} нодуруст аст`);
      const name = v.str(it.name, { field: `Таркиб #${i + 1}`, required: true, min: 1, max: 80 });
      const grams = v.num(it.grams, { field: `Миқдор (г) #${i + 1}`, required: true, min: 0.1, max: 5000, decimals: 1 });
      return { name, grams };
    });
  }
  if (has("allergens")) {
    const list = v.array(b.allergens, { field: "Аллергенҳо", max: 14 });
    for (const a of list) {
      if (!nutrition.ALLERGEN_KEYS.includes(a)) throw v.fail("Аллергенҳо", `калиди номаълум: ${String(a).slice(0, 20)}`);
    }
    out.allergens = [...new Set(list)];
  }
  if (has("tags")) {
    const list = v.array(b.tags, { field: "Тегҳо", max: 12 });
    out.tags = [...new Set(list.map((t) => v.str(t, { field: "Тег", max: 30, min: 1 }).toLowerCase()).filter(Boolean))];
  }
  if (has("nutritionSource")) out.nutritionSource = v.str(b.nutritionSource, { field: "Манбаи маълумоти ғизоӣ", max: 200 }) || null;
  if (has("nutritionConfidence")) {
    if (b.nutritionConfidence === null || b.nutritionConfidence === "") out.nutritionConfidence = null;
    else out.nutritionConfidence = v.oneOf(b.nutritionConfidence, nutrition.CONFIDENCE_LEVELS, { field: "Дараҷаи эътимоднокӣ", required: false });
  }
  return out;
}

function foodBase(food, catalog) {
  const n = nutrition.computeFoodNutrition(food, catalog);
  const safety = nutrition.deriveSafetyFacts(food, catalog);
  return {
    id: food.id,
    name: food.name,
    category: food.category,
    price: food.price,
    image: food.image,
    description: food.description,
    available: food.available !== false,
    weightG: n.weightG,
    ingredients: food.ingredients.map((i) => ({ name: i.name, grams: i.grams })),
    allergens: safety.allergens.map((key) => ({ key, label: nutrition.ALLERGEN_LABELS[key] })),
    tags: safety.tags,
    nutrition: {
      status: n.status,
      calories: n.calories,
      protein: n.protein,
      fat: n.fat,
      carbs: n.carbs,
      per100g: n.per100g,
      source: n.source,
      confidence: n.confidence,
      warnings: n.warnings,
    },
  };
}

/** DTO барои мизоҷ (ҷамъбаст + таркиби эълоншуда) */
function publicFood(food, catalog) {
  return foodBase(food, catalog);
}

/** DTO барои админ: + маълумоти танзимоти дохилӣ */
function adminFood(food, catalog) {
  const dto = foodBase(food, catalog);
  dto.nutrition.missingIngredients = nutrition.computeFoodNutrition(food, catalog).missingIngredients;
  dto.demo = food.demo === true;
  dto.nutritionSourceDeclared = food.nutritionSource;
  dto.nutritionConfidenceDeclared = food.nutritionConfidence;
  dto.updatedAt = food.updatedAt;
  return dto;
}

function assertFoodExists(food, id) {
  if (!food) throw new HttpError(404, "Таом ёфт нашуд.", "NOT_FOUND");
  return food;
}

/** Тақсимоти категорияҳо аз меню (барои фильтр) */
function categoriesOf(foods) {
  return [...new Set(foods.filter((f) => f.available !== false).map((f) => f.category))];
}

module.exports = {
  normalizeFood,
  validateFoodInput,
  publicFood,
  adminFood,
  assertFoodExists,
  categoriesOf,
};
