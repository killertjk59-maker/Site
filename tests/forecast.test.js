/**
 * Пешгӯии талабот бо маълумоти маълум.
 * Силсилаи санҷишӣ: y_i = 10 + (i mod 7), i = 0..34 (35 рӯз, 2026-09-04 … 2026-10-08).
 *  - миёнаи ҳар 7 рӯз = 13 → MA-7 ҳамеша 13 пешгӯӣ мекунад;
 *  - омили рӯзи ҳафта дақиқан арзишро медиҳад → модели дуюм хатои 0 (ин дар тест санҷида мешавад).
 * Ҳисоби дастӣ (шарҳ дар ҳар тест).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const forecast = require("../src/forecast");
const { dayKey, startOfTodayMs } = require("../src/util");

const FOODS = [{ id: 1, name: "Тест-таом" }];
// asOf = оғози 2026-10-09 дар Душанбе (UTC+5) → 2026-10-08T19:00Z
const ASOF = Date.parse("2026-10-08T19:00:00Z");
const DAY0 = Date.parse("2026-09-04T00:00:00Z");

function sale({ day, units, id = 1, status = "DONE", pm = "online", ps = "PAID", total, hour = 7 }) {
  const createdAt = new Date(Date.parse(`${day}T00:00:00Z`) + hour * 3600 * 1000).toISOString();
  return {
    id: Math.floor(Math.random() * 1e9),
    status,
    paymentMethod: pm,
    paymentStatus: ps,
    createdAt,
    total: total ?? units * 10,
    items: [{ foodId: id, name: "Тест-таом", price: 10, quantity: units }],
  };
}

function dayAt(i) {
  return new Date(DAY0 + i * 86400000).toISOString().slice(0, 10);
}

function periodicOrders(n = 35) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(sale({ day: dayAt(i), units: 10 + (i % 7) }));
  return out;
}

describe("Пешгӯии MA-7 ва модели дуюм (маълумоти маълум)", () => {
  const r = forecast.buildForecast(periodicOrders(), { asOfMs: ASOF, foods: FOODS });

  test("таърих ва маҷмӯъ дуруст ҳисоб мешавад", () => {
    assert.equal(r.dataStatus, "ok");
    assert.equal(r.history.days, 35);
    assert.equal(r.history.firstDay, "2026-09-04");
    assert.equal(r.history.lastDay, "2026-10-08");
    // 5 давра × (10+…+16) = 5 × 91 = 455
    assert.equal(r.history.totalUnits, 455);
    assert.equal(r.history.totalRevenue, 4550);
  });

  test("арзёбии MA-7 (14 рӯзи охир): MAE = 24/14 = 1.71, WAPE = 24/182 = 13.19%", () => {
    assert.equal(r.backtest.days, 14);
    assert.equal(r.backtest.from, "2026-09-25");
    assert.equal(r.backtest.to, "2026-10-08");
    assert.equal(r.backtest.ma7.n, 14);
    assert.equal(r.backtest.ma7.mae, 1.71);
    assert.equal(r.backtest.ma7.wape, 13.19);
  });

  test("модели дуюм фақат бо таърихи кофӣ (≥28 рӯз) арзёбӣ мешавад; ҳамон рӯзҳо барои муқоиса", () => {
    assert.equal(r.backtest.weekdayMa7.n, 7);
    assert.equal(r.backtest.weekdayMa7.mae, 0, "омили рӯзи ҳафта барои ин силсила хатои 0 медиҳад");
    assert.equal(r.backtest.weekdayMa7.wape, 0);
    assert.equal(r.backtest.common.ma7.n, 7);
    assert.equal(r.backtest.common.ma7.mae, 1.71);
    assert.equal(r.backtest.best, "weekdayMa7");
  });

  test("прогнози 7 рӯзаи оянда: MA-7 = 13; модели дуюм = арзиши ҳар рӯзи ҳафта", () => {
    assert.equal(r.forecast.length, 7);
    assert.deepEqual(r.forecast.map((f) => f.date), [
      "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
    ]);
    assert.ok(r.forecast.every((f) => f.units.ma7 === 13));
    // индекси 35..41: 10 + (i mod 7) = 10,11,12,13,14,15,16
    assert.deepEqual(r.forecast.map((f) => f.units.weekdayMa7), [10, 11, 12, 13, 14, 15, 16]);
  });

  test("пешгӯӣ барои таом: миёнаи рӯзона 13 ва ҳамин барои 7 рӯз 91", () => {
    assert.equal(r.perFood.length, 1);
    assert.equal(r.perFood[0].foodId, 1);
    assert.equal(r.perFood[0].totalUnits, 455);
    assert.equal(r.perFood[0].dailyMa7, 13);
    assert.equal(r.perFood[0].forecastNext7Days, 91);
  });

  test("тавзеҳ ва огоҳии «тахминӣ» дар натиҷа ҳаст", () => {
    assert.match(r.disclaimer, /тахминӣ/);
  });
});

describe("Қоидаҳо: бе leakage ва танҳо фурӯши воқеӣ", () => {
  test("фармоишҳои пас аз asOf, бекоршуда, пардохтнашуда ва ба охир нарасида дохил намешаванд", () => {
    const base = periodicOrders();
    const clean = forecast.buildForecast(base, { asOfMs: ASOF, foods: FOODS });
    const dirty = forecast.buildForecast([
      ...base,
      sale({ day: "2026-10-09", units: 999 }), // имрӯз/оянда — бояд дохил нашавад
      sale({ day: "2026-10-01", units: 500, status: "CANCELLED", ps: "PAID" }), // бекоршуда
      sale({ day: "2026-10-02", units: 300, status: "CONFIRMED", ps: "PAID" }), // пардохт, аммо ба охир нарасида
      sale({ day: "2026-10-04", units: 200, status: "DONE", pm: "cash", ps: "CASH_ON_DELIVERY" }), // нақд, гирифта нашуда
      sale({ day: "2026-10-05", units: 150, status: "DONE", pm: "online", ps: "IN_REVIEW" }), // пардохт тасдиқ нашуда
      sale({ day: "2026-10-06", units: 120, status: "NEW", pm: "online", ps: "AWAITING_PAYMENT" }),
    ], { asOfMs: ASOF, foods: FOODS });
    assert.equal(dirty.history.totalUnits, clean.history.totalUnits);
    assert.equal(dirty.backtest.ma7.mae, clean.backtest.ma7.mae);
    assert.equal(dirty.backtest.ma7.wape, clean.backtest.ma7.wape);
    assert.deepEqual(dirty.forecast.map((f) => f.units), clean.forecast.map((f) => f.units));
  });

  test("фурӯши нақдии гирифташуда (CASH_COLLECTED) дохил мешавад", () => {
    const base = periodicOrders();
    const withCash = forecast.buildForecast([
      ...base,
      sale({ day: "2026-10-03", units: 3, status: "DONE", pm: "cash", ps: "CASH_COLLECTED" }),
    ], { asOfMs: ASOF, foods: FOODS });
    assert.equal(withCash.history.totalUnits, 458);
  });

  test("сабт кардани рӯзҳои бе фурӯш 0 аст (zero-fill) то рӯзи пурраи охирин", () => {
    const orders = [sale({ day: "2026-09-10", units: 4 }), sale({ day: "2026-09-13", units: 6 })];
    const s = forecast.buildDailySeries(orders, { asOfMs: ASOF });
    // 2026-09-10 … 2026-10-08 = 29 рӯз
    assert.equal(s.days.length, 29);
    assert.deepEqual(s.total.slice(0, 4), [4, 0, 0, 6]);
    assert.equal(s.total.reduce((a, b) => a + b, 0), 10);
  });

  test("таърихи кам → dataStatus=insufficient ва прогноз нест", () => {
    const orders = [];
    for (let i = 0; i < 5; i++) orders.push(sale({ day: dayAt(i), units: 5 }));
    // asOf = оғози рӯзи 6-ум → таърих фақат 5 рӯз
    const r = forecast.buildForecast(orders, { asOfMs: Date.parse(`${dayAt(5)}T00:00:00+05:00`), foods: FOODS });
    assert.equal(r.dataStatus, "insufficient");
    assert.equal(r.models.ma7.available, false);
    assert.ok(r.models.ma7.reason);
    assert.equal(r.forecast.length, 0);
    assert.equal(r.backtest, null);
  });

  test("20 рӯз: MA-7 дастрас, модели дуюм не (камаш 28 рӯз)", () => {
    const orders = [];
    for (let i = 0; i < 20; i++) orders.push(sale({ day: dayAt(i), units: 10 + (i % 7) }));
    const r = forecast.buildForecast(orders, { asOfMs: Date.parse(`${dayAt(20)}T00:00:00+05:00`), foods: FOODS });
    assert.equal(r.dataStatus, "partial");
    assert.equal(r.models.ma7.available, true);
    assert.equal(r.models.weekdayMa7.available, false);
    assert.ok(r.forecast.every((f) => f.units.weekdayMa7 === null));
    assert.ok(r.forecast.every((f) => typeof f.units.ma7 === "number"));
  });

  test("бе фурӯш: натиҷа холӣ, dataStatus=no_sales", () => {
    const r = forecast.buildForecast([], { asOfMs: ASOF, foods: FOODS });
    assert.equal(r.dataStatus, "no_sales");
    assert.equal(r.forecast.length, 0);
  });
});

describe("MAE ва WAPE", () => {
  test("MAE = mean|y−ŷ|, WAPE = Σ|y−ŷ| / Σy", () => {
    // |10−8| + |0−2| = 4 → MAE = 2; Σy = 10 → WAPE = 40%
    const m = forecast.errorMetrics([{ y: 10, yhat: 8 }, { y: 0, yhat: 2 }]);
    assert.equal(m.mae, 2);
    assert.equal(m.wape, 40);
    assert.equal(m.n, 2);
  });
  test("WAPE вақте Σy=0 аст — null (n/a), MAE ҳамчунон", () => {
    const m = forecast.errorMetrics([{ y: 0, yhat: 1 }, { y: 0, yhat: 3 }]);
    assert.equal(m.wape, null);
    assert.equal(m.mae, 2);
  });
  test("бе ҷуфт — ҳама null", () => {
    assert.deepEqual(forecast.errorMetrics([]), { mae: null, wape: null, n: 0 });
  });
});

describe("Ҳисоби MA-7 ва омили рӯзи ҳафта (ҳисоби дастӣ)", () => {
  test("ma7At барои [1..7] → 4 (миёна), барои таърихи кам null", () => {
    assert.equal(forecast.ma7At([1, 2, 3, 4, 5, 6, 7], 7), 4);
    assert.equal(forecast.ma7At([1, 2, 3], 3), null);
  });
  test("weekdayOfKey: 2026-10-09 — рӯзи 5 (Ҷумъа)", () => {
    assert.equal(forecast.weekdayOfKey("2026-10-09"), 5);
  });
  test("ҳар рӯз фақат аз рӯзҳои пеш истифода мешавад (walk-forward)", () => {
    const series = Array.from({ length: 40 }, (_, i) => (i === 39 ? 1000 : 10));
    // t=39: ma7 аз 32..38 — рӯзи 39 (1000) дохил нест
    assert.equal(forecast.ma7At(series, 39), 10);
  });
});

describe("Сана ва минтақаи Душанбе", () => {
  test("dayKey барои 19:30Z → рӯзи навбатӣ (UTC+5)", () => {
    assert.equal(dayKey("2026-10-08T19:30:00Z", 5), "2026-10-09");
    assert.equal(dayKey("2026-10-08T18:59:00Z", 5), "2026-10-08");
  });
  test("startOfTodayMs барои 2026-10-09 10:00 Душанбе = 2026-10-09T00:00+05:00", () => {
    const now = Date.parse("2026-10-09T05:00:00Z");
    assert.equal(startOfTodayMs(now, 5), Date.parse("2026-10-08T19:00:00Z"));
  });
});
