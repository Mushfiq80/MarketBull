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
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  MONEY,
  RATIO,
  adjustmentBasisEnum,
  provenance,
  rowMeta,
  tradingStateEnum,
} from "./_shared";
import { instruments } from "./issuers";

/* ===========================================================================
   Market calendar. Never assume calendar-day frequency — DSE closes for
   weekends (Fri/Sat), public holidays and occasional special sessions.
   =========================================================================== */

export const marketCalendar = pgTable(
  "market_calendar",
  {
    ...rowMeta,
    exchange: text("exchange").notNull().default("DSE"),
    sessionDate: date("session_date").notNull(),
    isTradingDay: boolean("is_trading_day").notNull(),
    /** normal | half_day | special | holiday | closed */
    sessionType: text("session_type").notNull().default("normal"),
    openTime: time("open_time"),
    closeTime: time("close_time"),
    timezone: text("timezone").notNull().default("Asia/Dhaka"),
    holidayName: text("holiday_name"),
    sourceId: text("source_id").notNull(),
  },
  (t) => [
    uniqueIndex("market_calendar_exchange_date_idx").on(t.exchange, t.sessionDate),
    index("market_calendar_trading_idx").on(t.isTradingDay, t.sessionDate),
  ],
);

/* ===========================================================================
   Daily bars. `adjustmentBasis` keeps raw and adjusted series in one table but
   never conflated — a factor that spans a corporate action must request
   adjusted, and a displayed "as reported" price must request raw.
   =========================================================================== */

export const marketBars = pgTable(
  "market_bars",
  {
    ...rowMeta,
    ...provenance,
    version: integer("version").notNull().default(1),

    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    sessionDate: date("session_date").notNull(),

    open: numeric("open", MONEY),
    high: numeric("high", MONEY),
    low: numeric("low", MONEY),
    close: numeric("close", MONEY),
    /** Last traded price — may differ from close on DSE. */
    ltp: numeric("ltp", MONEY),
    /** Yesterday's closing price as published by the source. */
    ycp: numeric("ycp", MONEY),

    volume: numeric("volume", MONEY),
    /** Turnover in BDT. Source often publishes millions — adapters normalise. */
    turnover: numeric("turnover", MONEY),
    tradeCount: integer("trade_count"),

    adjustmentBasis: adjustmentBasisEnum("adjustment_basis").notNull().default("raw"),
    /** Cumulative factor applied to derive this row from the raw series. */
    adjustmentFactor: numeric("adjustment_factor", RATIO),

    /** True when the session closed at the circuit limit — excluded from
     *  momentum, trend and breakout features. */
    limitBound: boolean("limit_bound").notNull().default(false),
  },
  (t) => [
    uniqueIndex("market_bars_unique_idx").on(
      t.instrumentId,
      t.sessionDate,
      t.adjustmentBasis,
      t.sourceId,
      t.version,
    ),
    index("market_bars_instrument_date_idx").on(t.instrumentId, t.sessionDate.desc()),
    index("market_bars_date_ok_idx").on(t.sessionDate).where(sql`quality = 'ok'`),
    index("market_bars_published_idx").on(t.publishedAt),
  ],
);

/* ===========================================================================
   Index observations — DSEX is the primary regime anchor; DS30 and DSES are
   supplementary checks.
   =========================================================================== */

export const indexObservations = pgTable(
  "index_observations",
  {
    ...rowMeta,
    ...provenance,
    version: integer("version").notNull().default(1),

    symbol: text("symbol").notNull(), // DSEX | DS30 | DSES | sector indices
    sessionDate: date("session_date").notNull(),
    open: numeric("open", MONEY),
    high: numeric("high", MONEY),
    low: numeric("low", MONEY),
    close: numeric("close", MONEY).notNull(),
    /** Whole-market turnover for the session, where the source publishes it. */
    totalTurnover: numeric("total_turnover", MONEY),
    totalVolume: numeric("total_volume", MONEY),
    totalTrades: integer("total_trades"),
    /** Methodology effective date — index rules change. */
    methodologyVersion: text("methodology_version"),
  },
  (t) => [
    uniqueIndex("index_obs_unique_idx").on(t.symbol, t.sessionDate, t.sourceId, t.version),
    index("index_obs_symbol_date_idx").on(t.symbol, t.sessionDate.desc()),
  ],
);

