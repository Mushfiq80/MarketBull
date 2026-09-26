import { and, count, desc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { dataQualityIssues, driftObservations, ingestionRuns, modelVersions, sources } from "../schema";

export async function sourceHealth() {
  return db
    .select({
      sourceId: sources.sourceId,
      providerName: sources.providerName,
      sourceType: sources.sourceType,
      enabled: sources.enabled,
      lastSuccessAt: sources.lastSuccessAt,
      lastAttemptAt: sources.lastAttemptAt,
      lastErrorState: sources.lastErrorState,
      freshnessBudgetMinutes: sources.freshnessBudgetMinutes,
      parserVersion: sources.parserVersion,
      rights: sources.rights,
    })
    .from(sources)
    .orderBy(sources.sourceId);
}

export async function recentRuns(limit = 50) {
  return db
    .select()
    .from(ingestionRuns)
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(limit);
}

export async function openIssues(opts: { severity?: string; state?: string; limit?: number } = {}) {
  const conditions = [];
  if (opts.severity) conditions.push(eq(dataQualityIssues.severity, opts.severity as "high"));
  conditions.push(eq(dataQualityIssues.state, opts.state ?? "open"));

  return db
    .select()
    .from(dataQualityIssues)
    .where(and(...conditions))
    .orderBy(desc(dataQualityIssues.detectedAt))
    .limit(opts.limit ?? 100);
}

export async function issueCounts() {
  return db
    .select({
      severity: dataQualityIssues.severity,
      state: dataQualityIssues.state,
      n: count(),
    })
    .from(dataQualityIssues)
    .groupBy(dataQualityIssues.severity, dataQualityIssues.state);
}

export async function modelRegistry() {
  return db.select().from(modelVersions).orderBy(modelVersions.family, desc(modelVersions.createdAt));
}

export async function recentDrift(limit = 100) {
  return db
    .select()
    .from(driftObservations)
    .orderBy(desc(driftObservations.sessionDate))
    .limit(limit);
}

/** Does the database currently hold any sample-tagged rows? Drives the banner. */
export async function sampleDataPresent(): Promise<boolean> {
  const result = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1 from market_bars where source_id = 'sample' limit 1
    ) as present
  `);
  const rows = (result as unknown as { rows?: { present: boolean }[] }).rows ?? (result as unknown as { present: boolean }[]);
  return Boolean(rows?.[0]?.present);
}
