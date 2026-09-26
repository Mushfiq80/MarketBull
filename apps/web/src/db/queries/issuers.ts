import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../client";
import {
  corporateActions,
  derivedMetrics,
  documents,
  events,
  eventEntities,
  financialFacts,
  governanceFlags,
  instruments,
  issuers,
  ownershipSnapshots,
  people,
  regulatoryActions,
  relationshipEdges,
  scoreSnapshots,
  shariahScreens,
  foxReports,
} from "../schema";

export async function searchIssuers(q: string | undefined, sector: string | undefined, limit = 50) {
  const conditions = [eq(instruments.isCurrent, true)];
  if (sector) conditions.push(eq(issuers.sectorCode, sector));

  const base = db
    .select({
      issuerId: issuers.id,
      instrumentId: instruments.id,
      ticker: instruments.ticker,
      name: issuers.name,
      sector: issuers.sectorCode,
      listingStatus: instruments.listingStatus,
    })
    .from(issuers)
    .innerJoin(instruments, eq(instruments.issuerId, issuers.id))
    .limit(limit);

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    return base.where(
      and(...conditions, or(ilike(instruments.ticker, term), ilike(issuers.name, term))),
    );
  }
  return base.where(and(...conditions)).orderBy(instruments.ticker);
}

export async function issuerProfile(issuerId: string) {
  const [issuer] = await db.select().from(issuers).where(eq(issuers.id, issuerId)).limit(1);
  if (!issuer) return null;

  const instrumentRows = await db
    .select()
    .from(instruments)
    .where(eq(instruments.issuerId, issuerId))
    .orderBy(desc(instruments.isCurrent), desc(instruments.validFrom));

  return { issuer, instruments: instrumentRows, current: instrumentRows.find((i) => i.isCurrent) ?? null };
}

