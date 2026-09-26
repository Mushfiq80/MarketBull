import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Value } from "@/components/evidence/value";
import { EmptyState } from "@/components/shell/empty-state";
import { MARKET } from "@/lib/charts/theme";
import { stateful } from "@/lib/format";

export function BreadthPanel({ breadth }: { breadth: any | null }) {
  if (!breadth) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Market breadth</CardTitle>
        </CardHeader>
        <EmptyState reason="not_computed" detail="Breadth snapshots are generated after EOD ingestion." />
      </Card>
    );
  }

  const adv = Number(breadth.advancing ?? 0);
  const dec = Number(breadth.declining ?? 0);
  const unch = Number(breadth.unchanged ?? 0);
  const total = adv + dec + unch || 1;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle>Market breadth</CardTitle>
        <p className="text-muted-foreground text-xs">
          How widely the move is shared — an index carried by a few large caps is a different thing.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stacked bar with a 2px surface gap between segments. */}
        <div>
          <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
            <div style={{ width: `${(adv / total) * 100}%`, backgroundColor: MARKET.gain }} />
            <div style={{ width: `${(unch / total) * 100}%`, backgroundColor: MARKET.flat }} />
            <div style={{ width: `${(dec / total) * 100}%`, backgroundColor: MARKET.loss }} />
          </div>
          <div className="text-muted-foreground mt-1.5 flex justify-between text-xs">
            <span className="text-[var(--gain)]">▲ {adv} advancing</span>
            <span>{unch} unchanged</span>
            <span className="text-[var(--loss)]">▼ {dec} declining</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Stat label="Above 50-session MA" value={breadth.pctAboveMa50} kind="percent" />
          <Stat label="Above 200-session MA" value={breadth.pctAboveMa200} kind="percent" />
          <Stat label="New 52w highs" value={breadth.newHighs52w} kind="integer" />
          <Stat label="New 52w lows" value={breadth.newLows52w} kind="integer" />
          <Stat label="Turnover percentile" value={breadth.turnoverPercentile} kind="percent" />
          <Stat label="Top-10 concentration" value={breadth.turnoverConcentrationTop10} kind="percent" />
        </dl>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, kind }: { label: string; value: unknown; kind: "percent" | "integer" }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">
        <Value value={stateful(value as string | number | null)} kind={kind} />
      </dd>
    </div>
  );
}
