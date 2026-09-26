import { notFound } from "next/navigation";
import Link from "next/link";
import { Info } from "lucide-react";

import { ConfidenceChip } from "@/components/evidence/confidence-chip";
import { GateBadge } from "@/components/evidence/gate-badge";
import { ScoreStamp } from "@/components/evidence/score-stamp";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillarBreakdown } from "@/components/fox/pillar-breakdown";
import { ThesisPanel } from "@/components/fox/thesis-panel";
import { ScenarioTable } from "@/components/fox/scenario-table";
import { CatalystList } from "@/components/fox/catalyst-list";
import { RiskPanel } from "@/components/fox/risk-panel";
import { foxReportFor, issuerProfile, latestScores } from "@/db/queries/issuers";
import { HORIZON_LABELS, HORIZON_TARGETS, type GateState, type Horizon } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

const HORIZONS: Horizon[] = ["short", "medium", "long"];

export default async function FoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const horizon = (HORIZONS.includes(sp.horizon as Horizon) ? sp.horizon : "medium") as Horizon;

  const profile = await issuerProfile(id);
  if (!profile) notFound();

  const [scores, report] = await Promise.all([latestScores(id), foxReportFor(id, horizon)]);
  const score = scores.find((s) => s.horizon === horizon);

  return (
    <>
      <PageHeader
        title={`FOX research · ${profile.current?.ticker ?? ""}`}
        description={profile.issuer.name}
        actions={
          <Link href={`/issuers/${id}`} className="text-primary text-sm hover:underline">
            ← Company overview
          </Link>
        }
      />

      <Tabs value={horizon} className="mb-4">
        <TabsList>
          {HORIZONS.map((h) => (
            <TabsTrigger key={h} value={h} asChild>
              <Link href={`/issuers/${id}/fox?horizon=${h}`}>{HORIZON_LABELS[h]}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {!score ? (
        <Card>
          <EmptyState
            reason="not_computed"
            detail={`No ${horizon}-horizon score snapshot for this issuer. Run the factor and FOX pipelines for a session that has price data.`}
          />
        </Card>
      ) : (
        <>
          {/* --- headline --- */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
              <div>
                <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Composite</p>
                <div className="flex items-baseline gap-2">
                  <span className="tnum text-4xl font-semibold">
                    {score.composite ? Number(score.composite).toFixed(1) : "—"}
                  </span>
                  <ScoreStamp
                    horizon={horizon}
                    modelVersion={score.modelVersion}
                    asOf={score.asOf instanceof Date ? score.asOf.toISOString() : String(score.asOf)}
                  />
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Rank {score.rank ?? "—"} of {score.universeSize ?? "—"} eligible
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ConfidenceChip conviction={score.conviction} breakdown={score.convictionBreakdown as never} />
                <GateBadge
                  state={score.gateState as GateState}
                  triggers={score.gateTriggers as { gate: string; reason: string }[] | null}
                />
              </div>

              <p className="text-muted-foreground ml-auto max-w-sm text-xs">
                Validated against: {HORIZON_TARGETS[horizon]}
              </p>
            </CardContent>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <PillarBreakdown score={score} />
              <ThesisPanel report={report} />
              <ScenarioTable report={report} />
            </div>
            <div className="space-y-4">
              <CatalystList report={report} />
              <RiskPanel score={score} report={report} />
            </div>
          </div>

          {!report ? (
            <Alert variant="info" className="mt-4">
              <Info />
              <AlertTitle>Narrative not generated</AlertTitle>
              <AlertDescription>
                The numbers above come from the deterministic engine and are complete. The written
                thesis, scenarios and catalysts are composed separately from the same evidence, and
                have not been generated for this issuer yet. No narrative is better than an
                ungrounded one.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}
    </>
  );
}
