import { relations } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { RATIO, provenance, rowMeta } from "./_shared";
import { documents } from "./documents";
import { issuers } from "./issuers";

/* ===========================================================================
   People and relationships. Identity resolution is deliberately conservative:
   two similar names are NOT the same person without corroborating evidence.
   Ambiguity is preserved rather than guessed.
   =========================================================================== */

export const people = pgTable(
  "people",
  {
    ...rowMeta,
    ...provenance,

    fullName: text("full_name").notNull(),
    fullNameBn: text("full_name_bn"),
    /** Alternate spellings / transliterations seen in filings. */
    aliases: jsonb("aliases").$type<string[]>(),
    /** Non-identifying disambiguators only — role history, associated companies. */
    disambiguators: jsonb("disambiguators").$type<string[]>(),
    /** How confident we are that this record is one real distinct person. */
    identityConfidence: numeric("identity_confidence", { precision: 5, scale: 4 }),
    /** Set when we suspect but cannot prove two records are the same person. */
    possibleDuplicateOf: uuid("possible_duplicate_of"),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id),
  },
  (t) => [
    index("people_name_idx").on(t.fullName),
    index("people_dupe_idx").on(t.possibleDuplicateOf),
  ],
);

export const relationshipEdges = pgTable(
  "relationship_edges",
  {
    ...rowMeta,
    ...provenance,

    /** DIRECTOR_OF | EXECUTIVE_AT | SPONSOR_OF | REPORTED_TO_OWN |
     *  SUBSIDIARY_OF | ASSOCIATE_OF | RELATED_PARTY_OF | AUDITOR_OF */
    edgeType: text("edge_type").notNull(),

    fromKind: text("from_kind").notNull(), // person | issuer
    fromPersonId: uuid("from_person_id").references(() => people.id),
    fromIssuerId: uuid("from_issuer_id").references(() => issuers.id),

    toKind: text("to_kind").notNull(),
    toPersonId: uuid("to_person_id").references(() => people.id),
    toIssuerId: uuid("to_issuer_id").references(() => issuers.id),

    role: text("role"),
    /** Disclosed shareholding percentage, where the edge is an ownership claim. */
    stakePercent: numeric("stake_percent", RATIO),

    validFrom: date("valid_from"),
    validTo: date("valid_to"),

    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id),
    pageRef: text("page_ref"),
    /** Beneficial ownership is only asserted where a lawful source establishes it. */
    isBeneficialOwnershipClaim: text("is_beneficial_ownership_claim").notNull().default("no"),
  },
  (t) => [
    index("rel_edges_from_person_idx").on(t.fromPersonId),
    index("rel_edges_from_issuer_idx").on(t.fromIssuerId),
    index("rel_edges_to_issuer_idx").on(t.toIssuerId),
    index("rel_edges_type_idx").on(t.edgeType),
  ],
);

/* Shareholding composition as disclosed, point in time. */
export const ownershipSnapshots = pgTable(
  "ownership_snapshots",
  {
    ...rowMeta,
    ...provenance,

    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),
    asOfDate: date("as_of_date").notNull(),

    sponsorDirectorPct: numeric("sponsor_director_pct", RATIO),
    governmentPct: numeric("government_pct", RATIO),
    institutionalPct: numeric("institutional_pct", RATIO),
    foreignPct: numeric("foreign_pct", RATIO),
    publicPct: numeric("public_pct", RATIO),

    documentId: uuid("document_id").references(() => documents.id),
  },
  (t) => [
    uniqueIndex("ownership_unique_idx").on(t.issuerId, t.asOfDate, t.sourceId),
    index("ownership_issuer_idx").on(t.issuerId, t.asOfDate.desc()),
  ],
);

export const peopleRelations = relations(people, ({ many }) => ({
  edgesFrom: many(relationshipEdges),
}));
