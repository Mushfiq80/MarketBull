import { latestScoredSession, rankings } from "@/db/queries/rankings";
import { fail, ok } from "@/lib/api/envelope";
import { HORIZON_TARGETS, type Horizon } from "@/lib/domain/states";
import { buildMeta, detectSample } from "../../_shared";

export const dynamic = "force-dynamic";

const HORIZONS: Horizon[] = ["short", "medium", "long"];

export async function GET(request: Request, { params }: { params: Promise<{ horizon: string }> }) {
  const { horizon } = await params;
  if (!HORIZONS.includes(horizon as Horizon)) {
    return fail("VALIDATION_FAILED", `horizon must be one of ${HORIZONS.join(", ")}.`);
  }
  const h = horizon as Horizon;
  const url = new URL(request.url);

  const sessionDate = url.searchParams.get("date") ?? (await latestScoredSession(h));
  if (!sessionDate) {
    return fail(
      "SOURCE_UNAVAILABLE",
      `No score snapshots for the ${h} horizon. Run the factor and FOX pipelines first.`,
    );
  }

  const gateParam = url.searchParams.get("gate") ?? "eligible";
  const rows = await rankings({
    horizon: h,
    sessionDate,
    sector: url.searchParams.get("sector") ?? undefined,
    gate: gateParam === "all" ? undefined : [gateParam as "eligible"],
    minTurnover: url.searchParams.get("minTurnover")
      ? Number(url.searchParams.get("minTurnover"))
      : undefined,
    shariah: (url.searchParams.get("shariah") as "pass" | undefined) ?? undefined,
    limit: Math.min(500, Number(url.searchParams.get("limit") ?? 100)),
    offset: Number(url.searchParams.get("offset") ?? 0),
  });

  return ok(
    {
      horizon: h,
      sessionDate,
      targetOutcome: HORIZON_TARGETS[h],
      count: rows.length,
      rows,
      note:
        "Relative attractiveness within the eligible universe under the stated model version. " +
        "Gate state is non-compensatory and is never folded into the score.",
    },
    await buildMeta({
      asOf: rows[0]?.asOf ?? `${sessionDate}T00:00:00Z`,
      modelVersion: rows[0]?.modelVersion,
      sampleData: detectSample(rows as never),
    }),
  );
}
