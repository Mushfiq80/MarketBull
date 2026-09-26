/**
 * Sector scorecard templates. One financial scorecard cannot fairly compare a
 * bank to a cement plant, so ratios that are not meaningful for a sector are
 * DISABLED rather than computed and quietly ignored.
 */
export type ScorecardTemplate = "bank" | "nbfi" | "insurance" | "industrial" | "holding" | "general";

export type SectorProfile = {
  template: ScorecardTemplate;
  label: string;
  /** Metrics that are meaningful and should be shown. */
  enabledMetrics: string[];
  /** Metrics explicitly disabled, with the reason shown in the UI tooltip. */
  disabledMetrics: Record<string, string>;
};

const FINANCIAL_DISABLED = {
  ev_ebitda: "Enterprise value multiples are not meaningful for financial institutions.",
  ev_sales: "Enterprise value multiples are not meaningful for financial institutions.",
  gross_margin: "Financial institutions do not report a gross margin.",
  operating_margin: "Not comparable for financial institutions; use net interest margin.",
  roic: "Invested capital is not defined comparably for financial institutions.",
  cash_conversion: "Operating cash flow is not interpretable the same way for banks.",
  net_debt_to_equity: "Deposits are not debt in the industrial sense.",
  interest_coverage: "Interest is a cost of goods for a lender, not a fixed charge.",
};

export const SECTOR_PROFILES: Record<ScorecardTemplate, SectorProfile> = {
  bank: {
    template: "bank",
    label: "Bank",
    enabledMetrics: [
      "net_interest_margin",
      "cost_to_income",
      "npl_ratio",
      "provision_coverage",
      "car_total",
      "tier1_ratio",
      "casa_ratio",
      "loan_deposit_ratio",
      "roe",
      "roa",
      "pb",
      "pe",
      "div_yield",
      "book_value_per_share",
    ],
    disabledMetrics: FINANCIAL_DISABLED,
  },
  nbfi: {
    template: "nbfi",
    label: "NBFI",
    enabledMetrics: [
      "net_interest_margin",
      "cost_to_income",
      "npl_ratio",
      "provision_coverage",
      "capital_adequacy",
      "funding_cost",
      "leverage_multiple",
      "roe",
      "roa",
      "pb",
      "pe",
      "div_yield",
    ],
    disabledMetrics: FINANCIAL_DISABLED,
  },
  insurance: {
    template: "insurance",
    label: "Insurance",
    enabledMetrics: [
      "gross_premium_growth",
      "net_premium_growth",
      "claims_ratio",
      "expense_ratio",
      "combined_ratio",
      "solvency_margin",
      "investment_yield",
      "underwriting_result",
      "roe",
      "pb",
      "pe",
      "div_yield",
    ],
    disabledMetrics: {
      ...FINANCIAL_DISABLED,
      cash_conversion: "Premium float distorts cash conversion for insurers.",
    },
  },
  industrial: {
    template: "industrial",
    label: "Industrial / Manufacturing",
    enabledMetrics: [
      "revenue_growth_yoy",
      "gross_margin",
      "operating_margin",
      "net_margin",
      "roe",
      "roa",
      "roic",
      "cash_conversion",
      "net_debt_to_equity",
      "interest_coverage",
      "capacity_utilisation",
      "working_capital_days",
      "capex_to_revenue",
      "pe",
      "pb",
      "ev_ebitda",
      "div_yield",
    ],
    disabledMetrics: {},
  },
  holding: {
    template: "holding",
    label: "Holding company / Conglomerate",
    enabledMetrics: [
      "consolidated_revenue_growth",
      "net_margin",
      "roe",
      "net_debt_to_equity",
      "pb",
      "pe",
      "div_yield",
      "nav_per_share",
      "holding_discount",
    ],
    disabledMetrics: {
      roic: "Requires look-through treatment; disabled until segment data permits.",
      operating_margin: "Mixed-business aggregate margin is not comparable to peers.",
      ev_ebitda: "Consolidation and minority interests make EV multiples unreliable here.",
    },
  },
  general: {
    template: "general",
    label: "General",
    enabledMetrics: [
      "revenue_growth_yoy",
      "operating_margin",
      "net_margin",
      "roe",
      "roa",
      "cash_conversion",
      "net_debt_to_equity",
      "pe",
      "pb",
      "div_yield",
    ],
    disabledMetrics: {},
  },
};

/** DSE sector code → scorecard template. Extend as the instrument master lands. */
export const DSE_SECTOR_TEMPLATE: Record<string, ScorecardTemplate> = {
  BANK: "bank",
  "FINANCIAL INSTITUTIONS": "nbfi",
  NBFI: "nbfi",
  INSURANCE: "insurance",
  "LIFE INSURANCE": "insurance",
  "GENERAL INSURANCE": "insurance",
  PHARMACEUTICALS: "industrial",
  "PHARMACEUTICALS & CHEMICALS": "industrial",
  "ENGINEERING": "industrial",
  "TEXTILE": "industrial",
  "CEMENT": "industrial",
  "FOOD & ALLIED": "industrial",
  "FUEL & POWER": "industrial",
  "CERAMICS": "industrial",
  "TANNERY": "industrial",
  "JUTE": "industrial",
  "PAPER & PRINTING": "industrial",
  "MISCELLANEOUS": "general",
  "SERVICES & REAL ESTATE": "general",
  "IT SECTOR": "general",
  "TELECOMMUNICATION": "general",
  "TRAVEL & LEISURE": "general",
  "CORPORATE BOND": "general",
  "MUTUAL FUNDS": "general",
};

export function templateForSector(sectorCode: string | null | undefined): ScorecardTemplate {
  if (!sectorCode) return "general";
  return DSE_SECTOR_TEMPLATE[sectorCode.toUpperCase()] ?? "general";
}

export function metricEnabled(template: ScorecardTemplate, metric: string): boolean {
  const p = SECTOR_PROFILES[template];
  if (metric in p.disabledMetrics) return false;
  return p.enabledMetrics.includes(metric);
}

export function metricDisabledReason(
  template: ScorecardTemplate,
  metric: string,
): string | undefined {
  return SECTOR_PROFILES[template].disabledMetrics[metric];
}
