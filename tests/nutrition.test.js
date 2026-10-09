/**
 * Ҳисоби калория ва макроҳо бо маълумоти маълум (ҳисоби дастӣ дар шарҳҳо).
 * Маълумотномаи таркиб: seed/ingredients.json
 *   Паста (пухта): 158 ккал, сафеда 5.8, равған 0.9, карбо 30.9 (дар 100 г)
 *   Пармезан:      431 ккал, сафеда 38.5, равған 28.6, карбо 4.1 (дар 100 г)
 *   Қаймоқ (35%):  340 ккал, сафеда 2.8, равған 36.1, карбо 2.8 (дар 100 г, эътимод: low)
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const nutrition = require("../src/nutrition");
const menu = require("../src/menu");

const catalog = nutrition.loadIngredientCatalog(path.join(__dirname, "..", "seed", "ingredients.json"));

const food = (over = {}) => ({
  id: 1, name: "Тест", category: "Асосӣ", price: 10, image: "", description: "", available: true,
  weightG: null, ingredients: [], allergens: [], tags: [], nutritionSource: null, nutritionConfidence: null,
  ...over,
});

describe("Калория ва макроҳо аз таркиб", () => {
  test("ҳисоби дақиқ: паста 200 г + пармезан 20 г", () => {
    const f = food({
      ingredients: [{ name: "Паста (пухта)", grams: 200 }, { name: "Пармезан", grams: 20 }],
      nutritionConfidence: "high",
      nutritionSource: "Тест: ҳисоби дастӣ",
    });
    const n = nutrition.computeFoodNutrition(f, catalog);
    assert.equal(n.status, "computed");
    // 158*2 + 431*0.2 = 402.2 → 402
    assert.equal(n.calories, 402);
    // 5.8*2 + 38.5*0.2 = 19.3
    assert.equal(n.protein, 19.3);
    // 0.9*2 + 28.6*0.2 = 7.52 → 7.5
    assert.equal(n.fat, 7.5);
    // 30.9*2 + 4.1*0.2 = 62.62 → 62.6
    assert.equal(n.carbs, 62.6);
    assert.equal(n.weightG, 220);
    // 402.2 * 100 / 220 = 182.8
    assert.equal(n.per100g.calories, 183);
    assert.equal(n.per100g.protein, 8.8);
    // Эътимод: min(high (эълоншуда), medium (паста), medium (пармезан)) = medium
    assert.equal(n.confidence, "medium");
    assert.equal(n.source, "Тест: ҳисоби дастӣ");
    assert.deepEqual(n.missingIngredients, []);
  });

  test("номи ингредиент ба алиас мувофиқат мекунад (регистр/ё-е)", () => {
    const f = food({ ingredients: [{ name: "ПАСТА", grams: 100 }] });
    const n = nutrition.computeFoodNutrition(f, catalog);
    assert.equal(n.status, "computed");
    assert.equal(n.calories, 158);
  });

  test("агар ингредиент дар маълумотнома набошад — калория null аст (бе ихтироъ)", () => {
    const f = food({ ingredients: [{ name: "Паста (пухта)", grams: 100 }, { name: "Ноаён чизе", grams: 50 }] });
    const n = nutrition.computeFoodNutrition(f, catalog);
    assert.equal(n.status, "partial");
    assert.equal(n.calories, null);
    assert.equal(n.protein, null);
    assert.deepEqual(n.missingIngredients, ["Ноаён чизе"]);
    assert.equal(n.confidence, "low");
    assert.ok(n.warnings.includes("missing_ingredient_data"));
  });

  test("таом бе таркиб — status=none, ҳеҷ рақам нест", () => {
    const n = nutrition.computeFoodNutrition(food({ weightG: 300 }), catalog);
    assert.equal(n.status, "none");
    assert.equal(n.calories, null);
    assert.equal(n.confidence, null);
    assert.ok(n.warnings.includes("no_recipe"));
  });

  test("миқдори ноль/манфӣ ингредиентро ҳисоб намекунад", () => {
    const f = food({ ingredients: [{ name: "Паста (пухта)", grams: 0 }] });
    assert.equal(nutrition.computeFoodNutrition(f, catalog).status, "partial");
  });

  test("вазни порсия аз ҷамъи ингредиентҳо фарқ мекунад → эътимод low ва огоҳӣ", () => {
    // ҷамъи грамм = 200; вазни порсия = 300 → фарқ 33% > 30%
    const f = food({
      weightG: 300,
      ingredients: [{ name: "Паста (пухта)", grams: 200 }],
      nutritionConfidence: "high",
    });
    const n = nutrition.computeFoodNutrition(f, catalog);
    assert.equal(n.status, "computed");
    assert.equal(n.calories, 316); // 158*2
    assert.equal(n.weightG, 300);
    assert.equal(n.per100g.calories, 105); // 316*100/300 = 105.3 → 105
    assert.equal(n.confidence, "low");
    assert.ok(n.warnings.includes("weight_mismatch"));
  });

  test("эътимоди эълоншуда пасттар аз ингредиент → min", () => {
    const f = food({
      ingredients: [{ name: "Паста (пухта)", grams: 100 }],
      nutritionConfidence: "low",
    });
    assert.equal(nutrition.computeFoodNutrition(f, catalog).confidence, "low");
  });

  test("қаймоқ (эътимоди low) эътимоди таомро паст мекунад", () => {
    const f = food({
      ingredients: [{ name: "Паста (пухта)", grams: 100 }, { name: "Қаймоқ (35%)", grams: 50 }],
      nutritionConfidence: "high",
    });
    const n = nutrition.computeFoodNutrition(f, catalog);
    // 158 + 340*0.5 = 328
    assert.equal(n.calories, 328);
    assert.equal(n.confidence, "low");
  });
});

describe("Аллергенҳо ва истисноҳо", () => {
  test("аллергенҳо аз таркиб ҳосил мешаванд (паста+пармезан → gluten, milk)", () => {
    const f = food({ ingredients: [{ name: "Паста (пухта)", grams: 100 }, { name: "Пармезан", grams: 10 }] });
    const facts = nutrition.deriveSafetyFacts(f, catalog);
    assert.deepEqual(facts.allergens, ["gluten", "milk"]);
    assert.ok(facts.tags.includes("dairy"));
  });

  test("resolveAvoidTerms: «шир» → allergen milk; «мурғ» → tag meat", () => {
    const r = nutrition.resolveAvoidTerms(["шир", "мурғ", "салат"]);
    assert.deepEqual(r[0], { type: "allergen", key: "milk", raw: "шир" });
    assert.equal(r[1].type, "tag");
    assert.equal(r[1].key, "meat");
    assert.equal(r[2].type, "text");
  });

  test("violatesAvoid: таоми бо шир барои истисноии шир рад мешавад", () => {
    const f = food({ name: "Пицца", ingredients: [{ name: "Моцарелла", grams: 80 }] });
    assert.equal(nutrition.violatesAvoid(f, catalog, nutrition.resolveAvoidTerms(["шир"])), true);
    assert.equal(nutrition.violatesAvoid(f, catalog, nutrition.resolveAvoidTerms(["тухм"])), false);
  });

  test("violatesAvoid: «бе гӯшт» таомро бо мурғ рад мекунад", () => {
    const f = food({ name: "Салат", ingredients: [{ name: "Сина (мурғ, пухта)", grams: 100 }] });
    assert.equal(nutrition.violatesAvoid(f, catalog, nutrition.resolveAvoidTerms(["гӯшт"])), true);
  });
});

describe("Санҷиши таом (menu.validateFoodInput) барои маълумоти ғизоӣ", () => {
  test("ингредиентҳои нодуруст рад мешаванд", () => {
    assert.throws(() => menu.validateFoodInput({ name: "Тест", price: 10, ingredients: [{ name: "x", grams: -5 }] }), /Миқдор|grams|Миқдор/);
  });
  test("калиди аллергени номаълум рад мешавад", () => {
    assert.throws(() => menu.validateFoodInput({ name: "Тест", price: 10, allergens: ["unknown"] }), /калиди номаълум/);
  });
  test("ҳисоби калория дар DTO-и мизоҷ аз таркиб меояд", () => {
    const f = menu.normalizeFood({
      id: 9, name: "Тест", price: 50, ingredients: [{ name: "Паста (пухта)", grams: 100 }], nutritionConfidence: "high",
    });
    const dto = menu.publicFood(f, catalog);
    assert.equal(dto.nutrition.calories, 158);
    assert.equal(dto.nutrition.status, "computed");
  });
  test("таом бе таркиб — DTO calories=null (маълумот нест)", () => {
    const f = menu.normalizeFood({ id: 10, name: "Холӣ", price: 50 });
    const dto = menu.publicFood(f, catalog);
    assert.equal(dto.nutrition.calories, null);
    assert.equal(dto.nutrition.status, "none");
  });
});
