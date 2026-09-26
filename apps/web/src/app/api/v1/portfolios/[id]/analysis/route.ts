import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { portfolioHoldings } from "@/db/queries/portfolio";
import { portfolios } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { analysePortfolio } from "@/lib/portfolio/analysis";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");

  const [portfolio] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
    .limit(1);
  if (!portfolio) return fail("NOT_FOUND", "Portfolio not found.");

  const holdings = await portfolioHoldings(id);
  const analysis = analysePortfolio(holdings as never);

  return ok(
    {
      portfolio,
      holdings,
      analysis,
      note:
        "Positions that could not be priced (suspended, stale or unavailable) are excluded from " +
        "percentages and reported separately at cost. Scenario results apply stated sector shocks — " +
        "no likelihood is attached to any of them.",
    },
    await buildMeta({ asOf: holdings[0]?.recomputedAt }),
  );
}
