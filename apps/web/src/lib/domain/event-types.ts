/**
 * Controlled event taxonomy. A free-text event type makes the timeline
 * unqueryable and the event study meaningless, so extraction must map into
 * exactly one of these.
 */
export const EVENT_TYPES = {
  // company financial
  earnings_release: "Earnings release",
  dividend_declaration: "Dividend declaration",
  dividend_revision: "Dividend revision",
  agm_notice: "AGM notice",
  egm_notice: "EGM notice",
  price_sensitive_information: "Price sensitive information",
  financial_restatement: "Financial restatement",

  // capital structure
  bonus_issue: "Bonus issue",
  rights_issue: "Rights issue",
  stock_split: "Stock split",
  capital_raise: "Capital raise",
  debt_issuance: "Debt issuance",
  buyback: "Share buyback",

  // governance / people
  director_appointment: "Director appointment",
  director_resignation: "Director resignation",
  executive_change: "Executive change",
  auditor_change: "Auditor change",
  sponsor_shareholding_change: "Sponsor shareholding change",
  related_party_transaction: "Related party transaction",

  // regulatory
  regulatory_order: "Regulatory order",
  enforcement_action: "Enforcement action",
  penalty_imposed: "Penalty imposed",
  trading_suspension: "Trading suspension",
  trading_resumption: "Trading resumption",
  listing_change: "Listing change",
  compliance_notice: "Compliance notice",
  regulatory_inquiry: "Regulatory inquiry",

  // operations
  plant_disruption: "Plant / operations disruption",
  capacity_expansion: "Capacity expansion",
  major_contract: "Major contract",
  acquisition: "Acquisition",
  divestment: "Divestment",
  litigation: "Litigation",
  credit_rating_change: "Credit rating change",

  // macro / policy / sector
  policy_change: "Policy change",
  macro_release: "Macro data release",
  monetary_policy: "Monetary policy",
  tariff_or_tax_change: "Tariff or tax change",
  sector_event: "Sector event",

  // market structure
  index_reconstitution: "Index reconstitution",
  circuit_breaker: "Circuit breaker",

  other: "Other",
} as const;

export type EventType = keyof typeof EVENT_TYPES;

export const EVENT_TYPE_GROUPS: Record<string, EventType[]> = {
  Financial: [
    "earnings_release",
    "dividend_declaration",
    "dividend_revision",
    "financial_restatement",
    "price_sensitive_information",
  ],
  "Capital structure": ["bonus_issue", "rights_issue", "stock_split", "capital_raise", "debt_issuance", "buyback"],
  Governance: [
    "director_appointment",
    "director_resignation",
    "executive_change",
    "auditor_change",
    "sponsor_shareholding_change",
    "related_party_transaction",
  ],
  Regulatory: [
    "regulatory_order",
    "enforcement_action",
    "penalty_imposed",
    "trading_suspension",
    "trading_resumption",
    "compliance_notice",
    "regulatory_inquiry",
    "listing_change",
  ],
  Operations: [
    "plant_disruption",
    "capacity_expansion",
    "major_contract",
    "acquisition",
    "divestment",
    "litigation",
    "credit_rating_change",
  ],
  "Macro & sector": ["policy_change", "macro_release", "monetary_policy", "tariff_or_tax_change", "sector_event"],
  Meetings: ["agm_notice", "egm_notice"],
  Market: ["index_reconstitution", "circuit_breaker"],
  Other: ["other"],
};

export function eventTypeLabel(t: string): string {
  return (EVENT_TYPES as Record<string, string>)[t] ?? t;
}
