import { currentRegime, regimeForecast } from "@/db/queries/regime";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

const ALLOWED = [20, 60, 120];

/**
 * Transition probabilities.
 *
 * Returns MODEL_UNCALIBRATED until calibration passes. A probability that has
 * never been checked against outcomes is not a probability, and shipping one
 * would be exactly the false precision this product exists to avoid.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const horizon = Number(url.searchParams.get("horizon") ?? 60);
  if (!ALLOWED.includes(horizon)) {
    return fail("VALIDATION_FAILED", `horizon must be one of ${ALLOWED.join(", ")} sessions.`);
  }

  const regime = await currentRegime();
  if (!regime) return fail("SOURCE_UNAVAILABLE", "No regime snapshot computed yet.");

  const rows = await regimeForecast(regime.id, horizon);
  const calibrated = rows.filter((r) => r.calibrationState === "calibrated");

  if (!calibrated.length) {
    return fail(
      "MODEL_UNCALIBRATED",
      "Regime transition probabilities are not calibrated yet, so BABull will not show a number. " +
        "Run the calibration backtest and record Brier score and log loss before this output is enabled.",
      {
        currentState: regime.state,
        stateScore: regime.stateScore,
        hint: "The confirmation checklist on /regime is the usable output until then.",
      },
    );
  }

  return ok(
    { horizonSessions: horizon, forecasts: calibrated },
    await buildMeta({ asOf: regime.asOf, modelVersion: regime.modelVersion }),
  );
}
