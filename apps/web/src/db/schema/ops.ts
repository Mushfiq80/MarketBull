import {
  boolean,
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

import { RATIO, rowMeta, severityEnum } from "./_shared";

/* ===========================================================================
   Data quality register. A parse failure or a source conflict becomes a row
   here — it is never silently corrected and never silently dropped.
   =========================================================================== */

export const dataQualityIssues = pgTable(
  "data_quality_issues",
  {
    ...rowMeta,
    sourceId: text("source_id"),
    adapter: text("adapter"),
    ingestionRunId: uuid("ingestion_run_id"),

    /** missing_bar | duplicate_record | parse_failure | schema_change |
     *  unit_change | value_conflict | corporate_action_conflict |
     *  stale_source | range_violation | continuity_gap | identity_ambiguity */
    issueKind: text("issue_kind").notNull(),
    severity: severityEnum("severity").notNull(),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),

    /** What the issue affects, so the UI can mark the right values. */
    affectedTable: text("affected_table"),
    affectedEntityId: uuid("affected_entity_id"),
    affectedSessionDate: text("affected_session_date"),
    affectedFeatures: jsonb("affected_features").$type<string[]>(),

    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    /** open | investigating | resolved | accepted | wont_fix */
    state: text("state").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
  },
  (t) => [
    index("dq_issues_state_idx").on(t.state, t.severity),
    index("dq_issues_source_idx").on(t.sourceId, t.detectedAt.desc()),
    index("dq_issues_kind_idx").on(t.issueKind),
  ],
);

/* ===========================================================================
   Model registry. Promotion is gated; rollback is supported; historical
   published scores are never recomputed.
   =========================================================================== */

export const modelVersions = pgTable(
  "model_versions",
  {
    ...rowMeta,
    /** fox | regime | conviction | shariah | unusual_activity | transition */
    family: text("family").notNull(),
    version: text("version").notNull(),
    configHash: text("config_hash").notNull(),
    /** The full pinned config, so a score is reproducible from this row alone. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    artifactKey: text("artifact_key"),
    codeCommit: text("code_commit"),

    /** draft | validating | validated | promoted | rolled_back | retired */
    state: text("state").notNull().default("draft"),
    /** Acceptance criteria defined BEFORE validation — anti-snooping record. */
    acceptanceCriteria: jsonb("acceptance_criteria").$type<Record<string, unknown>>(),
    validationResults: jsonb("validation_results").$type<Record<string, unknown>>(),
    validationBacktestRunId: uuid("validation_backtest_run_id"),

    /** Model card fields. */
    intendedUse: text("intended_use"),
    targetOutcome: text("target_outcome"),
    limitations: jsonb("limitations").$type<string[]>(),
    knownFailureModes: jsonb("known_failure_modes").$type<string[]>(),
    subgroupPerformance: jsonb("subgroup_performance").$type<Record<string, unknown>>(),

    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    promotedBy: text("promoted_by"),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rollbackReason: text("rollback_reason"),
    isActive: boolean("is_active").notNull().default(false),
  },
  (t) => [
    uniqueIndex("model_versions_unique_idx").on(t.family, t.version),
    index("model_versions_active_idx").on(t.family, t.isActive),
    index("model_versions_state_idx").on(t.state),
  ],
);

/** Drift monitoring observations, so degradation is noticed before it misleads. */
export const driftObservations = pgTable(
  "drift_observations",
  {
    ...rowMeta,
    modelFamily: text("model_family").notNull(),
    modelVersion: text("model_version").notNull(),
    sessionDate: text("session_date").notNull(),
    /** data | feature | score_distribution | calibration | coverage */
    driftKind: text("drift_kind").notNull(),
    metric: text("metric").notNull(),
    value: numeric("value", RATIO),
    baselineValue: numeric("baseline_value", RATIO),
    /** Population stability index / KS statistic, depending on driftKind. */
    statistic: numeric("statistic", RATIO),
    breachedThreshold: boolean("breached_threshold").notNull().default(false),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("drift_model_idx").on(t.modelFamily, t.sessionDate),
    index("drift_breach_idx").on(t.breachedThreshold),
  ],
);

/* Audit log for administrative changes, model promotion, data corrections. */
export const auditLog = pgTable(
  "audit_log",
  {
    ...rowMeta,
    actor: text("actor").notNull(),
    actorKind: text("actor_kind").notNull().default("user"), // user | system | agent
    action: text("action").notNull(),
    targetTable: text("target_table"),
    targetId: text("target_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    reason: text("reason"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_actor_idx").on(t.actor, t.occurredAt.desc()),
    index("audit_action_idx").on(t.action),
    index("audit_target_idx").on(t.targetTable, t.targetId),
  ],
);

/* Job queue state for ingestion / computation pipelines run in-process. */
export const jobs = pgTable(
  "jobs",
  {
    ...rowMeta,
    jobType: text("job_type").notNull(),
    /** Idempotency key — a retried job must not double-write. */
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** pending | running | succeeded | failed | dead_letter */
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    /** Checkpoint so a long backfill resumes rather than restarts. */
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_idx").on(t.idempotencyKey),
    index("jobs_state_idx").on(t.state, t.scheduledFor),
    index("jobs_type_idx").on(t.jobType),
  ],
);
