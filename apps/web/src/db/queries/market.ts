import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "../client";
import {
  breadthSnapshots,
  indexObservations,
  instruments,
  issuers,
  marketBars,
  tradingStatus,
  unusualActivity,
} from "../schema";

const INDEX_SYMBOLS = ["DSEX", "DS30", "DSES"] as const;

/** Latest session that actually has priced data — never assume "today". */
export async function latestSessionDate(): Promise<string | null> {
  const [row] = await db
    .select({ d: sql<string>`max(${indexObservations.sessionDate})` })
    .from(indexObservations);
  if (row?.d) return row.d;
  const [bar] = await db.select({ d: sql<string>`max(${marketBars.sessionDate})` }).from(marketBars);
  return bar?.d ?? null;
}

export async function indexCards(sessionDate: string) {
  const rows = await db
    .select({
      symbol: indexObservations.symbol,
      sessionDate: indexObservations.sessionDate,
      close: indexObservations.close,
      totalTurnover: indexObservations.totalTurnover,
      totalTrades: indexObservations.totalTrades,
      quality: indexObservations.quality,
      sourceId: indexObservations.sourceId,
      retrievedAt: indexObservations.retrievedAt,
    })
    .from(indexObservations)
    .where(
      and(
        inArray(indexObservations.symbol, [...INDEX_SYMBOLS]),
        lte(indexObservations.sessionDate, sessionDate),
      ),
    )
    .orderBy(desc(indexObservations.sessionDate))
    .limit(3 * 40);

  // Collapse to the latest two observations per symbol so a change can be shown.
  const bySymbol = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = bySymbol.get(r.symbol) ?? [];
    if (list.length < 2) list.push(r);
    bySymbol.set(r.symbol, list);
  }

  return INDEX_SYMBOLS.map((symbol) => {
    const [current, previous] = bySymbol.get(symbol) ?? [];
    const close = current?.close ? Number(current.close) : null;
    const prev = previous?.close ? Number(previous.close) : null;
    const changePct = close !== null && prev !== null && prev !== 0 ? ((close - prev) / prev) * 100 : null;
    return {
      symbol,
      sessionDate: current?.sessionDate ?? null,
      close: current?.close ?? null,
      previousClose: previous?.close ?? null,
      changePct: changePct === null ? null : changePct.toFixed(4),
      totalTurnover: current?.totalTurnover ?? null,
      totalTrades: current?.totalTrades ?? null,
      quality: current?.quality ?? "unavailable",
      sourceId: current?.sourceId ?? null,
      retrievedAt: current?.retrievedAt ?? null,
    };
  });
}

export async function indexHistory(symbol: string, from: string, to: string) {
  return db
    .select({
      sessionDate: indexObservations.sessionDate,
      close: indexObservations.close,
      totalTurnover: indexObservations.totalTurnover,
      quality: indexObservations.quality,
    })
    .from(indexObservations)
    .where(
      and(
        eq(indexObservations.symbol, symbol),
        gte(indexObservations.sessionDate, from),
        lte(indexObservations.sessionDate, to),
      ),
    )
    .orderBy(indexObservations.sessionDate);
}

export async function breadthFor(sessionDate: string) {
  const [row] = await db
    .select()
    .from(breadthSnapshots)
    .where(lte(breadthSnapshots.sessionDate, sessionDate))
    .orderBy(desc(breadthSnapshots.sessionDate))
    .limit(1);
  return row ?? null;
}

export type MoverKind = "gainers" | "losers" | "active" | "unusual";

