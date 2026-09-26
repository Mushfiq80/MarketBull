import { AlertTriangle, CircleCheck, CircleSlash, Clock, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SourceState } from "@/lib/api/envelope";

const CONFIG: Record<
  SourceState,
  { label: string; variant: "good" | "warning" | "critical" | "muted"; Icon: typeof CircleCheck; hint: string }
> = {
  ok: { label: "Live", variant: "good", Icon: CircleCheck, hint: "Within this source's freshness budget." },
  stale: {
    label: "Stale",
    variant: "warning",
    Icon: Clock,
    hint: "Real data, but past its freshness budget. Treat the values as dated.",
  },
  unavailable: {
    label: "Down",
    variant: "critical",
    Icon: AlertTriangle,
    hint: "The source is failing. Values shown are the last known good ones.",
  },
  restricted: {
    label: "Licensed",
    variant: "muted",
    Icon: CircleSlash,
    hint: "Licensed source — not displayable in this build.",
  },
  never_run: {
    label: "No data",
    variant: "muted",
    Icon: HelpCircle,
    hint: "This source has never been ingested successfully.",
  },
};

/** MANDATORY on every market-sensitive panel header. */
export function FreshnessBadge({
  state,
  lagMinutes,
  sourceId,
}: {
  state: SourceState;
  lagMinutes?: number | null;
  sourceId?: string;
}) {
  const { label, variant, Icon, hint } = CONFIG[state];
  const age =
    lagMinutes == null
      ? null
      : lagMinutes < 60
        ? `${Math.round(lagMinutes)}m`
        : lagMinutes < 1440
          ? `${Math.round(lagMinutes / 60)}h`
          : `${Math.round(lagMinutes / 1440)}d`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant={variant} className="cursor-help gap-1">
            <Icon className="size-3" aria-hidden />
            {label}
            {age ? <span className="tnum opacity-70">{age}</span> : null}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5">
          {sourceId ? <p className="font-medium">{sourceId}</p> : null}
          <p>{hint}</p>
          {age ? <p className="text-muted-foreground">Last successful update {age} ago.</p> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
