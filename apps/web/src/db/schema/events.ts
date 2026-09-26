import { relations } from "drizzle-orm";
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  RATIO,
  claimStatusEnum,
  provenance,
  rowMeta,
  sourceAuthorityEnum,
} from "./_shared";
import { documents } from "./documents";
import { issuers } from "./issuers";

/* ===========================================================================
   Events. `eventAt` (when it happened) and `publishedAt` (when the market
   could know) are different columns on purpose — conflating them is the most
   common way an event study leaks future information.
   =========================================================================== */

export const events = pgTable(
  "events",
  {
    ...rowMeta,
    ...provenance,

    /** Controlled taxonomy — see lib/domain/event-types.ts */
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    /** Legally compliant summary. Full text only where rights permit. */
    summary: text("summary"),

    eventAt: timestamp("event_at", { withTimezone: true }),
    /** `publishedAt` comes from `provenance` — when the source made it public. */

    sourceAuthority: sourceAuthorityEnum("source_authority").notNull().default("unknown"),
    claimStatus: claimStatusEnum("claim_status").notNull(),

    documentId: uuid("document_id").references(() => documents.id),
    externalUrl: text("external_url"),

    /** Extraction + corroboration confidence. NOT a claim about price causation. */
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    corroborationCount: integer("corroboration_count").notNull().default(0),
    /** Fingerprint used to collapse syndicated / repeated coverage. */
    dedupeKey: text("dedupe_key"),

    /** Measured market reaction, computed separately and stored for study. */
    reactionWindowDays: integer("reaction_window_days"),
    abnormalReturn: numeric("abnormal_return", RATIO),
    abnormalVolumeRatio: numeric("abnormal_volume_ratio", RATIO),

    reviewState: text("review_state").notNull().default("accepted"),
  },
  (t) => [
    index("events_type_idx").on(t.eventType),
    index("events_event_at_idx").on(t.eventAt),
    index("events_published_idx").on(t.publishedAt),
    index("events_dedupe_idx").on(t.dedupeKey),
    index("events_review_idx").on(t.reviewState),
  ],
);

/** Links an event to the entities it concerns, with the role each plays. */
export const eventEntities = pgTable(
  "event_entities",
  {
    ...rowMeta,
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** issuer | person | sector | government_body | instrument */
    entityKind: text("entity_kind").notNull(),
    issuerId: uuid("issuer_id").references(() => issuers.id),
    personId: uuid("person_id"),
    sectorCode: text("sector_code"),
    entityLabel: text("entity_label"),
    /** subject | mentioned | affected | issuer_of | counterparty */
    role: text("role").notNull().default("mentioned"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
  },
  (t) => [
    index("event_entities_event_idx").on(t.eventId),
    index("event_entities_issuer_idx").on(t.issuerId),
    index("event_entities_person_idx").on(t.personId),
  ],
);

/* ===========================================================================
   Unusual activity observations. Deliberately descriptive, never accusatory —
   `observation` holds the statistical fact and nothing more.
   =========================================================================== */

export const unusualActivity = pgTable(
  "unusual_activity",
  {
    ...rowMeta,
    instrumentId: uuid("instrument_id").notNull(),
    sessionDate: text("session_date").notNull(),
    /** volume | price_move | concentration | event_pattern | spread */
    kind: text("kind").notNull(),
    /** How far from baseline, in robust units (e.g. multiples of rolling median). */
    magnitude: numeric("magnitude", RATIO).notNull(),
    baselineDescription: text("baseline_description").notNull(),
    /** Plain statement of what was observed. No inference about cause or intent. */
    observation: text("observation").notNull(),
    /** Whether a disclosure exists in the window that could explain it. */
    correspondingDisclosureId: uuid("corresponding_disclosure_id").references(() => events.id),
    detectorVersion: text("detector_version").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("unusual_activity_instrument_idx").on(t.instrumentId, t.sessionDate),
    index("unusual_activity_kind_idx").on(t.kind),
  ],
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  document: one(documents, { fields: [events.documentId], references: [documents.id] }),
  entities: many(eventEntities),
}));

export const eventEntitiesRelations = relations(eventEntities, ({ one }) => ({
  event: one(events, { fields: [eventEntities.eventId], references: [events.id] }),
  issuer: one(issuers, { fields: [eventEntities.issuerId], references: [issuers.id] }),
}));
