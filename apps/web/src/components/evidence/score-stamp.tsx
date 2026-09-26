import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HORIZON_DESCRIPTIONS, HORIZON_TARGETS, type Horizon } from "@/lib/domain/states";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * MANDATORY beside every score. Horizon · model version · as-of.
 *
 * A score without its horizon and methodology version is not interpretable, and
 * showing one invites the reader to treat a 5-day signal as a 5-year view.
 */
export function ScoreStamp({
  horizon,
  modelVersion,
  asOf,
  className,
}: {
  horizon: Horizon;
  modelVersion: string;
  asOf: string | Date | null;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "text-muted-foreground inline-flex cursor-help items-center gap-1 text-[11px] whitespace-nowrap",
            className,
          )}
        >
          <span className="uppercase tracking-wide">{horizon}</span>
          <span aria-hidden>·</span>
          <span className="tnum">{modelVersion}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="space-y-1">
          <p>
            <span className="font-medium capitalize">{horizon} horizon</span> — {HORIZON_DESCRIPTIONS[horizon]}
          </p>
          <p className="text-muted-foreground">Validated against: {HORIZON_TARGETS[horizon]}</p>
          <p className="text-muted-foreground">Model {modelVersion}</p>
          <p className="text-muted-foreground">As of {formatTimestamp(asOf, { withTime: true })}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
