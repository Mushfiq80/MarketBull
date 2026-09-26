import { describe, expect, it } from "vitest";

import { analysePortfolio, type HoldingRow } from "@/lib/portfolio/analysis";

function holding(over: Partial<HoldingRow>): HoldingRow {
  return {
    holdingId: "h1",
    instrumentId: "i1",
    issuerId: "s1",
    ticker: "AAA",
    name: "A Ltd",
    sector: "BANK",
    quantity: "100",
    averageCost: "50",
    totalCost: "5000",
    marketValue: "6000",
    unrealizedPnl: "1000",
    realizedPnl: "0",
    valuationState: "available",
    valuationNote: null,
    valuationSessionDate: "2026-09-24",
    ...over,
  };
}

describe("portfolio analysis", () => {
  it("excludes unpriceable positions from percentages and reports them at cost", () => {
    const result = analysePortfolio([
      holding({}),
      holding({
        holdingId: "h2",
        ticker: "SUSP",
        marketValue: null,
        valuationState: "unavailable",
        valuationNote: "Trading suspended",
        totalCost: "4000",
      }),
    ]);

    // Only the priced position counts toward value.
    expect(result.pricedValue).toBe(6000);
    expect(result.unpricedCost).toBe(4000);
    expect(result.unpricedPositions).toHaveLength(1);
    expect(result.concentrationTop1).toBe(100);
    expect(result.warnings.some((w) => w.match(/could not be priced/i))).toBe(true);
  });

  it("warns on a concentrated book", () => {
    const result = analysePortfolio([
      holding({ marketValue: "9000" }),
      holding({ holdingId: "h2", ticker: "BBB", marketValue: "1000", sector: "CEMENT" }),
    ]);
    expect(result.concentrationTop1).toBe(90);
    expect(result.warnings.some((w) => w.match(/largest position/i))).toBe(true);
  });

  it("applies sector-specific shocks in the rate scenario", () => {
    const result = analysePortfolio([holding({ sector: "BANK", marketValue: "10000" })]);
    const rate = result.scenarios.find((s) => s.name === "Rate shock")!;
    // Banks take -12% in the rate scenario, not the -8% default.
    expect(rate.changePct).toBeCloseTo(-12, 5);
  });

  it("handles an empty portfolio without dividing by zero", () => {
    const result = analysePortfolio([]);
    expect(result.pricedValue).toBe(0);
    expect(result.returnPct).toBeNull();
    expect(result.concentrationTop1).toBeNull();
  });

  it("flags unclassified sector exposure", () => {
    const result = analysePortfolio([
      holding({ sector: null, marketValue: "5000" }),
      holding({ holdingId: "h2", sector: "BANK", marketValue: "5000" }),
    ]);
    expect(result.warnings.some((w) => w.match(/no sector classification/i))).toBe(true);
  });
});
