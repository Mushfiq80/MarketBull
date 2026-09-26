import { relations, sql } from "drizzle-orm";
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

/* ===========================================================================
   Identity. `issuerId` is the stable key for a company; `instrumentId` for a
   tradable line. Never key anything on ticker — tickers change, get reused,
   and are reassigned after delisting.
   =========================================================================== */

/** Effective-dated sector classification. A company's sector today is not
 *  necessarily its sector in 2019, and a backtest must use the historical one. */
export const sectors = pgTable(
  "sectors",
  {
    ...rowMeta,
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Scorecard template: bank | nbfi | insurance | industrial | holding | general */
    scorecardTemplate: text("scorecard_template").notNull().default("general"),
    parentCode: text("parent_code"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
  },
  (t) => [uniqueIndex("sectors_code_from_idx").on(t.code, t.validFrom)],
);

export const issuers = pgTable(
  "issuers",
  {
    ...rowMeta,
    ...provenance,
    version: integer("version").notNull().default(1),

    name: text("name").notNull(),
    shortName: text("short_name"),
    nameBn: text("name_bn"),
    /** Registrar of Joint Stock Companies registration, when known. */
    rjscNumber: text("rjsc_number"),
    incorporationDate: date("incorporation_date"),
    sectorCode: text("sector_code"),
    /** Freeform business description, sourced from filings. */
    businessDescription: text("business_description"),
    segments: jsonb("segments").$type<{ name: string; share?: string; note?: string }[]>(),
    revenueDrivers: jsonb("revenue_drivers").$type<string[]>(),
    geography: jsonb("geography").$type<string[]>(),
    website: text("website"),
    registeredAddress: text("registered_address"),
    /** Peer group is documented, not inferred — see methodology §3.5. */
    peerGroup: jsonb("peer_group").$type<string[]>(),
    peerGroupRationale: text("peer_group_rationale"),
  },
  (t) => [
    index("issuers_name_idx").on(t.name),
    index("issuers_sector_idx").on(t.sectorCode),
  ],
);

export const instruments = pgTable(
  "instruments",
  {
    ...rowMeta,
    ...provenance,
    version: integer("version").notNull().default(1),

    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => issuers.id),
    ticker: text("ticker").notNull(),
    isin: text("isin"),
    exchange: text("exchange").notNull().default("DSE"),
    /** equity | mutual_fund | bond | debenture | corporate_bond */
    instrumentType: text("instrument_type").notNull().default("equity"),
    /** listed | suspended | delisted | pre_listing */
    listingStatus: text("listing_status").notNull().default("listed"),
    listingDate: date("listing_date"),
    delistingDate: date("delisting_date"),

    currency: text("currency").notNull().default("BDT"),
    faceValue: numeric("face_value", MONEY),
    marketLot: integer("market_lot"),
    tickSize: numeric("tick_size", MONEY),

    sharesOutstanding: numeric("shares_outstanding", MONEY),
    freeFloatShares: numeric("free_float_shares", MONEY),
    paidUpCapital: numeric("paid_up_capital", MONEY),
    authorizedCapital: numeric("authorized_capital", MONEY),

    /** Index memberships with effective dates, e.g. DS30 / DSES constituency. */
    indexMemberships: jsonb("index_memberships").$type<
      { index: string; from: string; to: string | null }[]
    >(),

    /** Validity window of this identity record, so ticker changes are queryable. */
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),
  },
  (t) => [
    index("instruments_ticker_idx").on(t.ticker),
    index("instruments_issuer_idx").on(t.issuerId),
    // One current identity row per (exchange, ticker); history rows are exempt.
    uniqueIndex("instruments_ticker_current_idx")
      .on(t.exchange, t.ticker)
      .where(sql`is_current = true`),
    index("instruments_status_idx").on(t.listingStatus),
  ],
);

/** Historical tickers and names, so an old document still resolves. */
export const instrumentAliases = pgTable(
  "instrument_aliases",
  {
    ...rowMeta,
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    /** ticker | name | isin */
    aliasType: text("alias_type").notNull(),
    aliasValue: text("alias_value").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    sourceId: text("source_id").notNull(),
    evidenceDocumentId: uuid("evidence_document_id"),
  },
  (t) => [
    index("instrument_aliases_value_idx").on(t.aliasValue),
    index("instrument_aliases_instrument_idx").on(t.instrumentId),
  ],
);

export const issuersRelations = relations(issuers, ({ many }) => ({
  instruments: many(instruments),
}));

export const instrumentsRelations = relations(instruments, ({ one, many }) => ({
  issuer: one(issuers, { fields: [instruments.issuerId], references: [issuers.id] }),
  aliases: many(instrumentAliases),
}));

export const instrumentAliasesRelations = relations(instrumentAliases, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentAliases.instrumentId],
    references: [instruments.id],
  }),
}));
