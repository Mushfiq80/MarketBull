import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  RATIO,
  availabilityEnum,
  factorDirectionEnum,
  gateStateEnum,
  horizonEnum,
  regimeStateEnum,
  rowMeta,
  shariahStatusEnum,
} from "./_shared";
import { instruments, issuers } from "./issuers";

/* ===========================================================================
   Factor snapshots. One row per (instrument, as_of, factor, model_version).
   `availability` is why a missing input can never read as zero downstream.
   =========================================================================== */

export const factorSnapshots = pgTable(
  "factor_snapshots",
  {
    ...rowMeta,
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    sessionDate: date("session_date").notNull(),

    factor: text("factor").notNull(),
    pillar: text("pillar"), // F | O | X | regime | null
    direction: factorDirectionEnum("direction").notNull(),

    /** Raw value, retained alongside the normalized one. */
    rawValue: numeric("raw_value", RATIO),
    /** Cross-sectional normalized value, by sector and date. 0-100 or z. */
    normalizedValue: numeric("normalized_value", RATIO),
    normalizationMethod: text("normalization_method"),
    /** Peer set used for the cross-section — documented, not implied. */
    peerGroupKey: text("peer_group_key"),
    peerCount: integer("peer_count"),

    availability: availabilityEnum("availability").notNull().default("available"),
    unavailableReason: text("unavailable_reason"),
    observationsUsed: integer("observations_used"),
    inputStalenessDays: integer("input_staleness_days"),

    modelVersion: text("model_version").notNull(),
    configHash: text("config_hash").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set true when ANY contributing row was sample-tagged (ADR 0007). */
    usedSampleData: boolean("used_sample_data").notNull().default(false),
  },
  (t) => [
    uniqueIndex("factor_snapshots_unique_idx").on(
      t.instrumentId,
      t.sessionDate,
      t.factor,
      t.modelVersion,
    ),
    index("factor_snapshots_lookup_idx").on(t.sessionDate.desc(), t.factor),
    index("factor_snapshots_instrument_idx").on(t.instrumentId, t.sessionDate.desc()),
  ],
);

/* ===========================================================================
   Score snapshots. IMMUTABLE — a published score is never recomputed. Model
   changes produce new rows under a new model_version; history stays as
   published so calibration can be measured honestly.
   =========================================================================== */

export const scoreSnapshots = pgTable(
  "score_snapshots",
  {
    ...rowMeta,
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    sessionDate: date("session_date").notNull(),
    horizon: horizonEnum("horizon").notNull(),

    /** Pillar scores 0-100. Null when the pillar had insufficient inputs. */
    fundamentalsScore: numeric("fundamentals_score", RATIO),
    opportunityScore: numeric("opportunity_score", RATIO),
    /** X-quality: higher means LOWER measured exposure. */
    exposureQualityScore: numeric("exposure_quality_score", RATIO),
    composite: numeric("composite", RATIO),

    /** Evidence reliability 0-100. NOT a probability of profit. */
    conviction: numeric("conviction", RATIO),
    convictionBreakdown: jsonb("conviction_breakdown").$type<{
      sourceAuthority: number;
      freshness: number;
      completeness: number;
      agreement: number;
      historicalCalibration: number | null;
    }>(),

    /** The weight vector ACTUALLY used, after unavailable factors were dropped.
     *  Never silently renormalized without recording it here. */
    effectiveWeights: jsonb("effective_weights").$type<Record<string, number>>().notNull(),
    factorValues: jsonb("factor_values").$type<Record<string, number | null>>().notNull(),

    gateState: gateStateEnum("gate_state").notNull().default("eligible"),
    gateTriggers: jsonb("gate_triggers").$type<
      { gate: string; reason: string; evidence?: string; since?: string }[]
    >(),

    /** Rank within the eligible universe for this horizon and date. */
    rank: integer("rank"),
    universeSize: integer("universe_size"),
    /** Delta vs the previous snapshot, for the change indicator. */
    compositeDelta: numeric("composite_delta", RATIO),
    rankDelta: integer("rank_delta"),

    modelVersion: text("model_version").notNull(),
    configHash: text("config_hash").notNull(),
    dataCompleteness: numeric("data_completeness", RATIO),
    usedSampleData: boolean("used_sample_data").notNull().default(false),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("score_snapshots_unique_idx").on(
      t.instrumentId,
      t.sessionDate,
      t.horizon,
      t.modelVersion,
    ),
    index("score_snapshots_ranking_idx").on(t.horizon, t.sessionDate.desc(), t.composite.desc()),
    index("score_snapshots_instrument_idx").on(t.instrumentId, t.sessionDate.desc()),
    index("score_snapshots_gate_idx").on(t.gateState),
  ],
);

/* ===========================================================================
   FOX narrative reports. The numbers come from scoreSnapshots; this table
   holds the composed research output and its evidence bindings.
   =========================================================================== */

