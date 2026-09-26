import { and, eq, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "../client";
import { sources } from "../schema";

/**
 * The point-in-time predicate. Any query that feeds research or a backtest must
 * use this — it is what stops future information leaking into a past decision.
 *
 *   "What did BABull know at time T?"
 */
export function asOfPredicate(
  publishedAt: PgColumn,
  supersededAt: PgColumn,
  at: Date,
): SQL | undefined {
  return and(
    or(isNull(publishedAt), lte(publishedAt, at)),
    or(isNull(supersededAt), sql`${supersededAt} > ${at}`),
  );
}

/** Current rows only: nothing superseded by a restatement. */
export function currentOnly(supersededAt: PgColumn): SQL | undefined {
  return isNull(supersededAt);
}

/** Exclude sample-tagged rows. Used by anything that must be real data. */
export function realDataOnly(sourceId: PgColumn): SQL {
  return sql`${sourceId} <> 'sample'`;
}

export async function loadSourceStatuses() {
  return db
    .select({
      sourceId: sources.sourceId,
      lastSuccessAt: sources.lastSuccessAt,
      freshnessBudgetMinutes: sources.freshnessBudgetMinutes,
      lastErrorState: sources.lastErrorState,
    })
    .from(sources)
    .where(eq(sources.enabled, true));
}

/** True when any of the given rows came from the sample dataset (ADR 0007). */
export function anySample(rows: { sourceId?: string | null; quality?: string | null }[]): boolean {
  return rows.some((r) => r.sourceId === "sample" || r.quality === "sample");
}
