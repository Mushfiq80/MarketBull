import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Breakdown = {
  sourceAuthority: number;
  freshness: number;
  completeness: number;
  agreement: number;
  historicalCalibration: number | null;
} | null;

/**
 * Conviction chip. Outline only, never filled, never red — uncertainty should be
 * visible without shouting (design system §1.4).
 *
 * The copy here deliberately states what conviction is NOT. Conflating evidence
 * reliability with probability of profit is the most misleading thing this kind
 * of product can do.
 */
export function ConfidenceChip({
  conviction,
  breakdown,
}: {
  conviction: string | number | null | undefined;
  breakdown?: Breakdown;
}) {
  if (conviction === null || conviction === undefined) {
    return (
      <Badge variant="muted" title="Conviction could not be computed.">
        conviction —
      </Badge>
    );
  }
  const value = Number(conviction);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="outline" className="cursor-help gap-1 normal-case">
            conviction <span className="tnum font-semibold">{value.toFixed(0)}</span>
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="space-y-1.5">
          <p className="font-medium">Evidence reliability, not probability of profit.</p>
          <p className="text-muted-foreground">
            Measures source authority, freshness, completeness, agreement between sources and — where
            the sample allows — historical calibration.
          </p>
          {breakdown ? (
            <ul className="tnum space-y-0.5 pt-1">
              <li>Source authority: {breakdown.sourceAuthority.toFixed(0)}</li>
              <li>Freshness: {breakdown.freshness.toFixed(0)}</li>
              <li>Completeness: {breakdown.completeness.toFixed(0)}</li>
              <li>Agreement: {breakdown.agreement.toFixed(0)}</li>
              <li>
                Historical calibration:{" "}
                {breakdown.historicalCalibration === null
                  ? "not enough history yet"
                  : breakdown.historicalCalibration.toFixed(0)}
              </li>
            </ul>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
