/**
 * Sample dataset for UI development ONLY.
 *
 * Every row is tagged `source_id = 'sample'`, which means:
 *   - the UI shows a permanent, non-dismissible amber banner,
 *   - the API sets `meta.sampleData = true`,
 *   - the backtest engine REFUSES to run (SampleDataGuard, no override),
 *   - FOX report generation refuses unless ?allow_sample=true, and watermarks it.
 *
 * See babull-docs/adr/0007-sample-data-firewall.md. This exists so the dashboard
 * can be built before licensed feeds land — not so that fake numbers can be
 * mistaken for research.
 *
 * Run: npm run db:seed:sample     Clear: npm run db:clear:sample
 */

// Side-effect import: loads the repo-root .env before the DB client is created.
import "../../lib/load-env";

import { randomUUID } from "node:crypto";

import { db } from "../client";
import {
  breadthSnapshots,
  corporateActions,
  events,
  eventEntities,
  financialFacts,
  indexObservations,
  instruments,
  issuers,
  marketBars,
  regulatoryActions,
  tradingStatus,
} from "../schema";

/** Deterministic PRNG so the sample set is reproducible run to run. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const COMPANIES = [
  // BANK, FINANCIAL INSTITUTIONS, GENERAL INSURANCE and CEMENT each carry 3
  // members — the minimum peer-group size `normalize_cross_section` requires
  // (services/quant/app/engines/factors.py) before it will rank anything.
  // Below that floor every factor stays `peer_group_too_small` by design, so
  // a sample set with one company per sector could never show a real score.
  { ticker: "SAMPBANK", name: "Sample Bank PLC", sector: "BANK", price: 34.2, shares: 1_350_000_000 },
  { ticker: "SAMPBANK2", name: "Sample Commercial Bank Ltd", sector: "BANK", price: 28.6, shares: 980_000_000 },
  { ticker: "SAMPBANK3", name: "Sample Islami Bank PLC", sector: "BANK", price: 45.9, shares: 1_620_000_000 },
  { ticker: "SAMPNBFI", name: "Sample Finance Ltd", sector: "FINANCIAL INSTITUTIONS", price: 18.7, shares: 420_000_000 },
  { ticker: "SAMPNBFI2", name: "Sample Leasing & Finance Ltd", sector: "FINANCIAL INSTITUTIONS", price: 14.2, shares: 310_000_000 },
  { ticker: "SAMPNBFI3", name: "Sample Investment Corp Ltd", sector: "FINANCIAL INSTITUTIONS", price: 22.5, shares: 560_000_000 },
  { ticker: "SAMPPHRM", name: "Sample Pharmaceuticals Ltd", sector: "PHARMACEUTICALS & CHEMICALS", price: 412.5, shares: 96_000_000 },
  { ticker: "SAMPCEM", name: "Sample Cement Industries", sector: "CEMENT", price: 78.9, shares: 210_000_000 },
  { ticker: "SAMPCEM2", name: "Sample Portland Cement Co", sector: "CEMENT", price: 64.3, shares: 175_000_000 },
  { ticker: "SAMPCEM3", name: "Sample Ready-Mix Cement Ltd", sector: "CEMENT", price: 92.7, shares: 245_000_000 },
  { ticker: "SAMPTEX", name: "Sample Textiles Ltd", sector: "TEXTILE", price: 22.4, shares: 165_000_000 },
  { ticker: "SAMPPOW", name: "Sample Power Generation", sector: "FUEL & POWER", price: 56.1, shares: 380_000_000 },
  { ticker: "SAMPINS", name: "Sample General Insurance", sector: "GENERAL INSURANCE", price: 41.8, shares: 74_000_000 },
  { ticker: "SAMPINS2", name: "Sample General Takaful Ltd", sector: "GENERAL INSURANCE", price: 33.6, shares: 58_000_000 },
  { ticker: "SAMPINS3", name: "Sample Fire & Marine Insurance Ltd", sector: "GENERAL INSURANCE", price: 52.1, shares: 91_000_000 },
  { ticker: "SAMPTEL", name: "Sample Telecom PLC", sector: "TELECOMMUNICATION", price: 298.3, shares: 1_350_000_000 },
  { ticker: "SAMPFOOD", name: "Sample Food & Allied", sector: "FOOD & ALLIED", price: 134.6, shares: 58_000_000 },
  { ticker: "SAMPENG", name: "Sample Engineering Works", sector: "ENGINEERING", price: 64.2, shares: 92_000_000 },
  { ticker: "SAMPIT", name: "Sample IT Services", sector: "IT SECTOR", price: 29.5, shares: 48_000_000 },
  // Deliberately thin and deliberately suspended, so the gates and the four
  // display states are exercised rather than assumed. Left as a 2-member
  // sector on purpose: their point is testing edge-case gates, not ranking
  // output, so a permanent "insufficient peers" state here is correct.
  { ticker: "SAMPTHIN", name: "Sample Thinly Traded Ltd", sector: "MISCELLANEOUS", price: 11.3, shares: 26_000_000, thin: true },
  { ticker: "SAMPSUSP", name: "Sample Suspended Ltd", sector: "MISCELLANEOUS", price: 7.8, shares: 31_000_000, suspended: true },
];

const SESSIONS = 520; // ~2 years of trading sessions
const SOURCE = "sample";
const PARSER = "sample-seed-1.0.0";

function tradingDates(count: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 5 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out.reverse();
}

async function main() {
  console.log("Seeding SAMPLE data (UI development only — backtests will refuse it)…\n");

  const dates = tradingDates(SESSIONS);
  const random = rng(20260925);
  const now = new Date();

  // ---------------------------------------------------------------- issuers
  const created: { issuerId: string; instrumentId: string; def: (typeof COMPANIES)[number] }[] = [];

  for (const def of COMPANIES) {
    const [issuer] = await db
      .insert(issuers)
      .values({
        name: def.name,
        sectorCode: def.sector,
        businessDescription:
          `Sample issuer generated for interface development. Not a real company. ` +
          `Sector: ${def.sector}.`,
        sourceId: SOURCE,
        retrievedAt: now,
        parserVersion: PARSER,
        quality: "sample",
      })
      .returning({ id: issuers.id });

    const [instrument] = await db
      .insert(instruments)
      .values({
        issuerId: issuer!.id,
        ticker: def.ticker,
        exchange: "DSE",
        instrumentType: "equity",
        listingStatus: def.suspended ? "suspended" : "listed",
        listingDate: "2016-03-15",
        currency: "BDT",
        faceValue: "10",
        marketLot: 1,
        sharesOutstanding: String(def.shares),
        freeFloatShares: String(Math.round(def.shares * 0.42)),
        paidUpCapital: String(def.shares * 10),
        sourceId: SOURCE,
        retrievedAt: now,
        parserVersion: PARSER,
        quality: "sample",
        isCurrent: true,
      })
      .returning({ id: instruments.id });

    created.push({ issuerId: issuer!.id, instrumentId: instrument!.id, def });
  }
  console.log(`  ${created.length} sample issuers + instruments`);

  // ------------------------------------------------------------ price series
  const indexLevels: number[] = [];
  let indexLevel = 5400;

  for (const [i, date] of dates.entries()) {
    // A shared market factor so relative strength means something, plus two
    // regime-ish stretches so the regime engine has shape to classify.
    const cycle = Math.sin((i / SESSIONS) * Math.PI * 2.2);
    const marketDrift = cycle * 0.0016 + (random() - 0.5) * 0.009;
    indexLevel *= 1 + marketDrift;
    indexLevels.push(indexLevel);

    await db.insert(indexObservations).values(
      ["DSEX", "DS30", "DSES"].map((symbol, si) => ({
        symbol,
        sessionDate: date,
        close: (indexLevel * (si === 0 ? 1 : si === 1 ? 0.37 : 0.22)).toFixed(4),
        totalTurnover: (4.5e9 * (1 + cycle * 0.4 + random() * 0.3)).toFixed(2),
        totalTrades: Math.round(140000 * (1 + random() * 0.3)),
        sourceId: SOURCE,
        publishedAt: new Date(`${date}T14:30:00Z`),
        effectiveAt: new Date(`${date}T14:30:00Z`),
        retrievedAt: now,
        parserVersion: PARSER,
        quality: "sample" as const,
      })),
    );
  }
  console.log(`  ${dates.length} sessions of index observations`);

  for (const { instrumentId, def } of created) {
    let price = def.price * 0.72;
    const beta = 0.6 + random() * 1.1;
    const idioVol = 0.008 + random() * 0.018;

    const rawBars: Record<string, unknown>[] = [];
    const adjBars: Record<string, unknown>[] = [];
    const statuses: Record<string, unknown>[] = [];

    for (const [i, date] of dates.entries()) {
      const marketReturn = i === 0 ? 0 : (indexLevels[i]! - indexLevels[i - 1]!) / indexLevels[i - 1]!;
      const ret = marketReturn * beta + (random() - 0.5) * idioVol * 2;
      const previous = price;
      price = Math.max(1, price * (1 + ret));

      // A thin name simply does not trade on most sessions — that is the point.
      const traded = def.thin ? random() > 0.72 : !def.suspended || i < SESSIONS - 60;
      const suspendedNow = Boolean(def.suspended) && i >= SESSIONS - 60;

      statuses.push({
        instrumentId,
        sessionDate: date,
        state: suspendedNow ? "suspended" : traded ? "normal" : "no_trade",
        reason: suspendedNow ? "Sample suspension for UI testing." : null,
        sourceId: SOURCE,
        retrievedAt: now,
        parserVersion: PARSER,
        quality: "sample",
      });

      if (!traded || suspendedNow) {
        // No trade: the bar records the absence rather than carrying a price forward.
        rawBars.push({
          id: randomUUID(),
          instrumentId,
          sessionDate: date,
          open: null, high: null, low: null,
          close: previous.toFixed(4),
          ltp: null,
          ycp: previous.toFixed(4),
          volume: "0",
          turnover: "0",
          tradeCount: 0,
          adjustmentBasis: "raw",
          sourceId: SOURCE,
          publishedAt: new Date(`${date}T14:30:00Z`),
          retrievedAt: now,
          parserVersion: PARSER,
          quality: "sample",
          limitBound: false,
        });
        continue;
      }

      const high = price * (1 + random() * 0.012);
      const low = price * (1 - random() * 0.012);
      const open = low + (high - low) * random();
      const baseVolume = def.thin ? 4_000 : 250_000;
      const volume = Math.round(baseVolume * (0.4 + random() * 2.2));
      const turnover = volume * price;

      const bar = {
        id: randomUUID(),
        instrumentId,
        sessionDate: date,
        open: open.toFixed(4),
        high: high.toFixed(4),
        low: low.toFixed(4),
        close: price.toFixed(4),
        ltp: price.toFixed(4),
        ycp: previous.toFixed(4),
        volume: String(volume),
        turnover: turnover.toFixed(2),
        tradeCount: Math.round(volume / 900) + 1,
        sourceId: SOURCE,
        publishedAt: new Date(`${date}T14:30:00Z`),
        retrievedAt: now,
        parserVersion: PARSER,
        quality: "sample" as const,
        limitBound: false,
      };

      rawBars.push({ ...bar, adjustmentBasis: "raw" });
      adjBars.push({
        ...bar,
        id: randomUUID(),
        adjustmentBasis: "corporate_action_adjusted",
        adjustmentFactor: "1",
      });
    }

    for (let i = 0; i < rawBars.length; i += 500) {
      await db.insert(marketBars).values(rawBars.slice(i, i + 500) as never).onConflictDoNothing();
    }
    for (let i = 0; i < adjBars.length; i += 500) {
      await db.insert(marketBars).values(adjBars.slice(i, i + 500) as never).onConflictDoNothing();
    }
    for (let i = 0; i < statuses.length; i += 500) {
      await db.insert(tradingStatus).values(statuses.slice(i, i + 500) as never).onConflictDoNothing();
    }
  }
  console.log(`  price series for ${created.length} instruments (raw + adjusted)`);

  // -------------------------------------------------------------- breadth
  for (const [i, date] of dates.entries()) {
    const cycle = Math.sin((i / SESSIONS) * Math.PI * 2.2);
    const advancing = Math.round(160 + cycle * 90 + random() * 40);
    await db
      .insert(breadthSnapshots)
      .values({
        sessionDate: date,
        exchange: "DSE",
        advancing,
        declining: Math.max(10, 380 - advancing - 25),
        unchanged: 25,
        notTraded: 30,
        pctAboveMa50: Math.min(95, Math.max(5, 50 + cycle * 32 + (random() - 0.5) * 12)).toFixed(4),
        pctAboveMa200: Math.min(95, Math.max(5, 48 + cycle * 26)).toFixed(4),
        newHighs52w: Math.max(0, Math.round(20 + cycle * 22)),
        newLows52w: Math.max(0, Math.round(20 - cycle * 18)),
        totalTurnover: (4.5e9 * (1 + cycle * 0.4)).toFixed(2),
        turnoverPercentile: Math.min(99, Math.max(1, 50 + cycle * 35)).toFixed(4),
        turnoverConcentrationTop10: (0.28 + random() * 0.22).toFixed(4),
        tradedInstrumentCount: 355,
        sourceId: SOURCE,
        retrievedAt: now,
        parserVersion: PARSER,
        quality: "sample",
      })
      .onConflictDoNothing();
  }
  console.log(`  ${dates.length} breadth snapshots`);

  // ----------------------------------------------------------- financials
  const METRICS: Record<string, number> = {
    revenue: 1,
    operating_income: 0.18,
    net_income: 0.12,
    total_assets: 3.2,
    total_equity: 1.1,
    total_debt: 0.55,
    cash_and_equivalents: 0.14,
    operating_cash_flow: 0.15,
    interest_expense: 0.03,
  };

  for (const { issuerId, def } of created) {
    const scale = def.shares * def.price * 0.35;
    for (let year = 2021; year <= 2025; year++) {
      const growth = 1 + (year - 2021) * (0.04 + random() * 0.09);
      const periodEnd = `${year}-06-30`;
      // Published months after period end — this is what makes point-in-time real.
      const publishedAt = new Date(`${year}-10-28T10:00:00Z`);

      for (const [metric, ratio] of Object.entries(METRICS)) {
        await db
          .insert(financialFacts)
          .values({
            issuerId,
            metric,
            value: (scale * ratio * growth).toFixed(4),
            unit: "BDT",
            periodType: "annual",
            periodEnd,
            fiscalYear: year,
            auditStatus: "audited",
            auditOpinion: def.thin && year === 2024 ? "emphasis_going_concern" : "unqualified",
            statement: metric.includes("cash") ? "cashflow" : metric.includes("total") ? "balance" : "income",
            sourceId: SOURCE,
            publishedAt,
            retrievedAt: now,
            parserVersion: PARSER,
            quality: "sample",
            extractionConfidence: "0.95",
          })
          .onConflictDoNothing();
      }

      const eps = (scale * 0.12 * growth) / def.shares;
      for (const [metric, value] of [
        ["eps_basic", eps],
        ["book_value_per_share", (scale * 1.1 * growth) / def.shares],
        ["dividend_per_share", eps * 0.35],
      ] as [string, number][]) {
        await db
          .insert(financialFacts)
          .values({
            issuerId,
            metric,
            value: value.toFixed(4),
            unit: "BDT",
            periodType: "annual",
            periodEnd,
            fiscalYear: year,
            auditStatus: "audited",
            statement: "income",
            sourceId: SOURCE,
            publishedAt,
            retrievedAt: now,
            parserVersion: PARSER,
            quality: "sample",
          })
          .onConflictDoNothing();
      }
    }
  }
  console.log(`  financial facts for ${created.length} issuers, 2021–2025`);

  // --------------------------------------------------------------- events
  const EVENT_SET = [
    { type: "earnings_release", title: "Annual results published", status: "confirmed_document" as const, authority: "official_filing" as const },
    { type: "dividend_declaration", title: "Board recommends cash dividend", status: "confirmed_document" as const, authority: "official_filing" as const },
    { type: "agm_notice", title: "AGM notice issued", status: "confirmed_document" as const, authority: "exchange" as const },
    { type: "director_appointment", title: "New independent director appointed", status: "confirmed_document" as const, authority: "official_filing" as const },
    { type: "price_sensitive_information", title: "Price sensitive information disclosed", status: "confirmed_document" as const, authority: "exchange" as const },
    { type: "major_contract", title: "Media report of a supply agreement", status: "attributed_report" as const, authority: "reputable_media" as const },
  ];

  for (const { issuerId, def } of created.slice(0, 8)) {
    for (const [i, e] of EVENT_SET.entries()) {
      const when = new Date(Date.now() - (30 + i * 47) * 86400_000);
      const [event] = await db
        .insert(events)
        .values({
          eventType: e.type,
          title: `${def.ticker}: ${e.title}`,
          summary: "Sample event generated for interface development. Not a real disclosure.",
          eventAt: when,
          publishedAt: when,
          sourceAuthority: e.authority,
          claimStatus: e.status,
          confidence: "0.9",
          corroborationCount: e.status === "confirmed_document" ? 2 : 0,
          dedupeKey: `sample:${def.ticker}:${e.type}:${i}`,
          sourceId: SOURCE,
          retrievedAt: now,
          parserVersion: PARSER,
          quality: "sample",
        })
        .onConflictDoNothing()
        .returning({ id: events.id });

      if (event) {
        await db.insert(eventEntities).values({
          eventId: event.id,
          entityKind: "issuer",
          issuerId,
          entityLabel: def.name,
          role: "subject",
          confidence: "1",
        });
      }
    }
  }
  console.log("  sample events + entity links");

  // ------------------------------------------------------- corporate action
  for (const { instrumentId, def } of created.slice(0, 5)) {
    await db.insert(corporateActions).values({
      instrumentId,
      actionType: "bonus_issue",
      announcementDate: "2024-10-28",
      recordDate: "2024-12-05",
      exDate: "2024-12-08",
      effectiveDate: "2024-12-08",
      ratio: "1.10",
      sourceId: SOURCE,
      retrievedAt: now,
      parserVersion: PARSER,
      quality: "sample",
      rawText: `Sample 10% bonus issue for ${def.ticker}.`,
    });
  }
  console.log("  sample corporate actions");

  // -------------------------------------------------- regulatory (statuses)
  const thin = created.find((c) => c.def.thin);
  if (thin) {
    // One of each status class, so the UI's distinction between an allegation and
    // a finding is actually exercised.
    for (const [status, severity, subject] of [
      ["allegation", "medium", "Media report of a disclosure delay — unproven"],
      ["proceeding", "high", "Show-cause notice regarding late filing"],
      ["final_finding", "high", "Penalty imposed for late submission of accounts"],
      ["reversed", "low", "Earlier order set aside on appeal"],
    ] as [string, string, string][]) {
      await db.insert(regulatoryActions).values({
        authority: "BSEC",
        actionType: "enforcement",
        status: status as "allegation",
        severity: severity as "high",
        subjectIssuerId: thin.issuerId,
        subject: `${thin.def.ticker}: ${subject} (sample)`,
        issueDate: "2025-04-15",
        sourceId: SOURCE,
        retrievedAt: now,
        parserVersion: PARSER,
        quality: "sample",
      });
    }
    console.log("  sample regulatory records (one per status class)");
  }

  console.log("\nSample data seeded.");
  console.log("The UI now shows a permanent amber banner, and backtests will raise SampleDataError.");
  console.log("Next: compute factors and scores so the rankings populate —");
  console.log(`  curl -X POST http://localhost:8000/factors/compute -H "X-BABull-Token: $QUANT_SERVICE_TOKEN" \\`);
  console.log(`    -H "Content-Type: application/json" -d '{"asOf":"${dates.at(-1)}"}'`);
  console.log("Clear it any time with: npm run db:clear:sample");
  process.exit(0);
}

main().catch((err) => {
  console.error("Sample seed failed:", err);
  process.exit(1);
});
