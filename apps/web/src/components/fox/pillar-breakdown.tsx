import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { seriesColor } from "@/lib/charts/theme";

const PILLARS = [
  { key: "F", label: "Fundamentals", field: "fundamentalsScore", question: "What is the business worth and how healthy is it?", slot: 0 },
  { key: "O", label: "Opportunity", field: "opportunityScore", question: "What could drive recognition or revaluation?", slot: 2 },
  { key: "X", label: "Exposure quality", field: "exposureQualityScore", question: "What can go wrong? (higher = lower measured risk)", slot: 6 },
] as const;

export function PillarBreakdown({ score }: { score: any }) {
  const weights = ((score.effectiveWeights ?? {}) as any).pillars ?? {};
  const factorValues = (score.factorValues ?? {}) as Record<string, number | null>;
  const pillarWeights = (score.effectiveWeights ?? {}) as Record<string, Record<string, number>>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Pillar breakdown</CardTitle>
        <p className="text-muted-foreground text-xs">
          A company can have strong fundamentals and poor near-term opportunity, or a real catalyst
          with material risk. The pillars stay separate so those distinctions survive.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {PILLARS.map((p) => {
          const value = score[p.field] as string | null;
          const weightKey = p.key === "X" ? "Xq" : p.key;
          const weight = weights[weightKey];
          const contributing = pillarWeights[p.key] ?? {};

          return (
            <div key={p.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block size-2.5 rounded-[2px]" style={{ backgroundColor: seriesColor(p.slot) }} aria-hidden />
                  <span className="text-sm font-medium">
                    {p.key} — {p.label}
                  </span>
                  {weight !== undefined ? (
                    <span className="text-muted-foreground tnum text-xs">
                      weight {(weight * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">excluded — no usable factors</span>
                  )}
                </div>
                <span className="tnum text-lg font-semibold">
                  {value ? Number(value).toFixed(1) : "—"}
                </span>
              </div>
              <Progress value={value ? Number(value) : 0} indicatorColor={seriesColor(p.slot)} />
              <p className="text-muted-foreground mt-1 text-xs">{p.question}</p>

              {Object.keys(contributing).length ? (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(contributing).map(([factor, w]) => (
                    <Tooltip key={factor}>
                      <TooltipTrigger asChild>
                        <li className="text-muted-foreground tnum cursor-help text-[11px]">
                          {factor.replace(/_/g, " ")}{" "}
                          <span className="text-foreground">
                            {factorValues[factor] === null || factorValues[factor] === undefined
                              ? "—"
                              : factorValues[factor]!.toFixed(0)}
                          </span>
                          <span className="opacity-60"> ·{(w * 100).toFixed(0)}%</span>
                        </li>
                      </TooltipTrigger>
                      <TooltipContent>
                        {factorValues[factor] === null
                          ? "Unavailable — dropped from the weighting. Not zero."
                          : `Normalized percentile within its sector peer group, weighted ${(w * 100).toFixed(0)}% of this pillar.`}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}

        <p className="text-muted-foreground border-t pt-3 text-xs">
          Data completeness:{" "}
          <span className="tnum text-foreground">
            {score.dataCompleteness ? `${Number(score.dataCompleteness).toFixed(0)}%` : "—"}
          </span>
          . Unavailable factors are dropped and the remaining weights rescaled; the vector actually
          used is recorded on the snapshot rather than silently applied.
        </p>
      </CardContent>
    </Card>
  );
}
