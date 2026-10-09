"use strict";

/**
 * Ҳисоботи даромад — ҷудо кардани фармоишҳо, пардохтҳои тасдиқшуда ва пули воқеан гирифташуда.
 *
 *  ordersCount      — ҳамаи фармоишҳо (шумора)
 *  activeOrdered    — маблағи фармоишҳои бекоршуда набуда (ҳама ҳолатҳо ба ҷуз CANCELLED)
 *  cancelled        — маблағи фармоишҳои бекоршуда
 *  salesCompleted   — маблағи фармоишҳое, ки ба ҳолати DONE расидаанд (фурӯши иҷрошуда)
 *  approvedOnline   — пардохти онлайн, ки админ тасдиқ кардааст (PAID)
 *  cashCollected    — пули нақд, ки ҳангоми расонидан гирифта шудааст (CASH_COLLECTED)
 *  collectedNet     — пули воқеан гирифташуда = approvedOnline + cashCollected
 *  refundDue        — пардохт шуда, аммо фармоиш бекор шудааст (бояд баргардонда шавад)
 *  pendingOnline    — интизори пардохт/санҷиш (онлайн, бекор нашуда)
 *  pendingCash      — интизори пули нақд (нақдӣ, бекор нашуда, ҳанӯз гирифта нашуда)
 *  revenue          — бо мувофиқат бо нусхаи кӯҳна: = collectedNet
 */
const { round2 } = require("./util");

function summarizeRevenue(orders, { fromMs, toMs } = {}) {
  const s = {
    ordersCount: 0,
    byStatus: {},
    activeOrdered: 0,
    cancelled: 0,
    cancelledCount: 0,
    salesCompleted: 0,
    salesCompletedCount: 0,
    approvedOnline: 0,
    approvedOnlineCount: 0,
    cashCollected: 0,
    cashCollectedCount: 0,
    collectedNet: 0,
    refundDue: 0,
    refundDueCount: 0,
    pendingOnline: 0,
    pendingOnlineCount: 0,
    pendingCash: 0,
    pendingCashCount: 0,
  };

  for (const o of orders) {
    const t = Date.parse(o.createdAt);
    if (fromMs && t < fromMs) continue;
    if (toMs && t >= toMs) continue;
    const amount = Number(o.total) || 0;
    s.ordersCount += 1;
    s.byStatus[o.status] = (s.byStatus[o.status] || 0) + 1;

    if (o.status === "CANCELLED") {
      s.cancelled += amount;
      s.cancelledCount += 1;
    } else {
      s.activeOrdered += amount;
    }

    if (o.status === "DONE") {
      s.salesCompleted += amount;
      s.salesCompletedCount += 1;
    }
    if (o.paymentMethod === "online") {
      if (o.paymentStatus === "PAID") {
        s.approvedOnline += amount;
        s.approvedOnlineCount += 1;
      } else if (o.paymentStatus === "REFUND_DUE") {
        s.refundDue += amount;
        s.refundDueCount += 1;
      } else if (o.status !== "CANCELLED" && ["AWAITING_PAYMENT", "IN_REVIEW", "REJECTED"].includes(o.paymentStatus)) {
        s.pendingOnline += amount;
        s.pendingOnlineCount += 1;
      }
    } else if (o.paymentMethod === "cash") {
      if (o.paymentStatus === "CASH_COLLECTED") {
        s.cashCollected += amount;
        s.cashCollectedCount += 1;
      } else if (o.status !== "CANCELLED" && o.paymentStatus === "CASH_ON_DELIVERY") {
        s.pendingCash += amount;
        s.pendingCashCount += 1;
      }
    }
  }

  s.activeOrdered = round2(s.activeOrdered);
  s.cancelled = round2(s.cancelled);
  s.salesCompleted = round2(s.salesCompleted);
  s.approvedOnline = round2(s.approvedOnline);
  s.cashCollected = round2(s.cashCollected);
  s.collectedNet = round2(s.approvedOnline + s.cashCollected);
  s.refundDue = round2(s.refundDue);
  s.pendingOnline = round2(s.pendingOnline);
  s.pendingCash = round2(s.pendingCash);
  s.revenue = s.collectedNet;
  return s;
}

module.exports = { summarizeRevenue };
