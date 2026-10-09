"use strict";

/**
 * Пешгӯии талабот (demand forecast).
 *
 * Маълумот: танҳо фармоишҳои ба охир расида (DONE) ва пардохташуда
 *   (онлайн: PAID; нақд: CASH_COLLECTED). Бекоршуда ва пардохтнашуда дохил намешаванд.
 * Рӯзҳо: санаи эҷоди фармоиш дар минтақаи Душанбе (UTC+5).
 * Рӯзи ҷорӣ ва ҳар маълумоти баъд аз asOf дар омӯзиш истифода намешавад (бе leakage).
 *
 * Моделҳо:
 *   ma7         — миёнаи 7-рӯзаи пешин (асос, ҳамеша)
 *   weekdayMa7  — ma7 × омили рӯзи ҳафта (танҳо агар ≥ 28 рӯзи таърих бошад)
 * Арзёбӣ: walk-forward дар 14 рӯзи охирини таърих — MAE = mean|y−ŷ|,
 *         WAPE = Σ|y−ŷ| / Σy (агар Σy = 0 бошад, n/a).
 */
const { dayKey, round2 } = require("./util");

const MA_WINDOW = 7;
const WEEKDAY_HISTORY = 28;
const BACKTEST_DAYS = 14;
const HORIZON_DAYS = 7;

const DAY_MS = 86400000;

function isRealSale(o) {
  if (o.status !== "DONE") return false;
  if (o.paymentMethod === "online") return o.paymentStatus === "PAID";
  if (o.paymentMethod === "cash") return o.paymentStatus === "CASH_COLLECTED";
  return false;
}

