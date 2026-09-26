import { breadthFor, indexCards, latestSessionDate, movers, sectorPulse } from "@/db/queries/market";
import { currentRegime } from "@/db/queries/regime";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta, detectSample } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionDate = await latestSessionDate();
  if (!sessionDate) {
    return fail("SOURCE_UNAVAILABLE", "No market data has been ingested yet.");
  }

  const [indices, breadth, regime, gainers, losers, active, unusual, sectors] = await Promise.all([
    indexCards(sessionDate),
    breadthFor(sessionDate),
    currentRegime(),
    movers(sessionDate, "gainers", 10),
    movers(sessionDate, "losers", 10),
    movers(sessionDate, "active", 10),
    movers(sessionDate, "unusual", 10),
    sectorPulse(sessionDate),
  ]);

  return ok(
    {
      sessionDate,
      indices,
      breadth,
      regime: regime
        ? {
            state: regime.state,
            stateScore: regime.stateScore,
            confidence: regime.confidence,
            factorContributions: regime.factorContributions,
            missingSeries: regime.missingSeries,
            modelVersion: regime.modelVersion,
            note: "Classification of the current state, not a forecast.",
          }
        : null,
      movers: { gainers, losers, active, unusual },
      sectors,
    },
    await buildMeta({
      asOf: `${sessionDate}T00:00:00Z`,
      modelVersion: regime?.modelVersion,
      sampleData: detectSample([...indices, ...(breadth ? [breadth] : []), ...(regime ? [regime] : [])] as never),
    }),
  );
}
