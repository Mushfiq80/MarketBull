/**
 * Remove every sample-tagged row.
 *
 * One command, because the sample-data firewall is only credible if clearing it
 * is trivial. Run before any real backtest.
 *
 * Run: npm run db:clear:sample
 */

// Side-effect import: loads the repo-root .env before the DB client is created.
import "../../lib/load-env";

import { sql } from "drizzle-orm";

import { db } from "../client";

const TABLES_WITH_SOURCE = [
  "market_bars",
  "index_observations",
  "breadth_snapshots",
  "trading_status",
  "corporate_actions",
  "financial_facts",
  "events",
  "ownership_snapshots",
  "documents",
  "regulatory_actions",
  "instruments",
  "issuers",
];

async function main() {
  console.log("Clearing sample-tagged data…");
  let total = 0;

  // Analytics output derived from sample data goes too — it is not research.
  //
  // `used_sample_data` alone is not a reliable filter here: it is computed
  // per-factor inside the quant engine, and a factor that never touches price
  // or financial data can end up flagged false even for a 100%-sample
  // instrument. Deleting by an actual foreign key to a sample instrument is
  // exact regardless of that flag, and also catches the (rarer) case of a
  // sample row that scores true against a real, non-sample instrument.
  for (const table of ["score_snapshots", "factor_snapshots"]) {
    const result = await db.execute(
      sql.raw(
        `delete from ${table} where used_sample_data = true ` +
          `or instrument_id in (select id from instruments where source_id = 'sample')`,
      ),
    );
    const n = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n) console.log(`  ${table}: ${n}`);
    total += n;
  }

  // regime_snapshots has no instrument_id/issuer_id — it is exchange-level —
  // so the flag is the only signal available for it.
  {
    const result = await db.execute(sql`delete from regime_snapshots where used_sample_data = true`);
    const n = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n) console.log(`  regime_snapshots: ${n}`);
    total += n;
  }

  // Child rows first, then parents, so FKs do not block the delete.
  for (const table of TABLES_WITH_SOURCE) {
    const result = await db.execute(sql.raw(`delete from ${table} where source_id = 'sample'`));
    const n = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n) console.log(`  ${table}: ${n}`);
    total += n;
  }

  const snapshots = await db.execute(sql`delete from snapshots where source_id = 'sample'`);
  total += (snapshots as unknown as { rowCount?: number }).rowCount ?? 0;

  console.log(`\nRemoved ${total} sample row(s). Backtests will now run on real data only.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Clear failed:", err);
  console.error(
    "\nIf a foreign key blocked the delete, clear analytics output first, then market data.",
  );
  process.exit(1);
});
