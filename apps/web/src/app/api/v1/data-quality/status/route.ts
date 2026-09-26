import { issueCounts, recentRuns, sourceHealth } from "@/db/queries/quality";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const [sources, runs, counts] = await Promise.all([sourceHealth(), recentRuns(20), issueCounts()]);

  const now = Date.now();
  const enriched = sources.map((s) => {
    const lagMinutes = s.lastSuccessAt ? Math.round((now - s.lastSuccessAt.getTime()) / 60000) : null;
    const budget = s.freshnessBudgetMinutes ?? 24 * 60;
    return {
      ...s,
      lagMinutes,
      state: !s.lastSuccessAt
        ? "never_run"
        : s.lastErrorState
          ? "unavailable"
          : lagMinutes !== null && lagMinutes > budget
            ? "stale"
            : "ok",
      withinBudget: lagMinutes === null ? null : lagMinutes <= budget,
    };
  });

  return ok(
    {
      sources: enriched,
      recentRuns: runs,
      issueCounts: counts,
      summary: {
        total: enriched.length,
        ok: enriched.filter((s) => s.state === "ok").length,
        stale: enriched.filter((s) => s.state === "stale").length,
        failing: enriched.filter((s) => s.state === "unavailable").length,
        neverRun: enriched.filter((s) => s.state === "never_run").length,
      },
    },
    await buildMeta(),
  );
}
