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

import { MONEY, provenance, rowMeta } from "./_shared";
import { issuers } from "./issuers";

/* ===========================================================================
   Reported financial facts, long/narrow. One row per
   (issuer, metric, period, version). AS REPORTED ONLY — anything BABull
   computes lives in `derivedMetrics` with its formula version and lineage.
   =========================================================================== */

export const financialFacts = pgTable(
  "financial_facts",
  {
    ...rowMeta,
    ...provenance,
    version: integer("version").notNull().default(1),

    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),

    /** Canonical metric key, e.g. `revenue`, `net_income`, `eps_basic`. */
    metric: text("metric").notNull(),
    value: numeric("value", MONEY),
    unit: text("unit").notNull().default("BDT"),
    /** Scale as published, e.g. 1 | 1000 | 1000000. Value is already normalised. */
    reportedScale: integer("reported_scale").notNull().default(1),

    /** annual | half_yearly | quarterly | ttm */
    periodType: text("period_type").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end").notNull(),
    fiscalYear: integer("fiscal_year"),
    fiscalQuarter: integer("fiscal_quarter"),

    /** audited | unaudited | reviewed | provisional */
    auditStatus: text("audit_status"),
    /** unqualified | qualified | adverse | disclaimer | emphasis_going_concern */
    auditOpinion: text("audit_opinion"),

    statement: text("statement"), // income | balance | cashflow | notes
    /** Page / section reference in the source document, for the evidence drawer. */
    documentId: uuid("document_id"),
    pageRef: text("page_ref"),

    /** True when this row replaced an earlier published figure. */
    isRestatement: boolean("is_restatement").notNull().default(false),
    /** Low-confidence extractions must be human-reviewed before use. */
    extractionConfidence: numeric("extraction_confidence", { precision: 5, scale: 4 }),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("financial_facts_unique_idx").on(
      t.issuerId,
      t.metric,
      t.periodType,
      t.periodEnd,
      t.sourceId,
      t.version,
    ),
    index("financial_facts_lookup_idx").on(t.issuerId, t.metric, t.periodEnd.desc(), t.version.desc()),
    index("financial_facts_published_idx").on(t.publishedAt),
    index("financial_facts_period_idx").on(t.periodEnd),
  ],
);

/* ===========================================================================
   BABull-derived values. Separate table so "what the company reported" and
   "what we computed" can never be confused in the UI or in a backtest.
   =========================================================================== */

export const derivedMetrics = pgTable(
  "derived_metrics",
  {
    ...rowMeta,

    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),
    metric: text("metric").notNull(), // roe | net_margin | cash_conversion | ...
    value: numeric("value", MONEY),
    unit: text("unit"),

    periodType: text("period_type").notNull(),
    periodEnd: date("period_end").notNull(),

    /** As-of time the inputs were knowable — this is what makes it PIT-safe. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    formulaVersion: text("formula_version").notNull(),
    /** Ids of the financial_facts rows that produced this value. */
    inputLineage: jsonb("input_lineage").$type<string[]>().notNull(),
    /** available | unavailable | not_applicable (sector-gated) */
    availability: text("availability").notNull().default("available"),
    unavailableReason: text("unavailable_reason"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("derived_metrics_unique_idx").on(
      t.issuerId,
      t.metric,
      t.periodType,
      t.periodEnd,
      t.formulaVersion,
      t.asOf,
    ),
    index("derived_metrics_lookup_idx").on(t.issuerId, t.metric, t.periodEnd.desc()),
  ],
);

/* Flags raised on the financial statements for human review. Never auto-acted. */
export const financialFlags = pgTable(
  "financial_flags",
  {
    ...rowMeta,
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),
    periodEnd: date("period_end").notNull(),
    /** non_recurring_income | related_party | receivables_spike | inventory_build |
     *  negative_cash_conversion | accounting_change | going_concern | audit_qualified */
    flagType: text("flag_type").notNull(),
    detail: text("detail"),
    documentId: uuid("document_id"),
    pageRef: text("page_ref"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    reviewState: text("review_state").notNull().default("open"),
  },
  (t) => [index("financial_flags_issuer_idx").on(t.issuerId, t.periodEnd.desc())],
);

export const financialFactsRelations = relations(financialFacts, ({ one }) => ({
  issuer: one(issuers, { fields: [financialFacts.issuerId], references: [issuers.id] }),
}));
