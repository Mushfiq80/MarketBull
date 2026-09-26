import { currentRegime } from "@/db/queries/regime";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const regime = await currentRegime();
  if (!regime) return fail("SOURCE_UNAVAILABLE", "No regime snapshot computed yet.");

  const watch = (regime.transitionWatch ?? []) as {
    condition: string;
    met: boolean;
    direction: "confirms" | "weakens";
    detail: string;
  }[];
  const confirming = watch.filter((w) => w.direction === "confirms");

  return ok(
    {
      currentState: regime.state,
      stateScore: regime.stateScore,
      confidence: regime.confidence,
      checklist: watch,
      confirmingMet: confirming.filter((w) => w.met).length,
      confirmingTotal: confirming.length,
      note:
        "A confirmation checklist, not a promised start date. BABull does not predict when a bull " +
        "market begins; it reports which conditions currently hold.",
    },
    await buildMeta({ asOf: regime.asOf, modelVersion: regime.modelVersion }),
  );
}