/** Resolve a ticker (including historical tickers) to the current issuer. */
export async function resolveTicker(ticker: string) {
  const [row] = await db
    .select({ issuerId: instruments.issuerId, instrumentId: instruments.id })
    .from(instruments)
    .where(and(eq(instruments.ticker, ticker.toUpperCase()), eq(instruments.isCurrent, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Reported financials, point-in-time. `asOf` defaults to now; pass a past date
 * to reconstruct what was knowable then (used by backtests and by the
 * "as published" view in the UI).
 */
export async function financials(
  issuerId: string,
  opts: { periodType?: string; asOf?: Date; limitPeriods?: number } = {},
) {
  const asOf = opts.asOf ?? new Date();
  const conditions = [
    eq(financialFacts.issuerId, issuerId),
    or(isNull(financialFacts.publishedAt), lte(financialFacts.publishedAt, asOf)),
    or(isNull(financialFacts.supersededAt), sql`${financialFacts.supersededAt} > ${asOf}`),
  ];
  if (opts.periodType) conditions.push(eq(financialFacts.periodType, opts.periodType));

  return db
    .select({
      metric: financialFacts.metric,
      value: financialFacts.value,
      unit: financialFacts.unit,
      periodType: financialFacts.periodType,
      periodEnd: financialFacts.periodEnd,
      fiscalYear: financialFacts.fiscalYear,
      auditStatus: financialFacts.auditStatus,
      auditOpinion: financialFacts.auditOpinion,
      publishedAt: financialFacts.publishedAt,
      documentId: financialFacts.documentId,
      pageRef: financialFacts.pageRef,
      quality: financialFacts.quality,
      sourceId: financialFacts.sourceId,
      isRestatement: financialFacts.isRestatement,
      extractionConfidence: financialFacts.extractionConfidence,
    })
    .from(financialFacts)
    .where(and(...conditions))
    .orderBy(desc(financialFacts.periodEnd), financialFacts.metric)
    .limit(opts.limitPeriods ? opts.limitPeriods * 60 : 1200);
}

export async function derivedFor(issuerId: string, limit = 400) {
  return db
    .select()
    .from(derivedMetrics)
    .where(eq(derivedMetrics.issuerId, issuerId))
    .orderBy(desc(derivedMetrics.periodEnd))
    .limit(limit);
}

export async function eventTimeline(
  issuerId: string,
  opts: { from?: string; to?: string; types?: string[]; limit?: number } = {},
) {
  const conditions = [eq(eventEntities.issuerId, issuerId)];
  if (opts.from) conditions.push(gte(events.eventAt, new Date(`${opts.from}T00:00:00Z`)));
  if (opts.to) conditions.push(lte(events.eventAt, new Date(`${opts.to}T23:59:59Z`)));
  if (opts.types?.length) conditions.push(inArray(events.eventType, opts.types));

  return db
    .select({
      id: events.id,
      eventType: events.eventType,
      title: events.title,
      summary: events.summary,
      eventAt: events.eventAt,
      publishedAt: events.publishedAt,
      sourceAuthority: events.sourceAuthority,
      claimStatus: events.claimStatus,
      confidence: events.confidence,
      corroborationCount: events.corroborationCount,
      documentId: events.documentId,
      externalUrl: events.externalUrl,
      abnormalReturn: events.abnormalReturn,
      role: eventEntities.role,
      sourceId: events.sourceId,
    })
    .from(events)
    .innerJoin(eventEntities, eq(eventEntities.eventId, events.id))
    .where(and(...conditions))
    .orderBy(desc(events.eventAt))
    .limit(opts.limit ?? 100);
}

export async function ownershipHistory(issuerId: string, limit = 24) {
  return db
    .select()
    .from(ownershipSnapshots)
    .where(and(eq(ownershipSnapshots.issuerId, issuerId), isNull(ownershipSnapshots.supersededAt)))
    .orderBy(desc(ownershipSnapshots.asOfDate))
    .limit(limit);
}

export async function relatedPeople(issuerId: string) {
  return db
    .select({
      edgeId: relationshipEdges.id,
      edgeType: relationshipEdges.edgeType,
      role: relationshipEdges.role,
      stakePercent: relationshipEdges.stakePercent,
      validFrom: relationshipEdges.validFrom,
      validTo: relationshipEdges.validTo,
      confidence: relationshipEdges.confidence,
      evidenceDocumentId: relationshipEdges.evidenceDocumentId,
      isBeneficialOwnershipClaim: relationshipEdges.isBeneficialOwnershipClaim,
      personId: people.id,
      personName: people.fullName,
      personIdentityConfidence: people.identityConfidence,
      personPossibleDuplicateOf: people.possibleDuplicateOf,
    })
    .from(relationshipEdges)
    .leftJoin(people, eq(people.id, relationshipEdges.fromPersonId))
    .where(eq(relationshipEdges.toIssuerId, issuerId))
    .orderBy(desc(relationshipEdges.validFrom));
}

/** Issuer-to-issuer edges: subsidiaries, associates, related parties. */
export async function relatedCompanies(issuerId: string) {
  return db
    .select({
      edgeId: relationshipEdges.id,
      edgeType: relationshipEdges.edgeType,
      fromIssuerId: relationshipEdges.fromIssuerId,
      toIssuerId: relationshipEdges.toIssuerId,
      stakePercent: relationshipEdges.stakePercent,
      validFrom: relationshipEdges.validFrom,
      confidence: relationshipEdges.confidence,
    })
    .from(relationshipEdges)
    .where(
      and(
        or(eq(relationshipEdges.fromIssuerId, issuerId), eq(relationshipEdges.toIssuerId, issuerId)),
        sql`${relationshipEdges.fromIssuerId} is not null and ${relationshipEdges.toIssuerId} is not null`,
      ),
    );
}

export async function governanceFor(issuerId: string) {
  const [actions, flags] = await Promise.all([
    db
      .select()
      .from(regulatoryActions)
      .where(eq(regulatoryActions.subjectIssuerId, issuerId))
      .orderBy(desc(regulatoryActions.issueDate)),
    db
      .select()
      .from(governanceFlags)
      .where(eq(governanceFlags.issuerId, issuerId))
      .orderBy(desc(governanceFlags.effectiveFrom)),
  ]);
  return { actions, flags };
}

export async function corporateActionsFor(issuerId: string) {
  return db
    .select({
      id: corporateActions.id,
      actionType: corporateActions.actionType,
      announcementDate: corporateActions.announcementDate,
      recordDate: corporateActions.recordDate,
      exDate: corporateActions.exDate,
      effectiveDate: corporateActions.effectiveDate,
      ratio: corporateActions.ratio,
      cashAmountPerShare: corporateActions.cashAmountPerShare,
      dividendYearEnd: corporateActions.dividendYearEnd,
      conflictsWith: corporateActions.conflictsWith,
      sourceId: corporateActions.sourceId,
      quality: corporateActions.quality,
    })
    .from(corporateActions)
    .innerJoin(instruments, eq(instruments.id, corporateActions.instrumentId))
    .where(eq(instruments.issuerId, issuerId))
    .orderBy(desc(corporateActions.exDate));
}

export async function latestScores(issuerId: string) {
  return db
    .select({
      horizon: scoreSnapshots.horizon,
      sessionDate: scoreSnapshots.sessionDate,
      asOf: scoreSnapshots.asOf,
      composite: scoreSnapshots.composite,
      fundamentalsScore: scoreSnapshots.fundamentalsScore,
      opportunityScore: scoreSnapshots.opportunityScore,
      exposureQualityScore: scoreSnapshots.exposureQualityScore,
      conviction: scoreSnapshots.conviction,
      convictionBreakdown: scoreSnapshots.convictionBreakdown,
      gateState: scoreSnapshots.gateState,
      gateTriggers: scoreSnapshots.gateTriggers,
      effectiveWeights: scoreSnapshots.effectiveWeights,
      factorValues: scoreSnapshots.factorValues,
      rank: scoreSnapshots.rank,
      universeSize: scoreSnapshots.universeSize,
      compositeDelta: scoreSnapshots.compositeDelta,
      dataCompleteness: scoreSnapshots.dataCompleteness,
      modelVersion: scoreSnapshots.modelVersion,
      usedSampleData: scoreSnapshots.usedSampleData,
      id: scoreSnapshots.id,
    })
    .from(scoreSnapshots)
    .innerJoin(instruments, eq(instruments.id, scoreSnapshots.instrumentId))
    .where(eq(instruments.issuerId, issuerId))
    .orderBy(desc(scoreSnapshots.sessionDate))
    .limit(9);
}

export async function foxReportFor(issuerId: string, horizon: string) {
  const [row] = await db
    .select()
    .from(foxReports)
    .where(and(eq(foxReports.issuerId, issuerId), eq(foxReports.horizon, horizon as "short")))
    .orderBy(desc(foxReports.asOf))
    .limit(1);
  return row ?? null;
}

export async function shariahFor(issuerId: string) {
  const [row] = await db
    .select()
    .from(shariahScreens)
    .where(eq(shariahScreens.issuerId, issuerId))
    .orderBy(desc(shariahScreens.asOf))
    .limit(1);
  return row ?? null;
}

export async function documentsFor(issuerId: string, limit = 50) {
  return db
    .select({
      id: documents.id,
      documentType: documents.documentType,
      title: documents.title,
      publishedAt: documents.publishedAt,
      periodEnd: documents.periodEnd,
      url: documents.url,
      pageCount: documents.pageCount,
      rightsStatus: documents.rightsStatus,
      extractionState: documents.extractionState,
      language: documents.language,
    })
    .from(documents)
    .where(eq(documents.issuerId, issuerId))
    .orderBy(desc(documents.publishedAt))
    .limit(limit);
}

/** Peer set for the comparison table — uses the documented peer group. */
export async function peers(issuerId: string, sessionDate: string) {
  const [issuer] = await db
    .select({ sector: issuers.sectorCode, peerGroup: issuers.peerGroup })
    .from(issuers)
    .where(eq(issuers.id, issuerId))
    .limit(1);
  if (!issuer) return [];

  const explicit = issuer.peerGroup ?? [];
  const conditions = explicit.length
    ? inArray(instruments.ticker, explicit)
    : issuer.sector
      ? eq(issuers.sectorCode, issuer.sector)
      : sql`false`;

  return db
    .select({
      issuerId: issuers.id,
      ticker: instruments.ticker,
      name: issuers.name,
      composite: scoreSnapshots.composite,
      conviction: scoreSnapshots.conviction,
      gateState: scoreSnapshots.gateState,
    })
    .from(issuers)
    .innerJoin(instruments, and(eq(instruments.issuerId, issuers.id), eq(instruments.isCurrent, true)))
    .leftJoin(
      scoreSnapshots,
      and(
        eq(scoreSnapshots.instrumentId, instruments.id),
        eq(scoreSnapshots.sessionDate, sessionDate),
        eq(scoreSnapshots.horizon, "medium"),
      ),
    )
    .where(conditions)
    .limit(25);
}
