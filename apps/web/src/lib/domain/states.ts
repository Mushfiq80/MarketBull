/**
 * The value-state vocabulary. Everything market-sensitive in BABull is one of
 * these, and the four display states must never collapse into one another.
 *
 *   missing  ≠  stale  ≠  zero  ≠  confirmed negative
 *
 * A missing value is NEVER rendered as 0, "N/A" or blank.
 */
export type ValueState =
  | "available"
  | "stale"
  | "unavailable"
  | "restricted"
  | "under_review";

export type QualityState = "ok" | "suspect" | "stale" | "unavailable" | "sample";

export type GateState = "eligible" | "restricted" | "review_required" | "excluded";

export type Horizon = "short" | "medium" | "long";

export type ClaimStatus =
  | "confirmed_document"
  | "attributed_report"
  | "allegation"
  | "analyst_interpretation"
  | "model_inference";

export type SourceAuthority =
  | "official_filing"
  | "regulator"
  | "exchange"
  | "company_statement"
  | "reputable_media"
  | "analyst"
  | "social"
  | "unknown";

export type RegimeState =
  | "bear"
  | "late_bear_stress"
  | "early_recovery"
  | "confirmed_recovery"
  | "bull"
  | "strong_bull"
  | "late_bull_distribution"
  | "bear_transition"
  | "indeterminate";

export type TradingState =
  | "normal"
  | "halted"
  | "suspended"
  | "limit_up"
  | "limit_down"
  | "no_trade"
  | "delisted";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

/**
 * A market-sensitive value with its state. Engines return this shape rather than
 * a bare number so that "we don't know" survives every layer to the screen.
 */
export type StatefulValue = {
  /** Decimal string — never a JS number for money. Null when not available. */
  value: string | null;
  state: ValueState;
  /** Why it is unavailable / stale / restricted. Shown in the tooltip. */
  reason?: string;
  /** Age in minutes, for stale values. */
  ageMinutes?: number;
  unit?: string;
};

export const HORIZON_LABELS: Record<Horizon, string> = {
  short: "Short term",
  medium: "Medium term",
  long: "Long term",
};

export const HORIZON_DESCRIPTIONS: Record<Horizon, string> = {
  short: "5–20 trading sessions",
  medium: "1–6 months",
  long: "1–5 years",
};

/** Target outcome each horizon's model is validated against (methodology §1). */
export const HORIZON_TARGETS: Record<Horizon, string> = {
  short: "10-session forward return, market- and sector-adjusted, net of costs",
  medium: "3-month forward return, sector-adjusted",
  long: "3-year annualised total return including dividends",
};

export const REGIME_LABELS: Record<RegimeState, string> = {
  bear: "Bear",
  late_bear_stress: "Late bear / stress",
  early_recovery: "Early recovery",
  confirmed_recovery: "Confirmed recovery",
  bull: "Bull",
  strong_bull: "Strong bull",
  late_bull_distribution: "Late bull / distribution",
  bear_transition: "Bear transition",
  indeterminate: "Indeterminate",
};

export const GATE_LABELS: Record<GateState, string> = {
  eligible: "Eligible",
  restricted: "Restricted",
  review_required: "Review required",
  excluded: "Excluded",
};

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  confirmed_document: "Confirmed document",
  attributed_report: "Attributed report",
  allegation: "Allegation",
  analyst_interpretation: "Analyst interpretation",
  model_inference: "Model inference",
};

/**
 * Only a confirmed document may be stated as fact. Everything else is
 * attributed, hedged, or labelled as inference in the UI copy.
 */
export function mayStateAsFact(status: ClaimStatus): boolean {
  return status === "confirmed_document";
}