/* ===========================================================================
   Trading status per instrument per session. This is what stops a suspended
   name's last price being presented as a live quote.
   =========================================================================== */

export const tradingStatus = pgTable(
  "trading_status",
  {
    ...rowMeta,
    ...provenance,

    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    sessionDate: date("session_date").notNull(),
    state: tradingStateEnum("state").notNull(),
    reason: text("reason"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("trading_status_unique_idx").on(t.instrumentId, t.sessionDate, t.sourceId),
    index("trading_status_state_idx").on(t.state, t.sessionDate),
  ],
);

/* ===========================================================================
   Corporate actions. The ledger that makes per-share values and historical
   prices comparable. Raw events are preserved even when sources conflict.
   =========================================================================== */

export const corporateActions = pgTable(
  "corporate_actions",
  {
    ...rowMeta,
    ...provenance,
    version: integer("version").notNull().default(1),

    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    /** cash_dividend | bonus_issue | rights_issue | split | reverse_split |
     *  merger | demerger | capital_reduction | name_change | ticker_change */
    actionType: text("action_type").notNull(),

    announcementDate: date("announcement_date"),
    recordDate: date("record_date"),
    exDate: date("ex_date"),
    effectiveDate: date("effective_date"),
    agmDate: date("agm_date"),

    /** e.g. 1.15 for a 15% bonus; 2.0 for a 2:1 split. */
    ratio: numeric("ratio", RATIO),
    cashAmountPerShare: numeric("cash_amount_per_share", MONEY),
    /** For rights: subscription price and entitlement ratio. */
    subscriptionPrice: numeric("subscription_price", MONEY),
    dividendYearEnd: date("dividend_year_end"),

    /** How the price series was adjusted for this event. */
    adjustmentMethod: text("adjustment_method"),
    /** Set when two sources disagree; blocks silent auto-adjustment. */
    conflictsWith: uuid("conflicts_with"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    rawText: text("raw_text"),
  },
  (t) => [
    index("corporate_actions_instrument_idx").on(t.instrumentId, t.exDate.desc()),
    index("corporate_actions_type_idx").on(t.actionType),
    index("corporate_actions_effective_idx").on(t.effectiveDate),
  ],
);

/* ===========================================================================
   Precomputed market-wide breadth, so the dashboard reads one row rather than
   aggregating the whole universe on every request.
   =========================================================================== */

export const breadthSnapshots = pgTable(
  "breadth_snapshots",
  {
    ...rowMeta,
    ...provenance,

    sessionDate: date("session_date").notNull(),
    exchange: text("exchange").notNull().default("DSE"),

    advancing: integer("advancing"),
    declining: integer("declining"),
    unchanged: integer("unchanged"),
    notTraded: integer("not_traded"),

    pctAboveMa50: numeric("pct_above_ma50", RATIO),
    pctAboveMa200: numeric("pct_above_ma200", RATIO),
    newHighs52w: integer("new_highs_52w"),
    newLows52w: integer("new_lows_52w"),

    totalTurnover: numeric("total_turnover", MONEY),
    /** Turnover percentile within a trailing window — regime liquidity input. */
    turnoverPercentile: numeric("turnover_percentile", RATIO),
    /** Share of turnover taken by the top 10 names — narrow rally detector. */
    turnoverConcentrationTop10: numeric("turnover_concentration_top10", RATIO),
    tradedInstrumentCount: integer("traded_instrument_count"),

    sectorParticipation: jsonb("sector_participation").$type<Record<string, number>>(),
  },
  (t) => [uniqueIndex("breadth_unique_idx").on(t.exchange, t.sessionDate)],
);

export const marketBarsRelations = relations(marketBars, ({ one }) => ({
  instrument: one(instruments, {
    fields: [marketBars.instrumentId],
    references: [instruments.id],
  }),
}));

export const corporateActionsRelations = relations(corporateActions, ({ one }) => ({
  instrument: one(instruments, {
    fields: [corporateActions.instrumentId],
    references: [instruments.id],
  }),
}));
