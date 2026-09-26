import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "../client";
import { regimeForecasts, regimeSnapshots } from "../schema";

export async function currentRegime() {
  const [row] = await db
    .select()
    .from(regimeSnapshots)
    .orderBy(desc(regimeSnapshots.sessionDate))
    .limit(1);
  return row ?? null;
}

export async function regimeHistory(from: string, to: string) {
  return db
    .select({
      sessionDate: regimeSnapshots.sessionDate,
      state: regimeSnapshots.state,
      stateScore: regimeSnapshots.stateScore,
      confidence: regimeSnapshots.confidence,
      dataCompleteness: regimeSnapshots.dataCompleteness,
      cycleBenchmarkLabel: regimeSnapshots.cycleBenchmarkLabel,
      modelVersion: regimeSnapshots.modelVersion,
    })
    .from(regimeSnapshots)
    .where(and(gte(regimeSnapshots.sessionDate, from), lte(regimeSnapshots.sessionDate, to)))
    .orderBy(regimeSnapshots.sessionDate);
}

/**
 * Transition forecasts. Rows only exist once calibration passes — the route
 * turns an empty/uncalibrated result into MODEL_UNCALIBRATED rather than
 * shipping a number that has never been checked against outcomes.
 */
export async function regimeForecast(snapshotId: string, horizonSessions?: number) {
  const conditions = [eq(regimeForecasts.regimeSnapshotId, snapshotId)];
  if (horizonSessions) conditions.push(eq(regimeForecasts.horizonSessions, horizonSessions));
  return db
    .select()
    .from(regimeForecasts)
    .where(and(...conditions))
    .orderBy(regimeForecasts.horizonSessions, desc(regimeForecasts.probability));
}
