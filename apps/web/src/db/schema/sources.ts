import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { rowMeta, severityEnum, sourceTypeEnum } from "./_shared";

/* ===========================================================================
   The source register. Every fact in the database points at a row here.
   `rights` is what makes "may we display / redistribute this?" a query rather
   than an audit — see babull-docs/adr/0006-build-first-sequencing.md.
   =========================================================================== */

export type SourceRights = {
  internalUse: boolean;
  derivedData: boolean;
  userDisplay: boolean;
  redistribution: boolean;
  retention: boolean;
  training: boolean;
  fullText: boolean; // news adapters store metadata only unless this is true
  territory: string | null;
  licenseRef: string | null;
  expiresAt: string | null;
};

export const sources = pgTable(
  "sources",
  {
    /** Stable string key used as the FK on every fact row, e.g. `dse_eod`. */
    sourceId: text("source_id").primaryKey(),
    providerName: text("provider_name").notNull(),
    officialUrl: text("official_url"),
    sourceType: sourceTypeEnum("source_type").notNull(),
    description: text("description"),

    // access
    authMethod: text("auth_method"),
    /** Reference to a secret, never the secret value itself. */
    secretRef: text("secret_ref"),
    endpointMechanism: text("endpoint_mechanism"),

    // coverage
    historyStart: text("history_start"),
    granularity: text("granularity"),
    timezone: text("timezone").notNull().default("Asia/Dhaka"),
    knownGaps: jsonb("known_gaps").$type<string[]>(),

    // operations
    refreshSchedule: text("refresh_schedule"),
    cursorSemantics: text("cursor_semantics"),
    rateLimitPerMinute: integer("rate_limit_per_minute"),
    /** Freshness budget: beyond this, values render as `stale`, not `available`. */
    freshnessBudgetMinutes: integer("freshness_budget_minutes"),

    rights: jsonb("rights").$type<SourceRights>().notNull(),

    // observability (denormalised for the data-quality console)
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastErrorState: text("last_error_state"),
    schemaVersion: text("schema_version"),
    parserVersion: text("parser_version"),

    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sources_type_idx").on(t.sourceType), index("sources_enabled_idx").on(t.enabled)],
);

/* ===========================================================================
   Immutable raw snapshots. Fetch writes here BEFORE parsing, so a parser bug
   is replayable without re-fetching and without trusting the network twice.
   =========================================================================== */

export const snapshots = pgTable(
  "snapshots",
  {
    ...rowMeta,
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.sourceId),
    /** Storage key (local path or S3 object key). Bytes are never in Postgres. */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    contentHash: text("content_hash").notNull(),
    byteSize: integer("byte_size").notNull(),
    requestUrl: text("request_url"),
    requestMethod: text("request_method"),
    requestParams: jsonb("request_params").$type<Record<string, unknown>>(),
    httpStatus: integer("http_status"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    ingestionRunId: uuid("ingestion_run_id"),
  },
  (t) => [
    index("snapshots_source_idx").on(t.sourceId, t.retrievedAt),
    index("snapshots_hash_idx").on(t.contentHash),
  ],
);

/* ===========================================================================
   Ingestion runs — one row per adapter execution, success or failure.
   =========================================================================== */

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    ...rowMeta,
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.sourceId),
    adapter: text("adapter").notNull(),
    parserVersion: text("parser_version").notNull(),
    /** `scheduled` | `manual` | `backfill` | `verify` */
    trigger: text("trigger").notNull(),
    windowFrom: text("window_from"),
    windowTo: text("window_to"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** `running` | `succeeded` | `failed` | `partial` */
    status: text("status").notNull().default("running"),
    rowsFetched: integer("rows_fetched").notNull().default(0),
    rowsWritten: integer("rows_written").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    /** Rejections are data. Every dropped row records why. */
    rejectionReasons: jsonb("rejection_reasons").$type<Record<string, number>>(),
    lagMinutes: integer("lag_minutes"),
    errorMessage: text("error_message"),
    errorSeverity: severityEnum("error_severity"),
    report: jsonb("report").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("ingestion_runs_source_idx").on(t.sourceId, t.startedAt),
    index("ingestion_runs_status_idx").on(t.status),
  ],
);

export const sourcesRelations = relations(sources, ({ many }) => ({
  snapshots: many(snapshots),
  runs: many(ingestionRuns),
}));

export const snapshotsRelations = relations(snapshots, ({ one }) => ({
  source: one(sources, { fields: [snapshots.sourceId], references: [sources.sourceId] }),
}));
