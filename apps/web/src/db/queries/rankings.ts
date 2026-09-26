import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "../client";
import {
  instruments,
  issuers,
  marketBars,
  scoreSnapshots,
  shariahScreens,
} from "../schema";

export type RankingFilters = {
  horizon: "short" | "medium" | "long";
  sessionDate: string;
  sector?: string;
  gate?: ("eligible" | "restricted" | "review_required" | "excluded")[];
  /** Minimum median turnover in BDT over the liquidity window. */
  minTurnover?: number;
  shariah?: "pass" | "fail" | "undetermined";
  limit?: number;
  offset?: number;
  sort?: "composite" | "conviction" | "rank" | "delta";
};

export type RankingRow = {
  instrumentId: string;
  issuerId: string;
  ticker: string;
  name: string;
  sector: string | null;
  rank: number | null;
  composite: string | null;
  fundamentalsScore: string | null;
  opportunityScore: string | null;
  exposureQualityScore: string | null;
  conviction: string | null;
  gateState: string;
  gateTriggers: { gate: string; reason: string }[] | null;
  compositeDelta: string | null;
  rankDelta: number | null;
  close: string | null;
  turnover: string | null;
  dataCompleteness: string | null;
  modelVersion: string;
  asOf: Date;
  usedSampleData: boolean;
  scoreSnapshotId: string;
  shariahStatus: string | null;
};

export async function rankings(f: RankingFilters): Promise<RankingRow[]> {
  const conditions: SQL[] = [
    eq(scoreSnapshots.horizon, f.horizon),
    eq(scoreSnapshots.sessionDate, f.sessionDate),
  ];

  if (f.sector) conditions.push(eq(issuers.sectorCode, f.sector));
  if (f.gate?.length) conditions.push(inArray(scoreSnapshots.gateState, f.gate));
  if (f.minTurnover !== undefined) {
    conditions.push(sql`${marketBars.turnover} >= ${String(f.minTurnover)}`);
  }
  if (f.shariah) conditions.push(eq(shariahScreens.status, f.shariah));

  const orderBy =
    f.sort === "conviction"
      ? desc(scoreSnapshots.conviction)
      : f.sort === "rank"
        ? asc(scoreSnapshots.rank)
        : f.sort === "delta"
          ? desc(scoreSnapshots.compositeDelta)
          : desc(scoreSnapshots.composite);

  const rows = await db
    .select({
      instrumentId: scoreSnapshots.instrumentId,
      issuerId: issuers.id,
      ticker: instruments.ticker,
      name: issuers.name,
      sector: issuers.sectorCode,
      rank: scoreSnapshots.rank,
      composite: scoreSnapshots.composite,
      fundamentalsScore: scoreSnapshots.fundamentalsScore,
      opportunityScore: scoreSnapshots.opportunityScore,
      exposureQualityScore: scoreSnapshots.exposureQualityScore,
      conviction: scoreSnapshots.conviction,
      gateState: scoreSnapshots.gateState,
      gateTriggers: scoreSnapshots.gateTriggers,
      compositeDelta: scoreSnapshots.compositeDelta,
      rankDelta: scoreSnapshots.rankDelta,
      close: marketBars.close,
      turnover: marketBars.turnover,
      dataCompleteness: scoreSnapshots.dataCompleteness,
      modelVersion: scoreSnapshots.modelVersion,
      asOf: scoreSnapshots.asOf,
      usedSampleData: scoreSnapshots.usedSampleData,
      scoreSnapshotId: scoreSnapshots.id,
      shariahStatus: shariahScreens.status,
    })
    .from(scoreSnapshots)
    .innerJoin(instruments, eq(instruments.id, scoreSnapshots.instrumentId))
    .innerJoin(issuers, eq(issuers.id, instruments.issuerId))
    .leftJoin(
      marketBars,
      and(
        eq(marketBars.instrumentId, scoreSnapshots.instrumentId),
        eq(marketBars.sessionDate, scoreSnapshots.sessionDate),
        eq(marketBars.adjustmentBasis, "raw"),
      ),
    )
    .leftJoin(shariahScreens, eq(shariahScreens.issuerId, issuers.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(f.limit ?? 100)
    .offset(f.offset ?? 0);

  return rows as RankingRow[];
}

/** Most recent session that has scores for a horizon. */
export async function latestScoredSession(horizon: string): Promise<string | null> {
  const [row] = await db
    .select({ d: sql<string>`max(${scoreSnapshots.sessionDate})` })
    .from(scoreSnapshots)
    .where(eq(scoreSnapshots.horizon, horizon as "short"));
  return row?.d ?? null;
}

export async function scoreSnapshotById(id: string) {
  const [row] = await db.select().from(scoreSnapshots).where(eq(scoreSnapshots.id, id)).limit(1);
  return row ?? null;
}

/** Distinct sectors present in a ranking, for the filter control. */
export async function rankingSectors(horizon: string, sessionDate: string) {
  return db
    .selectDistinct({ sector: issuers.sectorCode })
    .from(scoreSnapshots)
    .innerJoin(instruments, eq(instruments.id, scoreSnapshots.instrumentId))
    .innerJoin(issuers, eq(issuers.id, instruments.issuerId))
    .where(
      and(
        eq(scoreSnapshots.horizon, horizon as "short"),
        eq(scoreSnapshots.sessionDate, sessionDate),
      ),
    )
    .orderBy(issuers.sectorCode);
}
