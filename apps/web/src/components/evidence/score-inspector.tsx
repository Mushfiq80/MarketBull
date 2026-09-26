"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { seriesColor } from "@/lib/charts/theme";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ScoreDetail = {
  id: string;
  ticker: string;
  name: string;
  horizon: string;
  asOf: string;
  modelVersion: string;
  configHash?: string;
  composite: string | null;
  fundamentals: string | null;
  opportunity: string | null;
  exposureQuality: string | null;
  conviction: string | null;
  dataCompleteness: string | null;
  gateState: string;
  gateTriggers: { gate: string; reason: string; evidence?: string | null }[] | null;
  effectiveWeights: Record<string, unknown>;
  factorValues: Record<string, number | null>;
  usedSampleData: boolean;
};

/**
 * MANDATORY: no score is displayed without a way to inspect its components and
 * evidence. This is the "no score without its evidence" principle made concrete.
 */
export function ScoreInspector({
  detail,
  children,
}: {
  detail: ScoreDetail;
  children: React.ReactNode;
}) {
  const pillars = [
    { key: "F", label: "Fundamentals", value: detail.fundamentals, color: seriesColor(0) },
    { key: "O", label: "Opportunity", value: detail.opportunity, color: seriesColor(2) },
    { key: "X", label: "Exposure quality", value: detail.exposureQuality, color: seriesColor(6) },
  ];

  const pillarWeights = (detail.effectiveWeights?.pillars ?? {}) as Record<string, number>;
  const available = Object.values(detail.factorValues).filter((v) => v !== null).length;
  const total = Object.keys(detail.factorValues).length;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" className="text-left hover:underline underline-offset-4 decoration-dotted">
          {children}
        </button>
      </SheetTrigger>
      <SheetContent className="overflow-hidden p-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="tnum">{detail.ticker}</span>
            <span className="text-muted-foreground truncate text-sm font-normal">{detail.name}</span>
          </SheetTitle>
          <SheetDescription>
            {detail.horizon} horizon · model {detail.modelVersion}
            {detail.configHash ? ` (${detail.configHash})` : ""} · as of{" "}
            {formatTimestamp(detail.asOf, { withTime: true })}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-7rem)]">
          <div className="space-y-5 p-4">
            {detail.usedSampleData ? (
              <div className="rounded-md border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 p-2 text-xs">
                This score used <strong>sample data</strong>. It is not research output.
              </div>
            ) : null}

            {/* --- composite --- */}
            <section>
              <h3 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
                Composite
              </h3>
              <div className="flex items-baseline gap-3">
                <span className="tnum text-3xl font-semibold">
                  {detail.composite ? Number(detail.composite).toFixed(1) : "—"}
                </span>
                <span className="text-muted-foreground text-xs">
                  {detail.composite ? "relative attractiveness, 0–100" : "not enough data to score"}
                </span>
              </div>
            </section>

            <Separator />

            {/* --- pillars --- */}
            <section>
              <h3 className="text-muted-foreground mb-3 text-[11px] font-medium tracking-wide uppercase">
                Pillars
              </h3>
              <div className="space-y-3">
                {pillars.map((p) => (
                  <div key={p.key}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-2 rounded-[2px]"
                          style={{ backgroundColor: p.color }}
                          aria-hidden
                        />
                        {p.label}
                        {pillarWeights[p.key === "X" ? "Xq" : p.key] !== undefined ? (
                          <span className="text-muted-foreground tnum">
                            w {(pillarWeights[p.key === "X" ? "Xq" : p.key]! * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">excluded — no usable factors</span>
                        )}
                      </span>
                      <span className="tnum font-medium">
                        {p.value ? Number(p.value).toFixed(1) : "—"}
                      </span>
                    </div>
                    <Progress value={p.value ? Number(p.value) : 0} indicatorColor={p.color} />
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                Exposure is stored inverted: a <em>higher</em> exposure-quality score means{" "}
                <em>lower</em> measured risk.
              </p>
            </section>

            <Separator />

            {/* --- gates --- */}
            <section>
              <h3 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
                Risk gates
              </h3>
              {detail.gateTriggers?.length ? (
                <ul className="space-y-2">
                  {detail.gateTriggers.map((t) => (
                    <li key={t.gate} className="text-xs">
                      <Badge variant="serious" className="mb-1">{t.gate.replace(/_/g, " ")}</Badge>
                      <p className="text-muted-foreground">{t.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">
                  No gate triggered. Gates are evaluated before scoring and are never averaged into it.
                </p>
              )}
            </section>

            <Separator />

            {/* --- factors --- */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Component factors
                </h3>
                <span className="text-muted-foreground tnum text-xs">
                  {available}/{total} available
                </span>
              </div>
              <ul className="space-y-1">
                {Object.entries(detail.factorValues)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, value]) => (
                    <li
                      key={name}
                      className="flex items-center justify-between gap-2 border-b border-dashed py-1 text-xs last:border-0"
                    >
                      <span className="text-muted-foreground truncate">{name.replace(/_/g, " ")}</span>
                      <span className={cn("tnum", value === null && "text-muted-foreground")}>
                        {value === null ? "—" : value.toFixed(1)}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-xs">
                An em dash means the factor was <strong>unavailable</strong>, not zero. Unavailable
                factors are dropped from the weighting and the remaining weights are rescaled — the
                vector actually used is recorded on the snapshot.
              </p>
            </section>

            <Separator />

            <section className="text-muted-foreground space-y-1 text-xs">
              <p>
                Data completeness:{" "}
                <span className="tnum text-foreground">
                  {detail.dataCompleteness ? `${Number(detail.dataCompleteness).toFixed(0)}%` : "—"}
                </span>
              </p>
              <p className="flex items-center gap-1">
                Snapshot id <code className="text-[10px]">{detail.id}</code>
                <ExternalLink className="size-3" aria-hidden />
              </p>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
