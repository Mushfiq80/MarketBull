/**
 * Reference seed: source register, sectors, market calendar, operator user.
 *
 * Contains NO market data. Every source starts `never_run` with its rights
 * block filled in, so "may we display or redistribute this?" is a query from
 * day one rather than an audit later.
 *
 * Run: npm run db:seed:reference
 */

// Side-effect import: loads the repo-root .env before the DB client is created.
import "../../lib/load-env";

import { db } from "../client";
import { marketCalendar, sectors, sources, users, watchlists, portfolios } from "../schema";
import type { SourceRights } from "../schema/sources";

const NO_REDISTRIBUTION: SourceRights = {
  internalUse: true,
  derivedData: true,
  userDisplay: true,
  redistribution: false,
  retention: true,
  training: false,
  fullText: false,
  territory: "BD",
  licenseRef: null,
  expiresAt: null,
};

const SOURCES = [
  {
    sourceId: "dse_eod",
    providerName: "Dhaka Stock Exchange",
    officialUrl: "https://www.dse.com.bd/day_end_archive.php",
    sourceType: "web_publication" as const,
    description:
      "Day-end archive — historical daily OHLCV, turnover and volume. HTML page, not a documented API.",
    granularity: "daily",
    freshnessBudgetMinutes: 20 * 60,
    refreshSchedule: "after each trading session close",
    knownGaps: [
      "No published API specification, rate limits or uptime guarantee.",
      "Markup can change without notice — parser matches on header text, not position.",
    ],
    rights: NO_REDISTRIBUTION,
  },
  {
    sourceId: "dse_latest",
    providerName: "Dhaka Stock Exchange",
    officialUrl: "https://www.dse.com.bd/latest_share_price_scroll_l.php",
    sourceType: "web_publication" as const,
    description: "Latest share price page. A DELAYED snapshot, not a real-time feed.",
    granularity: "intraday_delayed",
    freshnessBudgetMinutes: 30,
    refreshSchedule: "every 15 minutes during session",
    knownGaps: ["Delay is unspecified — treat every value as dated and label it as such."],
    rights: NO_REDISTRIBUTION,
  },
  {
    sourceId: "dse_company",
    providerName: "Dhaka Stock Exchange",
    officialUrl: "https://www.dse.com.bd/companylistbyindustry.php",
    sourceType: "web_publication" as const,
    description: "Company listing by industry — instrument master and sector grouping.",
    granularity: "static",
    freshnessBudgetMinutes: 7 * 24 * 60,
    refreshSchedule: "weekly",
    rights: NO_REDISTRIBUTION,
  },
  {
    sourceId: "dse_index",
    providerName: "Dhaka Stock Exchange",
    officialUrl: "https://www.dse.com.bd/",
    sourceType: "web_publication" as const,
    description: "DSEX / DS30 / DSES index levels.",
    granularity: "daily",
    freshnessBudgetMinutes: 20 * 60,
    rights: NO_REDISTRIBUTION,
  },
  {
    sourceId: "bsec",
    providerName: "Bangladesh Securities and Exchange Commission",
    officialUrl: "https://sec.gov.bd/enforcement-actions",
    sourceType: "web_publication" as const,
    description: "Enforcement actions, rules and circulars.",
    granularity: "event",
    freshnessBudgetMinutes: 24 * 60,
    knownGaps: ["Status must be classified conservatively — unrecognised wording becomes 'allegation'."],
    rights: { ...NO_REDISTRIBUTION, fullText: true },
  },
  {
    sourceId: "bb_macro",
    providerName: "Bangladesh Bank",
    officialUrl: "https://www.bb.org.bd/en/index.php/econdata/index",
    sourceType: "file_download" as const,
    description: "Economic data — policy rates, money supply, FX, reserves, remittance.",
    granularity: "monthly",
    freshnessBudgetMinutes: 40 * 24 * 60,
    knownGaps: [
      "Revisions are common — a revised value becomes a new vintage, never an overwrite.",
      "Per-dataset reuse terms still require confirmation.",
    ],
    rights: NO_REDISTRIBUTION,
  },
  {
    sourceId: "bbs",
    providerName: "Bangladesh Bureau of Statistics",
    officialUrl: "https://bbs.gov.bd/",
    sourceType: "file_download" as const,
    description: "GDP, CPI, wage rate index, PPI, industrial production.",
    granularity: "periodic",
    freshnessBudgetMinutes: 45 * 24 * 60,
    knownGaps: [
      "Provisional / final / revised status matters.",
      "Rebased indices must never be spliced without an explicit conversion factor.",
    ],
    rights: NO_REDISTRIBUTION,
  },
  {
    sourceId: "sample",
    providerName: "BABull (synthetic)",
    officialUrl: null,
    sourceType: "synthetic" as const,
    description:
      "Sample dataset for UI development ONLY. Banner-marked in the UI and hard-rejected by the " +
      "backtest engine. See ADR 0007.",
    granularity: "daily",
    freshnessBudgetMinutes: 60,
    rights: {
      internalUse: true,
      derivedData: false,
      userDisplay: true,
      redistribution: false,
      retention: true,
      training: false,
      fullText: false,
      territory: null,
      licenseRef: null,
      expiresAt: null,
    } satisfies SourceRights,
  },
];

