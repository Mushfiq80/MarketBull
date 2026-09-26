import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import {
  holdings,
  instruments,
  issuers,
  marketBars,
  portfolios,
  scoreSnapshots,
  transactions,
  watchlistItems,
  watchlists,
} from "../schema";

export async function listWatchlists(userId: string) {
  return db
    .select({
      id: watchlists.id,
      name: watchlists.name,
      description: watchlists.description,
      isDefault: watchlists.isDefault,
      itemCount: sql<number>`(select count(*)::int from watchlist_items wi where wi.watchlist_id = ${watchlists.id})`,
      updatedAt: watchlists.updatedAt,
    })
    .from(watchlists)
    .where(eq(watchlists.userId, userId))
    .orderBy(desc(watchlists.isDefault), watchlists.name);
}

export async function watchlistItemsWithScores(watchlistId: string, sessionDate: string) {
  return db
    .select({
      itemId: watchlistItems.id,
      instrumentId: watchlistItems.instrumentId,
      ticker: instruments.ticker,
      name: issuers.name,
      issuerId: issuers.id,
      sector: issuers.sectorCode,
      note: watchlistItems.note,
      userThesis: watchlistItems.userThesis,
      addedAt: watchlistItems.addedAt,
      scoreAtAdd: watchlistItems.scoreAtAdd,
      close: marketBars.close,
      ycp: marketBars.ycp,
      quality: marketBars.quality,
      composite: scoreSnapshots.composite,
      conviction: scoreSnapshots.conviction,
      gateState: scoreSnapshots.gateState,
      modelVersion: scoreSnapshots.modelVersion,
      scoreSnapshotId: scoreSnapshots.id,
      asOf: scoreSnapshots.asOf,
    })
    .from(watchlistItems)
    .innerJoin(instruments, eq(instruments.id, watchlistItems.instrumentId))
    .innerJoin(issuers, eq(issuers.id, instruments.issuerId))
    .leftJoin(
      marketBars,
      and(
        eq(marketBars.instrumentId, watchlistItems.instrumentId),
        eq(marketBars.sessionDate, sessionDate),
        eq(marketBars.adjustmentBasis, "raw"),
      ),
    )
    .leftJoin(
      scoreSnapshots,
      and(
        eq(scoreSnapshots.instrumentId, watchlistItems.instrumentId),
        eq(scoreSnapshots.sessionDate, sessionDate),
        eq(scoreSnapshots.horizon, "medium"),
      ),
    )
    .where(eq(watchlistItems.watchlistId, watchlistId));
}

export async function listPortfolios(userId: string) {
  return db.select().from(portfolios).where(eq(portfolios.userId, userId)).orderBy(portfolios.name);
}

export async function portfolioHoldings(portfolioId: string) {
  return db
    .select({
      holdingId: holdings.id,
      instrumentId: holdings.instrumentId,
      issuerId: issuers.id,
      ticker: instruments.ticker,
      name: issuers.name,
      sector: issuers.sectorCode,
      quantity: holdings.quantity,
      averageCost: holdings.averageCost,
      totalCost: holdings.totalCost,
      marketValue: holdings.marketValue,
      unrealizedPnl: holdings.unrealizedPnl,
      realizedPnl: holdings.realizedPnl,
      valuationState: holdings.valuationState,
      valuationNote: holdings.valuationNote,
      valuationSessionDate: holdings.valuationSessionDate,
      recomputedAt: holdings.recomputedAt,
    })
    .from(holdings)
    .innerJoin(instruments, eq(instruments.id, holdings.instrumentId))
    .innerJoin(issuers, eq(issuers.id, instruments.issuerId))
    .where(eq(holdings.portfolioId, portfolioId));
}

export async function portfolioTransactions(portfolioId: string, limit = 500) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, portfolioId))
    .orderBy(desc(transactions.tradeDate))
    .limit(limit);
}
