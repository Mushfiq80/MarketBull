import { foxReportFor, latestScores } from "@/db/queries/issuers";
import { fail, ok } from "@/lib/api/envelope";
import { HORIZON_TARGETS, type Horizon } from "@/lib/domain/states";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

const HORIZONS: Horizon[] = ["short", "medium", "long"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const horizon = (url.searchParams.get("horizon") ?? "medium") as Horizon;
  if (!HORIZONS.includes(horizon)) return fail("VALIDATION_FAILED", "Invalid horizon.");

  const allowSample = url.searchParams.get("allow_sample") === "true";
  const [scores, report] = await Promise.all([latestScores(id), foxReportFor(id, horizon)]);
  const score = scores.find((s) => s.horizon === horizon);

  if (!score) {
    return fail("SOURCE_UNAVAILABLE", `No ${horizon}-horizon score snapshot for this issuer.`);
  }

  // Sample-data firewall: research output refuses sample input unless explicitly
  // overridden, and is then watermarked (ADR 0007).
  if (score.usedSampleData && !allowSample) {
    return fail(
      "SAMPLE_DATA_BLOCKED",
      "This score was computed from sample data, so it is not research output. " +
        "Pass ?allow_sample=true to inspect it anyway — the result will be watermarked.",
      { hint: "Run `npm run db:clear:sample` and ingest real DSE data." },
    );
  }

  return ok(
    {
      horizon,
      targetOutcome: HORIZON_TARGETS[horizon],
      score: {
        composite: score.composite,
        fundamentals: score.fundamentalsScore,
        opportunity: score.opportunityScore,
        exposureQuality: score.exposureQualityScore,
        conviction: score.conviction,
        convictionBreakdown: score.convictionBreakdown,
        convictionNote: "Evidence reliability. NOT the probability of profit.",
        effectiveWeights: score.effectiveWeights,
        factorValues: score.factorValues,
        gateState: score.gateState,
        gateTriggers: score.gateTriggers,
        rank: score.rank,
        universeSize: score.universeSize,
        dataCompleteness: score.dataCompleteness,
        snapshotId: score.id,
      },
      report,
      watermark: score.usedSampleData ? "SAMPLE — NOT RESEARCH" : null,
    },
    await buildMeta({
      asOf: score.asOf,
      modelVersion: score.modelVersion,
      sampleData: score.usedSampleData,
    }),
  );
}
