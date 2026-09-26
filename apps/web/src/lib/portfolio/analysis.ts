/**
 * Portfolio exposure and risk, computed from stored holdings.
 *
 * Unpriceable positions (suspended, stale, unavailable) are excluded from
 * percentages and reported separately at cost — quietly valuing a suspended
 * holding at its last trade would overstate the portfolio.
 */

export type HoldingRow = {
  holdingId: string;
  instrumentId: string;
  issuerId: string;
  ticker: string;
  name: string;
  sector: string | null;
  quantity: string;
  averageCost: string | null;
  totalCost: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
  realizedPnl: string | null;
  valuationState: string;
  valuationNote: string | null;
  valuationSessionDate: string | null;
};

export type Bucket = { key: string; label: string; value: number; weightPct: number };

export type PortfolioAnalysis = {
  pricedValue: number;
  unpricedCost: number;
  totalCost: number;
  unrealizedPnl: number;
  realizedPnl: number;
  returnPct: number | null;
  bySector: Bucket[];
  concentrationTop1: number | null;
  concentrationTop5: number | null;
  herfindahl: number | null;
  unpricedPositions: { ticker: string; reason: string }[];
  scenarios: { name: string; description: string; changePct: number }[];
  warnings: string[];
};

const SCENARIOS = [
  {
    name: "Broad market decline",
    description: "DSEX falls 15%; every sector moves with it.",
    defaultShock: -0.15,
    shocks: {} as Record<string, number>,
  },
  {
    name: "Rate shock",
    description: "Policy tightening: banks and NBFIs re-rate, leveraged industrials fall harder.",
    defaultShock: -0.08,
    shocks: { BANK: -0.12, "FINANCIAL INSTITUTIONS": -0.15, ENGINEERING: -0.12, CEMENT: -0.12 },
  },
  {
    name: "FX / import cost shock",
    description: "Taka depreciation raises input costs for import-dependent manufacturers.",
    defaultShock: -0.06,
    shocks: {
      "PHARMACEUTICALS & CHEMICALS": -0.1,
      TEXTILE: -0.12,
      CEMENT: -0.14,
      "FUEL & POWER": -0.1,
    },
  },
  {
    name: "Liquidity withdrawal",
    description: "Turnover collapses; thin names fall furthest.",
    defaultShock: -0.12,
    shocks: { "MUTUAL FUNDS": -0.18, MISCELLANEOUS: -0.2 },
  },
];

export function analysePortfolio(holdings: HoldingRow[]): PortfolioAnalysis {
  const warnings: string[] = [];
  const priced = holdings.filter((h) => h.marketValue !== null && h.valuationState === "available");
  const unpriced = holdings.filter((h) => !priced.includes(h));

  const pricedValue = priced.reduce((sum, h) => sum + Number(h.marketValue), 0);
  const unpricedCost = unpriced.reduce((sum, h) => sum + Number(h.totalCost ?? 0), 0);
  const totalCost = holdings.reduce((sum, h) => sum + Number(h.totalCost ?? 0), 0);
  const unrealizedPnl = priced.reduce((sum, h) => sum + Number(h.unrealizedPnl ?? 0), 0);
  const realizedPnl = holdings.reduce((sum, h) => sum + Number(h.realizedPnl ?? 0), 0);

  if (unpriced.length) {
    warnings.push(
      `${unpriced.length} position${unpriced.length === 1 ? "" : "s"} could not be priced ` +
        "(suspended, stale or unavailable). They are excluded from percentages and shown at cost.",
    );
  }

  const sectorTotals = new Map<string, number>();
  for (const h of priced) {
    const key = h.sector ?? "UNCLASSIFIED";
    sectorTotals.set(key, (sectorTotals.get(key) ?? 0) + Number(h.marketValue));
  }

  const bySector: Bucket[] = [...sectorTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({
      key,
      label: key === "UNCLASSIFIED" ? "Unclassified" : key,
      value,
      weightPct: pricedValue > 0 ? (value / pricedValue) * 100 : 0,
    }));

  const weights = priced
    .map((h) => (pricedValue > 0 ? Number(h.marketValue) / pricedValue : 0))
    .sort((a, b) => b - a);

  const top1 = weights.length ? weights[0]! * 100 : null;
  const top5 = weights.length ? weights.slice(0, 5).reduce((a, b) => a + b, 0) * 100 : null;
  const hhi = weights.length ? weights.reduce((a, w) => a + w * w, 0) * 10000 : null;

  if (top1 !== null && top1 > 25) {
    warnings.push(`Largest position is ${top1.toFixed(1)}% of the priced portfolio.`);
  }
  const unclassified = bySector.find((b) => b.key === "UNCLASSIFIED");
  if (unclassified && unclassified.weightPct > 10) {
    warnings.push(
      `${unclassified.weightPct.toFixed(0)}% of the portfolio has no sector classification, so sector exposure is incomplete.`,
    );
  }

  const scenarios = SCENARIOS.map((s) => {
    if (pricedValue <= 0) return { name: s.name, description: s.description, changePct: 0 };
    const shocked = priced.reduce((sum, h) => {
      const shock = s.shocks[(h.sector ?? "UNCLASSIFIED").toUpperCase()] ?? s.defaultShock;
      return sum + Number(h.marketValue) * (1 + shock);
    }, 0);
    return {
      name: s.name,
      description: s.description,
      changePct: ((shocked - pricedValue) / pricedValue) * 100,
    };
  });

  return {
    pricedValue,
    unpricedCost,
    totalCost,
    unrealizedPnl,
    realizedPnl,
    returnPct: totalCost > 0 ? ((pricedValue + realizedPnl - totalCost) / totalCost) * 100 : null,
    bySector,
    concentrationTop1: top1,
    concentrationTop5: top5,
    herfindahl: hhi,
    unpricedPositions: unpriced.map((h) => ({
      ticker: h.ticker,
      reason: h.valuationNote ?? h.valuationState,
    })),
    scenarios,
    warnings,
  };
}
