import { Suspense } from "react";

import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { RankingsFilters } from "@/components/rankings/rankings-filters";
import { RankingsTable, type RankingRowView } from "@/components/rankings/rankings-table";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { latestScoredSession, rankings, rankingSectors } from "@/db/queries/rankings";
import { HORIZON_DESCRIPTIONS, HORIZON_LABELS, HORIZON_TARGETS, type Horizon } from "@/lib/domain/states";
import { formatSessionDate } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rankings" };

const HORIZONS: Horizon[] = ["short", "medium", "long"];

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const horizon = (HORIZONS.includes(params.horizon as Horizon) ? params.horizon : "medium") as Horizon;

  const sessionDate = await latestScoredSession(horizon);
  if (!sessionDate) {
    return (
      <>
        <RankingsHeader horizon={horizon} sessionDate={null} />
        <Card>
          <EmptyState
            reason="not_computed"
            detail="No score snapshots exist for this horizon yet. Ingest price data, then run the factor and FOX pipelines."
          />
        </Card>
      </>
    );
  }

  const gateParam = params.gate ?? "eligible";
  const gate =
    gateParam === "all"
      ? undefined
      : ([gateParam] as ("eligible" | "restricted" | "review_required" | "excluded")[]);

  const [rows, sectors] = await Promise.all([
    rankings({
      horizon,
      sessionDate,
      sector: params.sector,
      gate,
      minTurnover: params.minTurnover ? Number(params.minTurnover) : undefined,
      shariah: params.shariah as "pass" | "fail" | "undetermined" | undefined,
      limit: 250,
    }),
    rankingSectors(horizon, sessionDate),
  ]);

  const view: RankingRowView[] = rows.map((r) => ({
    ...r,
    gateState: r.gateState as RankingRowView["gateState"],
    asOf: r.asOf instanceof Date ? r.asOf.toISOString() : String(r.asOf),
  }));

  return (
    <>
      <RankingsHeader horizon={horizon} sessionDate={sessionDate} />
      <RankingsFilters horizon={horizon} sectors={sectors.map((s) => s.sector)} />
      {view.length === 0 ? (
        <Card>
          <EmptyState
            reason="gated"
            detail="No instruments matched these filters. Try including gated names or lowering the liquidity threshold."
          />
        </Card>
      ) : (
        <Suspense>
          <RankingsTable rows={view} horizon={horizon} />
        </Suspense>
      )}
      <p className="text-muted-foreground mt-3 text-xs">
        Showing {view.length} instrument{view.length === 1 ? "" : "s"}. Scores are relative
        attractiveness within the eligible universe for this horizon under the stated model version —
        not a prediction, and not advice.
      </p>
    </>
  );
}

function RankingsHeader({ horizon, sessionDate }: { horizon: Horizon; sessionDate: string | null }) {
  return (
    <>
      <PageHeader
        title="Rankings"
        description={
          sessionDate
            ? `${HORIZON_DESCRIPTIONS[horizon]} · session ${formatSessionDate(sessionDate)}`
            : HORIZON_DESCRIPTIONS[horizon]
        }
      />
      <Tabs value={horizon} className="mb-3">
        <TabsList>
          {HORIZONS.map((h) => (
            <TabsTrigger key={h} value={h} asChild>
              <Link href={`/rankings?horizon=${h}`}>{HORIZON_LABELS[h]}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className="text-muted-foreground mb-3 text-xs">
        Target outcome this model is validated against: {HORIZON_TARGETS[horizon]}
      </p>
    </>
  );
}
