import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { seriesColor } from "@/lib/charts/theme";
import { REGIME_LABELS, type RegimeState } from "@/lib/domain/states";
import { formatSessionDate } from "@/lib/format";

const TONE: Record<RegimeState, "good" | "warning" | "serious" | "critical" | "muted"> = {
  strong_bull: "good",
  bull: "good",
  confirmed_recovery: "good",
  early_recovery: "warning",
  late_bull_distribution: "warning",
  bear_transition: "serious",
  late_bear_stress: "critical",
  bear: "critical",
  indeterminate: "muted",
};

export function RegimeBanner({ regime }: { regime: any }) {
  const state = regime.state as RegimeState;
  const contributions = (regime.factorContributions ?? {}) as Record<string, number | null>;
  const missing = (regime.missingSeries ?? []) as string[];

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Market regime</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xl font-semibold">{REGIME_LABELS[state]}</span>
            <Badge variant={TONE[state]}>
              score {regime.stateScore ? Number(regime.stateScore).toFixed(0) : "—"}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {formatSessionDate(regime.sessionDate)} · model {regime.modelVersion}
          </p>
        </div>

        <div className="flex min-w-[260px] flex-1 flex-wrap gap-x-5 gap-y-2">
          {Object.entries(contributions).map(([dim, value], i) => (
            <Tooltip key={dim}>
              <TooltipTrigger asChild>
                <div className="min-w-[96px] flex-1 cursor-help">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground capitalize">{dim.replace(/_/g, " ")}</span>
                    <span className="tnum">{value === null ? "—" : value.toFixed(0)}</span>
                  </div>
                  <Progress value={value ?? 0} indicatorColor={seriesColor(i)} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {value === null
                  ? "This series was unavailable for the session. Its weight was dropped and the effective weight vector recorded — not silently renormalized."
                  : `Contribution score ${value.toFixed(1)} out of 100.`}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">confidence</span>
            <span className="tnum text-sm font-medium">
              {regime.confidence ? Number(regime.confidence).toFixed(0) : "—"}
            </span>
          </div>
          {missing.length ? (
            <span className="text-muted-foreground text-[11px]">{missing.length} series missing</span>
          ) : null}
          <Link href="/regime" className="text-primary flex items-center gap-1 text-xs hover:underline">
            Bull market watch <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
