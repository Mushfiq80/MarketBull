import { relations } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  MONEY,
  provenance,
  regulatoryStatusEnum,
  rowMeta,
  severityEnum,
} from "./_shared";
import { documents } from "./documents";
import { issuers } from "./issuers";
import { people } from "./people";

/* ===========================================================================
   Regulatory actions. The `status` enum is the whole point: an allegation, an
   interim order, a final finding and a reversal are different things, and only
   a final finding may be described as a finding.
   =========================================================================== */

export const regulatoryActions = pgTable(
  "regulatory_actions",
  {
    ...rowMeta,
    ...provenance,

    authority: text("authority").notNull(), // BSEC | DSE | Bangladesh Bank | court | other
    orderNumber: text("order_number"),
    /** enforcement | penalty | suspension | warning | directive | inquiry | compliance */
    actionType: text("action_type").notNull(),
    status: regulatoryStatusEnum("status").notNull(),
    severity: severityEnum("severity").notNull().default("medium"),

    subjectIssuerId: uuid("subject_issuer_id").references(() => issuers.id),
    subjectPersonId: uuid("subject_person_id").references(() => people.id),
    subjectLabel: text("subject_label"),

    subject: text("subject").notNull(),
    /** Exact wording matters — quoted, never paraphrased into an accusation. */
    officialText: text("official_text"),
    penaltyAmount: numeric("penalty_amount", MONEY),

    issueDate: date("issue_date"),
    actionEffectiveDate: date("action_effective_date"),
    resolutionDate: date("resolution_date"),
    /** Appeal / correction context, where published. */
    appealContext: text("appeal_context"),
    reviewDate: date("review_date"),

    documentId: uuid("document_id").references(() => documents.id),
    officialUrl: text("official_url"),
  },
  (t) => [
    index("reg_actions_issuer_idx").on(t.subjectIssuerId, t.issueDate.desc()),
    index("reg_actions_person_idx").on(t.subjectPersonId),
    index("reg_actions_status_idx").on(t.status, t.severity),
    index("reg_actions_authority_idx").on(t.authority),
  ],
);

/* ===========================================================================
   Derived governance indicators. Feed the X pillar; reviewable before they can
   drive an automatic exclusion.
   =========================================================================== */

export const governanceFlags = pgTable(
  "governance_flags",
  {
    ...rowMeta,
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),
    /** audit_qualified | going_concern | frequent_board_change | related_party_heavy |
     *  disclosure_delay | enforcement_active | auditor_change | sponsor_stake_drop */
    flagType: text("flag_type").notNull(),
    severity: severityEnum("severity").notNull(),
    /** Weight decays with age — recorded so the decay is auditable. */
    ageDecayedWeight: numeric("age_decayed_weight", { precision: 8, scale: 6 }),
    detail: text("detail").notNull(),
    supportingEvidence: jsonb("supporting_evidence").$type<string[]>(),
    regulatoryActionId: uuid("regulatory_action_id").references(() => regulatoryActions.id),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    reviewState: text("review_state").notNull().default("open"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    detectorVersion: text("detector_version").notNull(),
  },
  (t) => [
    index("gov_flags_issuer_idx").on(t.issuerId),
    index("gov_flags_type_idx").on(t.flagType, t.severity),
    index("gov_flags_review_idx").on(t.reviewState),
  ],
);

export const regulatoryActionsRelations = relations(regulatoryActions, ({ one }) => ({
  issuer: one(issuers, { fields: [regulatoryActions.subjectIssuerId], references: [issuers.id] }),
  document: one(documents, { fields: [regulatoryActions.documentId], references: [documents.id] }),
}));
