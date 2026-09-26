import { customType, jsonb, pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core";

/* ===========================================================================
   Shared column blocks, enums and custom types.
   The point-in-time block below is the reason this schema is heavier than a
   typical CRUD app. It is not optional — see babull-docs/03-data-model.md.
   =========================================================================== */

/** pgvector column. Dimension must match LLM_EMBEDDING_DIM. */
export const vector = customType<{ data: number[]; driverData: string; config: { dim: number } }>({
  dataType(config) {
    return `vector(${config?.dim ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map((n) => Number(n));
  },
});

/* --- enums ---------------------------------------------------------------- */

/** Quality of a stored fact. `sample` marks non-real data (ADR 0007). */
export const qualityStateEnum = pgEnum("quality_state", [
  "ok",
  "suspect",
  "stale",
  "unavailable",
  "sample",
]);

/** How a source may be accessed — governs what we are allowed to build on it. */
export const sourceTypeEnum = pgEnum("source_type", [
  "api_documented",
  "file_download",
  "web_publication",
  "vendor_product",
  "community",
  "unverified",
  "synthetic", // sample data only
]);

/** Authority of a claim. Only `confirmed_document` may be stated as fact. */
export const claimStatusEnum = pgEnum("claim_status", [
  "confirmed_document",
  "attributed_report",
  "allegation",
  "analyst_interpretation",
  "model_inference",
]);

export const sourceAuthorityEnum = pgEnum("source_authority", [
  "official_filing",
  "regulator",
  "exchange",
  "company_statement",
  "reputable_media",
  "analyst",
  "social",
  "unknown",
]);

/** Per-session trading state. Prevents stale prices reading as live. */
export const tradingStateEnum = pgEnum("trading_state", [
  "normal",
  "halted",
  "suspended",
  "limit_up",
  "limit_down",
  "no_trade",
  "delisted",
]);

/** Risk-gate outcome. Non-compensatory — never folded into a score. */
export const gateStateEnum = pgEnum("gate_state", [
  "eligible",
  "restricted",
  "review_required",
  "excluded",
]);

export const horizonEnum = pgEnum("horizon", ["short", "medium", "long"]);

/** Whether a factor value is usable. `unavailable` is never read as zero. */
export const availabilityEnum = pgEnum("availability", [
  "available",
  "stale",
  "unavailable",
  "restricted",
  "under_review",
]);

export const regimeStateEnum = pgEnum("regime_state", [
  "bear",
  "late_bear_stress",
  "early_recovery",
  "confirmed_recovery",
  "bull",
  "strong_bull",
  "late_bull_distribution",
  "bear_transition",
  "indeterminate",
]);

export const regulatoryStatusEnum = pgEnum("regulatory_status", [
  "allegation",
  "interim_order",
  "proceeding",
  "final_finding",
  "resolved",
  "reversed",
]);

export const shariahStatusEnum = pgEnum("shariah_status", ["pass", "fail", "undetermined"]);

export const severityEnum = pgEnum("severity", ["info", "low", "medium", "high", "critical"]);

export const adjustmentBasisEnum = pgEnum("adjustment_basis", [
  "raw",
  "corporate_action_adjusted",
  "total_return",
]);

export const factorDirectionEnum = pgEnum("factor_direction", [
  "higher_better",
  "lower_better",
  "non_monotonic",
]);

/* --- shared column blocks ------------------------------------------------- */

/** Primary key + row bookkeeping present on every table. */
export const rowMeta = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * The point-in-time contract. Required on every market-sensitive fact table.
 *
 * "What did BABull know at time T?" =
 *   WHERE published_at <= T AND (superseded_at IS NULL OR superseded_at > T)
 *
 * A restatement INSERTs a new row and stamps the old one with `supersededAt` /
 * `supersededBy`. Nothing is ever updated in place.
 *
 * Tables declare their own `version` integer column, because Drizzle cannot
 * share one column builder instance across tables that index it.
 */
export const provenance = {
  sourceId: text("source_id").notNull(),
  sourceRecordId: text("source_record_id"),
  snapshotId: uuid("snapshot_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  parserVersion: text("parser_version").notNull().default("unknown"),
  quality: qualityStateEnum("quality").notNull().default("ok"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  supersededBy: uuid("superseded_by"),
  notes: jsonb("notes").$type<Record<string, unknown>>(),
};

/** Decimal money/share type. Never float — see babull-docs/03-data-model.md. */
export const MONEY = { precision: 20, scale: 6 } as const;
export const RATIO = { precision: 18, scale: 8 } as const;