/** Калиди рӯз → индекси ҳафта (0=Якшанбе) бе вобастагӣ ба минтақаи сервер */
function weekdayOfKey(key) {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

/**
 * Сохтани силсилаи рӯзона (бе холигӣ: рӯзи бе фурӯш = 0).
 * Бозгашт: { days: [key...], total: number[], byFood: Map<foodId, number[]>, revenue: number[], realSales: [...] }
 */
function buildDailySeries(orders, { asOfMs, tzOffsetHours = 5 }) {
  const sales = orders.filter((o) => isRealSale(o) && Date.parse(o.createdAt) < asOfMs);
  if (!sales.length) return { days: [], total: [], byFood: new Map(), revenue: [], realSales: [] };

  const keys = sales.map((o) => dayKey(o.createdAt, tzOffsetHours));
  const first = keys.reduce((a, b) => (a < b ? a : b));
  const lastComplete = dayKey(asOfMs - 1, tzOffsetHours); // рӯзи пурраи охирин (asOf — оғози рӯзи ҷорӣ)
  const n = daysBetween(first, lastComplete) + 1;
  if (n <= 0) return { days: [], total: [], byFood: new Map(), revenue: [], realSales: [] };

  const days = Array.from({ length: n }, (_, i) => addDaysKey(first, i));
  const index = new Map(days.map((d, i) => [d, i]));
  const total = new Array(n).fill(0);
  const revenue = new Array(n).fill(0);
  const byFood = new Map();

  for (const o of sales) {
    const idx = index.get(dayKey(o.createdAt, tzOffsetHours));
    if (idx === undefined) continue;
    let units = 0;
    for (const it of o.items || []) {
      const q = Number(it.quantity) || 0;
      units += q;
      if (!byFood.has(it.foodId)) byFood.set(it.foodId, new Array(n).fill(0));
      byFood.get(it.foodId)[idx] += q;
    }
    total[idx] += units;
    revenue[idx] += Number(o.total) || 0;
  }
  return { days, total, byFood, revenue, realSales: sales };
}

/** Миёнаи 7-рӯзаи пеш аз t (фақат индексҳои < t) */
function ma7At(series, t) {
  if (t < MA_WINDOW) return null;
  let sum = 0;
  for (let i = t - MA_WINDOW; i < t; i++) sum += series[i];
  return sum / MA_WINDOW;
}

/** Омили рӯзи ҳафта аз 28 рӯзи пеш аз t; null агар таърих кофӣ набошад */
function weekdayFactorAt(series, days, t) {
  if (t < WEEKDAY_HISTORY) return null;
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  let total = 0;
  for (let i = t - WEEKDAY_HISTORY; i < t; i++) {
    const w = weekdayOfKey(days[i]);
    sums[w] += series[i];
    counts[w] += 1;
    total += series[i];
  }
  const mean = total / WEEKDAY_HISTORY;
  if (!(mean > 0)) return null;
  return sums.map((s, w) => (counts[w] ? s / counts[w] / mean : 1));
}

function predictWeekdayMa7(series, days, t) {
  const base = ma7At(series, t);
  const f = weekdayFactorAt(series, days, t);
  if (base === null || f === null) return null;
  return base * f[weekdayOfKey(days[t])];
}

function errorMetrics(pairs) {
  // pairs: [{y, yhat}]
  const n = pairs.length;
  if (!n) return { mae: null, wape: null, n: 0 };
  let abs = 0;
  let sumY = 0;
  for (const { y, yhat } of pairs) {
    abs += Math.abs(y - yhat);
    sumY += y;
  }
  return {
    mae: round2(abs / n),
    wape: sumY > 0 ? round2((abs / sumY) * 100) : null, // фоиз
    n,
  };
}

/**
 * Пешгӯӣ + арзёбӣ.
 * @returns объект бо dataStatus, models, backtest, forecast, perFood.
 */
function buildForecast(orders, { asOfMs = Date.now(), tzOffsetHours = 5, horizonDays = HORIZON_DAYS, foods = [] } = {}) {
  const asOfKey = dayKey(asOfMs, tzOffsetHours);
  const series = buildDailySeries(orders, { asOfMs, tzOffsetHours });
  const N = series.total.length;
  const nameOf = new Map(foods.map((f) => [f.id, f.name]));

  const result = {
    asOf: asOfKey,
    timezone: "Asia/Dushanbe (UTC+5)",
    dataStatus: "no_sales",
    disclaimer:
      "Пешгӯӣ тахминӣ аст ва бар асои фурӯши пардохтшудаи ба охир расида ҳисоб мешавад. " +
      "Ин маълумоти кӯҳнаи ошхона нест; бо гузашти вақт дақиқтар мешавад.",
    history: { days: N, firstDay: series.days[0] || null, lastDay: series.days[N - 1] || null, totalUnits: 0, totalRevenue: 0, realSalesCount: series.realSales.length },
    models: {
      ma7: { name: "Миёнаи ҳаракаткунандаи 7 рӯза", available: false, reason: null },
      weekdayMa7: { name: "MA7 × омили рӯзи ҳафта", available: false, reason: null },
    },
    backtest: null,
    forecast: [],
    perFood: [],
  };

  if (!N) return result;
  result.history.totalUnits = series.total.reduce((a, b) => a + b, 0);
  result.history.totalRevenue = round2(series.revenue.reduce((a, b) => a + b, 0));

  if (N < MA_WINDOW + 1) {
    result.dataStatus = "insufficient";
    result.models.ma7.reason = `Барои MA-7 камаш ${MA_WINDOW + 1} рӯзи таърих лозим аст (ҳоло ${N}).`;
    result.models.weekdayMa7.reason = `Барои модели дуюм камаш ${WEEKDAY_HISTORY} рӯз лозим аст (ҳоло ${N}).`;
    return result;
  }

  result.dataStatus = N >= WEEKDAY_HISTORY ? "ok" : "partial";
  result.models.ma7.available = true;
  result.models.weekdayMa7.available = N >= WEEKDAY_HISTORY;
  if (!result.models.weekdayMa7.available) {
    result.models.weekdayMa7.reason = `Барои модели дуюм камаш ${WEEKDAY_HISTORY} рӯзи таърих лозим аст (ҳоло ${N}).`;
  }

  // ---- Арзёбӣ (walk-forward): ҳар рӯз фақат аз рӯзҳои пеш ----
  const bt = Math.min(BACKTEST_DAYS, N - MA_WINDOW);
  const rows = [];
  for (let t = N - bt; t < N; t++) {
    rows.push({
      day: series.days[t],
      y: series.total[t],
      p1: ma7At(series.total, t),
      p2: predictWeekdayMa7(series.total, series.days, t),
    });
  }
  const pairsOf = (rs, key) => rs.filter((r) => r[key] !== null).map((r) => ({ y: r.y, yhat: r[key] }));
  const m1 = errorMetrics(pairsOf(rows, "p1"));
  const m2 = errorMetrics(pairsOf(rows, "p2"));
  // Муқоисаи одилона: ҳамон рӯзҳое, ки ҳар ду модел пешгӯӣ карда метавонанд
  const common = rows.filter((r) => r.p1 !== null && r.p2 !== null);
  const c1 = errorMetrics(common.map((r) => ({ y: r.y, yhat: r.p1 })));
  const c2 = errorMetrics(common.map((r) => ({ y: r.y, yhat: r.p2 })));
  let best = null;
  if (c1.n && c2.n) best = c2.mae < c1.mae ? "weekdayMa7" : "ma7";
  result.backtest = {
    days: bt,
    from: series.days[N - bt] || null,
    to: series.days[N - 1] || null,
    ma7: m1,
    weekdayMa7: m2.n ? m2 : null,
    common: { ma7: c1, weekdayMa7: c2.n ? c2 : null },
    best,
    note: m2.n ? null : "Модели дуюм барои арзёбӣ таърих кофӣ надорад.",
  };

  // ---- Прогноз барои HORIZON рӯзи оянда (танҳо аз таърихи маълум) ----
  const lastKey = series.days[N - 1];
  const base7 = ma7At(series.total, N); // миёнаи 7 рӯзи охирини маълум
  const f28 = weekdayFactorAt(series.total, series.days, N); // null агар < 28 рӯз
  for (let h = 1; h <= horizonDays; h++) {
    const dayK = addDaysKey(lastKey, h);
    const w = weekdayOfKey(dayK);
    const ma7Value = round2(base7);
    const wdValue = f28 ? round2(base7 * f28[w]) : null; // модели дуюм танҳо бо таърихи кофӣ
    result.forecast.push({
      date: dayK,
      weekday: w,
      units: { ma7: ma7Value, weekdayMa7: wdValue },
    });
  }

  // ---- Пешгӯӣ барои ҳар таом (ma7, рӯзона) ----
  const topFoods = [...series.byFood.entries()]
    .map(([foodId, arr]) => ({ foodId, name: nameOf.get(foodId) || `Таом #${foodId}`, last7: arr.slice(-MA_WINDOW).reduce((a, b) => a + b, 0), units: arr.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 10);
  result.perFood = topFoods.map((f) => ({
    foodId: f.foodId,
    name: f.name,
    totalUnits: f.units,
    dailyMa7: round2(f.last7 / MA_WINDOW),
    forecastNext7Days: round2((f.last7 / MA_WINDOW) * horizonDays),
  }));
  return result;
}

module.exports = {
  buildForecast,
  buildDailySeries,
  ma7At,
  weekdayFactorAt,
  predictWeekdayMa7,
  errorMetrics,
  isRealSale,
  weekdayOfKey,
  MA_WINDOW,
  WEEKDAY_HISTORY,
  BACKTEST_DAYS,
};
