import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Value } from "@/components/evidence/value";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartFrame } from "@/components/charts/chart-frame";
import { CategoryBarChart } from "@/components/charts/simple-charts";
import type { HoldingRow, PortfolioAnalysis } from "@/lib/portfolio/analysis";
import { formatCompactMoney, formatSessionDate, stateful } from "@/lib/format";

export function PortfolioView({
  holdings,
  analysis,
}: {
  holdings: HoldingRow[];
  analysis: PortfolioAnalysis;
}) {
  const scenarioRows = analysis.scenarios.map((s) => ({ name: s.name, changePct: s.changePct }));

  return (
    <>
      {/* --- headline --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Priced value" value={analysis.pricedValue} money />
        <Stat label="Cost basis" value={analysis.totalCost} money />
        <Stat
          label="Unrealised P&L"
          value={analysis.unrealizedPnl}
          money
          tone={analysis.unrealizedPnl >= 0 ? "gain" : "loss"}
        />
        <Stat
          label="Return"
          value={analysis.returnPct}
          suffix="%"
          tone={(analysis.returnPct ?? 0) >= 0 ? "gain" : "loss"}
        />
      </div>

      {analysis.warnings.length ? (
        <Alert variant="warning" className="mt-4">
          <TriangleAlert />
          <AlertTitle>Read these before acting on the numbers</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {analysis.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* --- sector exposure --- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Sector exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartFrame
              subtitle="Share of priced value"
              tableColumns={["Sector", "Value", "Weight %"]}
              tableRows={analysis.bySector.map((b) => [
                b.label,
                formatCompactMoney(b.value),
                b.weightPct.toFixed(1),
              ])}
              height={Math.max(180, analysis.bySector.length * 28)}
            >
              <CategoryBarChart
                data={analysis.bySector.map((b) => ({ label: b.label, weight: Number(b.weightPct.toFixed(2)) }))}
                categoryKey="label"
                valueKey="weight"
                formatter={(v) => `${v}%`}
              />
            </ChartFrame>
          </CardContent>
        </Card>

        {/* --- concentration + stress --- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Concentration &amp; stress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Largest position</dt>
                <dd className="tnum text-sm font-medium">
                  {analysis.concentrationTop1 ? `${analysis.concentrationTop1.toFixed(1)}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Top 5</dt>
                <dd className="tnum text-sm font-medium">
                  {analysis.concentrationTop5 ? `${analysis.concentrationTop5.toFixed(1)}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">HHI</dt>
                <dd className="tnum text-sm font-medium">
                  {analysis.herfindahl ? analysis.herfindahl.toFixed(0) : "—"}
                </dd>
              </div>
            </dl>

            <ChartFrame
              subtitle="Scenario stress — explicit assumptions, not probabilities"
              tableColumns={["Scenario", "Change %"]}
              tableRows={scenarioRows.map((s) => [s.name, s.changePct.toFixed(1)])}
              height={170}
            >
              <CategoryBarChart
                data={scenarioRows.map((s) => ({ label: s.name, changePct: Number(s.changePct.toFixed(2)) }))}
                categoryKey="label"
                valueKey="changePct"
                diverging
                formatter={(v) => `${v}%`}
              />
            </ChartFrame>
            <p className="text-muted-foreground text-xs">
              Scenarios apply stated sector shocks to current positions. No likelihood is attached to
              any of them.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* --- holdings --- */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle>Holdings</CardTitle>
          <p className="text-muted-foreground text-xs">
            Quantities and average cost are corporate-action adjusted from the transaction ledger.
          </p>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg cost</TableHead>
                <TableHead className="text-right">Market value</TableHead>
                <TableHead className="text-right">Unrealised</TableHead>
                <TableHead>Priced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.map((h) => (
                <TableRow key={h.holdingId}>
                  <TableCell>
                    <Link href={`/issuers/${h.issuerId}`} className="tnum font-medium hover:underline">
                      {h.ticker}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate">{h.name}</TableCell>
                  <TableCell className="text-right"><Value value={stateful(h.quantity)} kind="integer" /></TableCell>
                  <TableCell className="text-right"><Value value={stateful(h.averageCost)} kind="price" /></TableCell>
                  <TableCell className="text-right">
                    <Value
                      value={
                        h.valuationState === "available"
                          ? stateful(h.marketValue)
                          : { value: null, state: "unavailable", reason: h.valuationNote ?? h.valuationState }
                      }
                      kind="money"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Value value={stateful(h.unrealizedPnl)} kind="money" />
                  </TableCell>
                  <TableCell>
                    {h.valuationState === "available" ? (
                      <Badge variant="good">{formatSessionDate(h.valuationSessionDate)}</Badge>
                    ) : (
                      <Badge variant="warning" title={h.valuationNote ?? undefined}>
                        {h.valuationState}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {holdings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-center">
                    No holdings recorded.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
  money = false,
  suffix,
  tone,
}: {
  label: string;
  value: number | null;
  money?: boolean;
  suffix?: string;
  tone?: "gain" | "loss";
}) {
  const text =
    value === null
      ? "—"
      : money
        ? formatCompactMoney(value)
        : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}${suffix ?? ""}`;
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</p>
        <p
          className={
            "tnum mt-0.5 text-xl font-semibold " +
            (tone === "gain" ? "text-[var(--gain)]" : tone === "loss" ? "text-[var(--loss)]" : "")
          }
        >
          {text}
        </p>
      </CardContent>
    </Card>
  );
}