export const foxReports = pgTable(
  "fox_reports",
  {
    ...rowMeta,
    scoreSnapshotId: uuid("score_snapshot_id")
      .notNull()
      .references(() => scoreSnapshots.id),
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),
    horizon: horizonEnum("horizon").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),

    thesis: text("thesis"),
    counterThesis: text("counter_thesis"),
    /** What would confirm, weaken or invalidate the thesis. */
    invalidationConditions: jsonb("invalidation_conditions").$type<
      { condition: string; direction: "confirms" | "weakens" | "invalidates" }[]
    >(),
    changesSincePrevious: jsonb("changes_since_previous").$type<
      { kind: "positive" | "negative"; detail: string; evidenceId?: string }[]
    >(),
    catalysts: jsonb("catalysts").$type<
      {
        horizon: "near" | "medium" | "long";
        description: string;
        eventDate: string | null;
        sourceStatus: string;
        eventId?: string;
      }[]
    >(),
    scenarios: jsonb("scenarios").$type<
      {
        case: "bear" | "base" | "bull";
        assumptions: Record<string, string>;
        valuationMethod: string;
        rangeLow: string | null;
        rangeHigh: string | null;
        sensitivity: Record<string, string> | null;
      }[]
    >(),
    keyRisks: jsonb("key_risks").$type<{ risk: string; severity: string; evidenceId?: string }[]>(),
    dataGaps: jsonb("data_gaps").$type<string[]>(),
    /** Every narrative claim maps to an evidence record id. */
    evidenceBindings: jsonb("evidence_bindings").$type<
      { claim: string; evidenceIds: string[]; kind: "fact" | "inference" }[]
    >(),

    /** Which LLM composed the narrative, for auditability. */
    composerModel: text("composer_model"),
    composerPromptVersion: text("composer_prompt_version"),
    /** Stamped when generated from sample data. */
    sampleWatermark: boolean("sample_watermark").notNull().default(false),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fox_reports_issuer_idx").on(t.issuerId, t.asOf.desc()),
    uniqueIndex("fox_reports_snapshot_idx").on(t.scoreSnapshotId),
  ],
);

/* ===========================================================================
   Market regime. Two separate outputs — never merged (methodology §6).
   =========================================================================== */

export const regimeSnapshots = pgTable(
  "regime_snapshots",
  {
    ...rowMeta,
    exchange: text("exchange").notNull().default("DSE"),
    sessionDate: date("session_date").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),

    state: regimeStateEnum("state").notNull(),
    stateScore: numeric("state_score", RATIO),
    /** Per-dimension contributions: trend, breadth, liquidity, earnings, macro. */
    factorContributions: jsonb("factor_contributions").$type<Record<string, number | null>>().notNull(),
    effectiveWeights: jsonb("effective_weights").$type<Record<string, number>>().notNull(),
    /** Missing series are reported, not silently renormalized away. */
    missingSeries: jsonb("missing_series").$type<string[]>(),
    dataCompleteness: numeric("data_completeness", RATIO),
    confidence: numeric("confidence", RATIO),

    /** Conditions that would confirm or weaken a transition, with evidence. */
    transitionWatch: jsonb("transition_watch").$type<
      { condition: string; met: boolean; direction: "confirms" | "weakens"; detail: string }[]
    >(),

    /** 20% rise/fall benchmark label, generated separately for research only. */
    cycleBenchmarkLabel: text("cycle_benchmark_label"),

    modelVersion: text("model_version").notNull(),
    configHash: text("config_hash").notNull(),
    usedSampleData: boolean("used_sample_data").notNull().default(false),
  },
  (t) => [
    uniqueIndex("regime_snapshots_unique_idx").on(t.exchange, t.sessionDate, t.modelVersion),
    index("regime_snapshots_date_idx").on(t.sessionDate.desc()),
  ],
);

export const regimeForecasts = pgTable(
  "regime_forecasts",
  {
    ...rowMeta,
    regimeSnapshotId: uuid("regime_snapshot_id")
      .notNull()
      .references(() => regimeSnapshots.id),
    horizonSessions: integer("horizon_sessions").notNull(), // 20 | 60 | 120
    targetState: regimeStateEnum("target_state").notNull(),
    probability: numeric("probability", RATIO),

    /** Rows are only emitted once calibration passes. Until then the API
     *  returns MODEL_UNCALIBRATED rather than an uncalibrated number. */
    calibrationState: text("calibration_state").notNull().default("uncalibrated"),
    calibrationVersion: text("calibration_version"),
    brierScore: numeric("brier_score", RATIO),
    logLoss: numeric("log_loss", RATIO),
    calibrationSampleSize: integer("calibration_sample_size"),

    modelVersion: text("model_version").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("regime_forecasts_snapshot_idx").on(t.regimeSnapshotId),
    index("regime_forecasts_calibration_idx").on(t.calibrationState),
  ],
);