export async function movers(sessionDate: string, kind: MoverKind, limit = 10) {
  if (kind === "unusual") {
    const rows = await db
      .select({
        instrumentId: unusualActivity.instrumentId,
        ticker: instruments.ticker,
        name: issuers.name,
        kind: unusualActivity.kind,
        magnitude: unusualActivity.magnitude,
        observation: unusualActivity.observation,
        baselineDescription: unusualActivity.baselineDescription,
        hasDisclosure: sql<boolean>`${unusualActivity.correspondingDisclosureId} is not null`,
      })
      .from(unusualActivity)
      .innerJoin(instruments, eq(instruments.id, unusualActivity.instrumentId))
      .innerJoin(issuers, eq(issuers.id, instruments.issuerId))
      .where(eq(unusualActivity.sessionDate, sessionDate))
      .orderBy(desc(unusualActivity.magnitude))
      .limit(limit);
    return rows;
  }

  // Percentage change is computed from close vs ycp, both as stored decimals.
  const changeExpr = sql<string>`
    case when ${marketBars.ycp} is null or ${marketBars.ycp} = 0 then null
         else round(((${marketBars.close} - ${marketBars.ycp}) / ${marketBars.ycp}) * 100, 4)
    end`;

  const base = db
    .select({
      instrumentId: marketBars.instrumentId,
      ticker: instruments.ticker,
      name: issuers.name,
      close: marketBars.close,
      ycp: marketBars.ycp,
      changePct: changeExpr,
      turnover: marketBars.turnover,
      volume: marketBars.volume,
      limitBound: marketBars.limitBound,
      quality: marketBars.quality,
      sourceId: marketBars.sourceId,
      tradingState: tradingStatus.state,
    })
    .from(marketBars)
    .innerJoin(instruments, eq(instruments.id, marketBars.instrumentId))
    .innerJoin(issuers, eq(issuers.id, instruments.issuerId))
    .leftJoin(
      tradingStatus,
      and(
        eq(tradingStatus.instrumentId, marketBars.instrumentId),
        eq(tradingStatus.sessionDate, marketBars.sessionDate),
      ),
    )
    .where(
      and(
        eq(marketBars.sessionDate, sessionDate),
        eq(marketBars.adjustmentBasis, "raw"),
        sql`${marketBars.quality} <> 'unavailable'`,
      ),
    )
    .limit(limit);

  if (kind === "gainers") return base.orderBy(sql`${changeExpr} desc nulls last`);
  if (kind === "losers") return base.orderBy(sql`${changeExpr} asc nulls last`);
  return base.orderBy(desc(marketBars.turnover));
}

export async function sectorPulse(sessionDate: string) {
  return db
    .select({
      sector: issuers.sectorCode,
      instrumentCount: sql<number>`count(*)::int`,
      medianChangePct: sql<string>`
        percentile_cont(0.5) within group (
          order by case when ${marketBars.ycp} is null or ${marketBars.ycp} = 0 then null
                        else ((${marketBars.close} - ${marketBars.ycp}) / ${marketBars.ycp}) * 100 end
        )::text`,
      totalTurnover: sql<string>`sum(${marketBars.turnover})::text`,
    })
    .from(marketBars)
    .innerJoin(instruments, eq(instruments.id, marketBars.instrumentId))
    .innerJoin(issuers, eq(issuers.id, instruments.issuerId))
    .where(and(eq(marketBars.sessionDate, sessionDate), eq(marketBars.adjustmentBasis, "raw")))
    .groupBy(issuers.sectorCode)
    .orderBy(sql`sum(${marketBars.turnover}) desc nulls last`);
}

export async function priceSeries(
  instrumentId: string,
  from: string,
  to: string,
  adjusted = true,
) {
  return db
    .select({
      sessionDate: marketBars.sessionDate,
      open: marketBars.open,
      high: marketBars.high,
      low: marketBars.low,
      close: marketBars.close,
      volume: marketBars.volume,
      turnover: marketBars.turnover,
      limitBound: marketBars.limitBound,
      quality: marketBars.quality,
      sourceId: marketBars.sourceId,
    })
    .from(marketBars)
    .where(
      and(
        eq(marketBars.instrumentId, instrumentId),
        eq(marketBars.adjustmentBasis, adjusted ? "corporate_action_adjusted" : "raw"),
        gte(marketBars.sessionDate, from),
        lte(marketBars.sessionDate, to),
      ),
    )
    .orderBy(marketBars.sessionDate);
}