const DSE_SECTORS: { code: string; template: string }[] = [
  { code: "BANK", template: "bank" },
  { code: "FINANCIAL INSTITUTIONS", template: "nbfi" },
  { code: "INSURANCE", template: "insurance" },
  { code: "LIFE INSURANCE", template: "insurance" },
  { code: "GENERAL INSURANCE", template: "insurance" },
  { code: "PHARMACEUTICALS & CHEMICALS", template: "industrial" },
  { code: "ENGINEERING", template: "industrial" },
  { code: "TEXTILE", template: "industrial" },
  { code: "CEMENT", template: "industrial" },
  { code: "FOOD & ALLIED", template: "industrial" },
  { code: "FUEL & POWER", template: "industrial" },
  { code: "CERAMICS", template: "industrial" },
  { code: "TANNERY", template: "industrial" },
  { code: "JUTE", template: "industrial" },
  { code: "PAPER & PRINTING", template: "industrial" },
  { code: "IT SECTOR", template: "general" },
  { code: "TELECOMMUNICATION", template: "general" },
  { code: "SERVICES & REAL ESTATE", template: "general" },
  { code: "TRAVEL & LEISURE", template: "general" },
  { code: "MISCELLANEOUS", template: "general" },
  { code: "MUTUAL FUNDS", template: "general" },
  { code: "CORPORATE BOND", template: "general" },
];

/** DSE trades Sunday–Thursday. Fridays and Saturdays are the weekend. */
function isWeekend(d: Date): boolean {
  const day = d.getUTCDay(); // 0 Sun … 5 Fri, 6 Sat
  return day === 5 || day === 6;
}

async function main() {
  console.log("Seeding reference data…");

  // --- sources ---
  for (const s of SOURCES) {
    await db
      .insert(sources)
      .values({
        sourceId: s.sourceId,
        providerName: s.providerName,
        officialUrl: s.officialUrl,
        sourceType: s.sourceType,
        description: s.description,
        granularity: s.granularity,
        freshnessBudgetMinutes: s.freshnessBudgetMinutes,
        refreshSchedule: s.refreshSchedule ?? null,
        knownGaps: s.knownGaps ?? null,
        rights: s.rights,
        timezone: "Asia/Dhaka",
        enabled: s.sourceId !== "sample",
      })
      .onConflictDoUpdate({
        target: sources.sourceId,
        set: { description: s.description, rights: s.rights, updatedAt: new Date() },
      });
  }
  console.log(`  ${SOURCES.length} sources registered`);

  // --- sectors ---
  for (const s of DSE_SECTORS) {
    await db
      .insert(sectors)
      .values({
        code: s.code,
        name: s.code
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        scorecardTemplate: s.template,
        validFrom: "2010-01-01",
      })
      .onConflictDoNothing();
  }
  console.log(`  ${DSE_SECTORS.length} sectors`);

  // --- market calendar: weekday skeleton for the backfill range ---
  // Real holidays must be ingested; a missing holiday is a data gap, not a
  // licence to assume the market was open.
  const start = new Date(Date.UTC(2015, 0, 1));
  const end = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1));
  const rows: { exchange: string; sessionDate: string; isTradingDay: boolean; sessionType: string; sourceId: string }[] = [];
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    rows.push({
      exchange: "DSE",
      sessionDate: d.toISOString().slice(0, 10),
      isTradingDay: !isWeekend(d),
      sessionType: isWeekend(d) ? "closed" : "normal",
      sourceId: "dse_company",
    });
  }
  for (let i = 0; i < rows.length; i += 1000) {
    await db.insert(marketCalendar).values(rows.slice(i, i + 1000)).onConflictDoNothing();
  }
  console.log(`  ${rows.length} calendar days (weekday skeleton — ingest real holidays)`);

  // --- operator user + default containers ---
  const [user] = await db
    .insert(users)
    .values({
      email: "operator@babull.local",
      displayName: "Operator",
      role: "operator",
      preferences: { theme: "dark", defaultHorizon: "medium" },
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (user) {
    await db.insert(watchlists).values({
      userId: user.id,
      name: "Default",
      description: "Starter watchlist.",
      isDefault: true,
    });
    await db.insert(portfolios).values({ userId: user.id, name: "Main", cashBalance: "0" });
    console.log("  operator user + default watchlist and portfolio");
  } else {
    console.log("  operator user already exists");
  }

  console.log("\nDone. Next: verify a DSE adapter before ingesting —");
  console.log("  curl -X POST http://localhost:8000/ingest/dse_eod/verify \\");
  console.log('    -H "X-BABull-Token: $QUANT_SERVICE_TOKEN" -H "Content-Type: application/json" \\');
  console.log('    -d \'{"from":"2026-09-01","to":"2026-09-24"}\'');
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
