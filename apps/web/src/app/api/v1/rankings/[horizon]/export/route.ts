import { latestScoredSession, rankings } from "@/db/queries/rankings";
import { fail } from "@/lib/api/envelope";
import type { Horizon } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

const HORIZONS: Horizon[] = ["short", "medium", "long"];

const COLUMNS = [
  "rank", "ticker", "name", "sector", "composite", "fundamentals", "opportunity",
  "exposure_quality", "conviction", "gate_state", "close", "turnover",
  "data_completeness", "model_version", "as_of", "used_sample_data",
];

export async function GET(request: Request, { params }: { params: Promise<{ horizon: string }> }) {
  const { horizon } = await params;
  if (!HORIZONS.includes(horizon as Horizon)) {
    return fail("VALIDATION_FAILED", "Invalid horizon.");
  }
  const h = horizon as Horizon;
  const url = new URL(request.url);
  const sessionDate = url.searchParams.get("date") ?? (await latestScoredSession(h));
  if (!sessionDate) return fail("SOURCE_UNAVAILABLE", "Nothing to export.");

  const gateParam = url.searchParams.get("gate") ?? "eligible";
  const rows = await rankings({
    horizon: h,
    sessionDate,
    sector: url.searchParams.get("sector") ?? undefined,
    gate: gateParam === "all" ? undefined : [gateParam as "eligible"],
    minTurnover: url.searchParams.get("minTurnover") ? Number(url.searchParams.get("minTurnover")) : undefined,
    shariah: (url.searchParams.get("shariah") as "pass" | undefined) ?? undefined,
    limit: 1000,
  });

  const lines = [
    `# BABull ranking export — ${h} horizon, session ${sessionDate}`,
    "# Research and decision support. Not investment advice.",
    COLUMNS.join(","),
    ...rows.map((r) =>
      [
        r.rank ?? "",
        r.ticker,
        csv(r.name),
        csv(r.sector ?? ""),
        r.composite ?? "",
        r.fundamentalsScore ?? "",
        r.opportunityScore ?? "",
        r.exposureQualityScore ?? "",
        r.conviction ?? "",
        r.gateState,
        r.close ?? "",
        r.turnover ?? "",
        r.dataCompleteness ?? "",
        r.modelVersion,
        r.asOf instanceof Date ? r.asOf.toISOString() : String(r.asOf),
        r.usedSampleData ? "true" : "false",
      ].join(","),
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="babull-ranking-${h}-${sessionDate}.csv"`,
    },
  });
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