/* ===========================================================================
   Shariah screens. A screen, explicitly not a certification or a fatwa.
   =========================================================================== */

export const shariahScreens = pgTable(
  "shariah_screens",
  {
    ...rowMeta,
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),
    methodology: text("methodology").notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    status: shariahStatusEnum("status").notNull(),

    /** Per-rule outcome, so every pass/fail/undetermined reason is visible. */
    businessActivityResults: jsonb("business_activity_results").$type<
      { rule: string; outcome: string; detail: string; evidenceId?: string }[]
    >().notNull(),
    financialRatioResults: jsonb("financial_ratio_results").$type<
      { rule: string; threshold: string; actual: string | null; outcome: string }[]
    >().notNull(),
    undeterminedReasons: jsonb("undetermined_reasons").$type<string[]>(),

    dataDate: date("data_date").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shariah_unique_idx").on(t.issuerId, t.methodology, t.methodologyVersion, t.dataDate),
    index("shariah_issuer_idx").on(t.issuerId, t.asOf.desc()),
    index("shariah_status_idx").on(t.status),
  ],
);

/* ===========================================================================
   Backtests. Config is pinned so a run id fully reproduces a result.
   =========================================================================== */

export const backtestRuns = pgTable(
  "backtest_runs",
  {
    ...rowMeta,
    name: text("name").notNull(),
    /** Hypothesis, frozen BEFORE the test. Part of the anti-snooping record. */
    hypothesis: text("hypothesis").notNull(),

    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    configHash: text("config_hash").notNull(),
    modelVersion: text("model_version").notNull(),
    codeCommit: text("code_commit"),
    /** Snapshot ids pinning the exact data vintage used. */
    dataSnapshotIds: jsonb("data_snapshot_ids").$type<string[]>(),

    universeDefinition: text("universe_definition").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    horizon: horizonEnum("horizon"),
    rebalanceFrequency: text("rebalance_frequency"),

    /** `running` | `succeeded` | `failed` | `blocked` */
    status: text("status").notNull().default("running"),
    /** Populated when a guard raised — e.g. SampleDataError. */
    blockedReason: text("blocked_reason"),
    guardResults: jsonb("guard_results").$type<Record<string, { passed: boolean; detail?: string }>>(),

    /** Count of prior runs against the same hypothesis — multiple-testing record. */
    attemptNumber: integer("attempt_number").notNull().default(1),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("backtest_runs_status_idx").on(t.status),
    index("backtest_runs_hash_idx").on(t.configHash),
  ],
);

export const backtestResults = pgTable(
  "backtest_results",
  {
    ...rowMeta,
    runId: uuid("run_id")
      .notNull()
      .references(() => backtestRuns.id, { onDelete: "cascade" }),
    /** overall | regime:<state> | sector:<code> | liquidity:<bucket> | period:<year> */
    sliceKey: text("slice_key").notNull(),

    grossReturn: numeric("gross_return", RATIO),
    netReturn: numeric("net_return", RATIO),
    benchmarkReturn: numeric("benchmark_return", RATIO),
    benchmarkName: text("benchmark_name"),
    excessReturn: numeric("excess_return", RATIO),

    maxDrawdown: numeric("max_drawdown", RATIO),
    volatility: numeric("volatility", RATIO),
    downsideDeviation: numeric("downside_deviation", RATIO),
    turnover: numeric("turnover", RATIO),
    hitRate: numeric("hit_rate", RATIO),

    /** Ranking quality */
    rankIc: numeric("rank_ic", RATIO),
    topBottomSpread: numeric("top_bottom_spread", RATIO),
    /** Forecast calibration */
    brierScore: numeric("brier_score", RATIO),
    logLoss: numeric("log_loss", RATIO),

    sampleSize: integer("sample_size"),
    confidenceIntervalLow: numeric("ci_low", RATIO),
    confidenceIntervalHigh: numeric("ci_high", RATIO),
    /** Honest reporting: negative results are stored, not discarded. */
    interpretation: text("interpretation"),
    limitations: jsonb("limitations").$type<string[]>(),
  },
  (t) => [uniqueIndex("backtest_results_unique_idx").on(t.runId, t.sliceKey)],
);

export const scoreSnapshotsRelations = relations(scoreSnapshots, ({ one }) => ({
  instrument: one(instruments, {
    fields: [scoreSnapshots.instrumentId],
    references: [instruments.id],
  }),
  report: one(foxReports, {
    fields: [scoreSnapshots.id],
    references: [foxReports.scoreSnapshotId],
  }),
}));

export const regimeSnapshotsRelations = relations(regimeSnapshots, ({ many }) => ({
  forecasts: many(regimeForecasts),
}));

export const backtestRunsRelations = relations(backtestRuns, ({ many }) => ({
  results: many(backtestResults),
}));
