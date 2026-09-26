import { currentRegime } from "@/db/queries/regime";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const regime = await currentRegime();
  if (!regime) return fail("SOURCE_UNAVAILABLE", "No regime snapshot computed yet.");

  return ok(
    {
      sessionDate: regime.sessionDate,
      state: regime.state,
      stateScore: regime.stateScore,
      factorContributions: regime.factorContributions,
      effectiveWeights: regime.effectiveWeights,
      missingSeries: regime.missingSeries,
      dataCompleteness: regime.dataCompleteness,
      confidence: regime.confidence,
      transitionWatch: regime.transitionWatch,
      cycleBenchmarkLabel: regime.cycleBenchmarkLabel,
      note:
        "This is a classification of the CURRENT state using only data available by the as-of date. " +
        "It is not a forecast. Transition probabilities are a separate, calibration-gated output.",
    },
    await buildMeta({
      asOf: regime.asOf,
      modelVersion: regime.modelVersion,
      sampleData: regime.usedSampleData,
    }),
  );
}
