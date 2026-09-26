import { describe, expect, it } from "vitest";

import { metricDisabledReason, metricEnabled, templateForSector } from "@/lib/domain/sectors";

describe("sector scorecards", () => {
  it("maps DSE sectors to the right template", () => {
    expect(templateForSector("BANK")).toBe("bank");
    expect(templateForSector("FINANCIAL INSTITUTIONS")).toBe("nbfi");
    expect(templateForSector("GENERAL INSURANCE")).toBe("insurance");
    expect(templateForSector("CEMENT")).toBe("industrial");
    expect(templateForSector(null)).toBe("general");
  });

  it("disables meaningless ratios for financial institutions, with a reason", () => {
    expect(metricEnabled("bank", "ev_ebitda")).toBe(false);
    expect(metricDisabledReason("bank", "ev_ebitda")).toMatch(/not meaningful/i);
    expect(metricEnabled("bank", "net_debt_to_equity")).toBe(false);
    expect(metricDisabledReason("bank", "net_debt_to_equity")).toMatch(/deposits/i);
  });

  it("enables bank-specific metrics that industrials do not have", () => {
    expect(metricEnabled("bank", "npl_ratio")).toBe(true);
    expect(metricEnabled("industrial", "npl_ratio")).toBe(false);
  });

  it("keeps industrial ratios available for industrials", () => {
    expect(metricEnabled("industrial", "ev_ebitda")).toBe(true);
    expect(metricEnabled("industrial", "cash_conversion")).toBe(true);
  });

  it("requires look-through treatment before ROIC on a holding company", () => {
    expect(metricEnabled("holding", "roic")).toBe(false);
    expect(metricDisabledReason("holding", "roic")).toMatch(/look-through/i);
  });
});
