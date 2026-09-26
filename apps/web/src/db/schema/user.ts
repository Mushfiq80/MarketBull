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

import { MONEY, RATIO, horizonEnum, rowMeta, severityEnum } from "./_shared";
import { instruments, issuers } from "./issuers";

/* ===========================================================================
   Users. SINGLE_OPERATOR_MODE bypasses auth for local R&D; the schema is still
   multi-user so nothing needs rewriting later.
   =========================================================================== */

export const users = pgTable(
  "users",
  {
    ...rowMeta,
    email: text("email").notNull(),
    displayName: text("display_name"),
    passwordHash: text("password_hash"),
    /** operator | researcher | viewer */
    role: text("role").notNull().default("operator"),
    /** Per-user preferences: theme, default horizon, Shariah filter default. */
    preferences: jsonb("preferences").$type<Record<string, unknown>>(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/* --- watchlists ----------------------------------------------------------- */

export const watchlists = pgTable(
  "watchlists",
  {
    ...rowMeta,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("watchlists_user_idx").on(t.userId)],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    ...rowMeta,
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    note: text("note"),
    /** The user's own thesis, so a thesis-change alert has something to compare. */
    userThesis: text("user_thesis"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    /** Score at add time, so drift is visible. */
    scoreAtAdd: numeric("score_at_add", RATIO),
  },
  (t) => [uniqueIndex("watchlist_items_unique_idx").on(t.watchlistId, t.instrumentId)],
);

/* --- portfolios ----------------------------------------------------------- */

export const portfolios = pgTable(
  "portfolios",
  {
    ...rowMeta,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseCurrency: text("base_currency").notNull().default("BDT"),
    /** Cash balance, so returns can be computed on total capital. */
    cashBalance: numeric("cash_balance", MONEY).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portfolios_user_idx").on(t.userId)],
);

/** Transactions are the source of truth; holdings are derived from them. */
export const transactions = pgTable(
  "transactions",
  {
    ...rowMeta,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id").references(() => instruments.id),
    /** buy | sell | dividend | bonus | rights_subscription | split | deposit | withdrawal | fee */
    txType: text("tx_type").notNull(),
    tradeDate: date("trade_date").notNull(),
    settlementDate: date("settlement_date"),
    quantity: numeric("quantity", MONEY),
    price: numeric("price", MONEY),
    amount: numeric("amount", MONEY),
    brokerage: numeric("brokerage", MONEY),
    tax: numeric("tax", MONEY),
    otherCharges: numeric("other_charges", MONEY),
    /** Links a bonus/split row to the corporate action that caused it. */
    corporateActionId: uuid("corporate_action_id"),
    note: text("note"),
    importBatchId: uuid("import_batch_id"),
  },
  (t) => [
    index("transactions_portfolio_idx").on(t.portfolioId, t.tradeDate),
    index("transactions_instrument_idx").on(t.instrumentId),
  ],
);

/** Derived position state, recomputed from transactions + corporate actions. */
export const holdings = pgTable(
  "holdings",
  {
    ...rowMeta,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    quantity: numeric("quantity", MONEY).notNull(),
    /** Corporate-action adjusted average cost. */
    averageCost: numeric("average_cost", MONEY),
    totalCost: numeric("total_cost", MONEY),
    firstAcquiredAt: date("first_acquired_at"),
    /** Valuation as of a specific priced session — never an implied "now". */
    valuationSessionDate: date("valuation_session_date"),
    marketValue: numeric("market_value", MONEY),
    unrealizedPnl: numeric("unrealized_pnl", MONEY),
    realizedPnl: numeric("realized_pnl", MONEY),
    /** Set when the holding cannot be priced: suspended, stale or unavailable. */
    valuationState: text("valuation_state").notNull().default("available"),
    valuationNote: text("valuation_note"),
    recomputedAt: timestamp("recomputed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("holdings_unique_idx").on(t.portfolioId, t.instrumentId)],
);

/* --- alerts --------------------------------------------------------------- */

export const alertRules = pgTable(
  "alert_rules",
  {
    ...rowMeta,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** price_threshold | volume_spike | new_filing | corporate_action |
     *  governance_event | data_quality | thesis_change | gate_change |
     *  regime_transition | shariah_status_change | score_move */
    ruleType: text("rule_type").notNull(),

    /** Scope: one instrument, a watchlist, a portfolio, or market-wide. */
    instrumentId: uuid("instrument_id").references(() => instruments.id),
    watchlistId: uuid("watchlist_id").references(() => watchlists.id),
    portfolioId: uuid("portfolio_id").references(() => portfolios.id),
    isMarketWide: boolean("is_market_wide").notNull().default(false),

    /** Rule parameters, validated per ruleType by a Zod schema in lib/alerts. */
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull(),
    conditionVersion: text("condition_version").notNull().default("1"),
    horizon: horizonEnum("horizon"),

    /** Delivery + rate limiting. */
    channels: jsonb("channels").$type<string[]>().notNull(),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
    maxPerDay: integer("max_per_day").notNull().default(10),

    isEnabled: boolean("is_enabled").notNull().default(true),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  },
  (t) => [
    index("alert_rules_user_idx").on(t.userId),
    index("alert_rules_type_idx").on(t.ruleType, t.isEnabled),
  ],
);

export const alertEvents = pgTable(
  "alert_events",
  {
    ...rowMeta,
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id").references(() => instruments.id),
    issuerId: uuid("issuer_id").references(() => issuers.id),

    /** Factual message only — vocabulary is whitelisted in lib/alerts/language.ts. */
    message: text("message").notNull(),
    severity: severityEnum("severity").notNull().default("info"),
    /** What triggered it, with the evidence to inspect. */
    triggerEvidence: jsonb("trigger_evidence").$type<Record<string, unknown>>().notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>(),

    /** Idempotency: identical (rule, subject, day, condition) collapses. */
    dedupeKey: text("dedupe_key").notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    /** pending | delivered | failed | suppressed_cooldown | suppressed_ratelimit */
    deliveryState: text("delivery_state").notNull().default("pending"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryError: text("delivery_error"),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("alert_events_dedupe_idx").on(t.dedupeKey),
    index("alert_events_rule_idx").on(t.ruleId, t.triggeredAt.desc()),
    index("alert_events_state_idx").on(t.deliveryState),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  watchlists: many(watchlists),
  portfolios: many(portfolios),
  alertRules: many(alertRules),
}));

export const watchlistsRelations = relations(watchlists, ({ one, many }) => ({
  user: one(users, { fields: [watchlists.userId], references: [users.id] }),
  items: many(watchlistItems),
}));

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, { fields: [portfolios.userId], references: [users.id] }),
  holdings: many(holdings),
  transactions: many(transactions),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  portfolio: one(portfolios, { fields: [holdings.portfolioId], references: [portfolios.id] }),
  instrument: one(instruments, { fields: [holdings.instrumentId], references: [instruments.id] }),
}));

export const alertRulesRelations = relations(alertRules, ({ one, many }) => ({
  user: one(users, { fields: [alertRules.userId], references: [users.id] }),
  events: many(alertEvents),
}));
