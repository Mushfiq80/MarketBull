import { CircleCheck, CircleX, Info } from "lucide-react";

import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { RegimeBanner } from "@/components/market/regime-banner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TimeSeriesChart } from "@/components/charts/simple-charts";
import { currentRegime, regimeForecast, regimeHistory } from "@/db/queries/regime";
import { REGIME_LABELS, type RegimeState } from "@/lib/domain/states";
import { formatSessionDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bull market watch" };

export default async function RegimePage() {
  const regime = await currentRegime();
  if (!regime) {
    return (
      <>
        <PageHeader title="Bull market watch" />
        <Card>
          <EmptyState reason="not_computed" detail="Run the regime classifier after ingesting index history." />
        </Card>
      </>
    );
  }

  const to = regime.sessionDate;
  const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - 730 * 86400_000)
    .toISOString()
    .slice(0, 10);

  const [history, forecasts] = await Promise.all([
    regimeHistory(from, to),
    regimeForecast(regime.id),
  ]);

  const watch = (regime.transitionWatch ?? []) as {
    condition: string;
    met: boolean;
    direction: "confirms" | "weakens";
    detail: string;
  }[];

  const chartData = history.map((h) => ({
    date: formatSessionDate(h.sessionDate),
    score: h.stateScore ? Number(h.stateScore) : null,
    confidence: h.confidence ? Number(h.confidence) : null,
  }));

  const confirmed = watch.filter((w) => w.direction === "confirms");
  const met = confirmed.filter((w) => w.met).length;

  return (
    <>
      <PageHeader
        title="Bull market watch"
        description="Current market state, the conditions that would confirm a transition, and what is still missing."
      />

      <RegimeBanner regime={regime} />

      {/* Forecast is gated on calibration — never ship an unchecked probability. */}
      <Alert variant={forecasts.length ? "info" : "warning"} className="mt-4">
        <Info />
        <AlertTitle>
          {forecasts.length ? "Transition probabilities" : "Transition probabilities are not available"}
        </AlertTitle>
        <AlertDescription>
          {forecasts.length ? (
            <ul className="mt-1 space-y-0.5">
              {forecasts.map((f) => (
                <li key={f.id} className="tnum">
                  {f.horizonSessions} sessions → {REGIME_LABELS[f.targetState as RegimeState]}:{" "}
                  {f.probability ? `${(Number(f.probability) * 100).toFixed(0)}%` : "—"}
                  <span className="text-muted-foreground"> (Brier {f.brierScore ?? "—"})</span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              The transition model has not been calibrated against outcomes yet, so BABull will not
              show a number. A probability that has never been checked against what actually happened
              is not a probability — it is a number with a percent sign. Current state above is a
              classification, not a forecast.
            </>
          )}
        </AlertDescription>
      </Alert>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* --- confirmation checklist --- */}
        <Card>
          <CardHeader>
            <CardTitle>Confirmation checklist</CardTitle>
            <p className="text-muted-foreground text-xs">
              {met} of {confirmed.length} confirming conditions currently met. This is a checklist, not
              a promised start date.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {watch.map((w) => (
                <li key={w.condition} className="flex gap-2.5">
                  {w.met ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-[var(--status-good)]" aria-hidden />
                  ) : (
                    <CircleX className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm">
                      {w.condition}{" "}
                      <Badge variant={w.direction === "confirms" ? "outline" : "warning"} className="ml-1">
                        {w.direction}
                      </Badge>
                    </p>
                    <p className="text-muted-foreground text-xs">{w.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* --- history --- */}
        <Card>
          <CardHeader>
            <CardTitle>Regime score history</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartFrame
              subtitle="Composite state score and its confidence, two years"
              legend={[
                { label: "State score", color: "var(--chart-1)" },
                { label: "Confidence", color: "var(--chart-2)" },
              ]}
              tableColumns={["Date", "State score", "Confidence"]}
              tableRows={chartData.map((d) => [d.date, d.score?.toFixed(1) ?? null, d.confidence?.toFixed(0) ?? null])}
              height={240}
            >
              <TimeSeriesChart
                data={chartData}
                xKey="date"
                series={[
                  { key: "score", label: "State score" },
                  { key: "confidence", label: "Confidence" },
                ]}
              />
            </ChartFrame>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Historical cycle benchmark</CardTitle>
          <p className="text-muted-foreground text-xs">
            The conventional 20% rise/fall dating rule, generated separately for research comparison.
            It is hindsight by construction and never drives the live label.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Current benchmark label:{" "}
            <Badge variant="outline">{regime.cycleBenchmarkLabel ?? "not computed"}</Badge>
          </p>
        </CardContent>
      </Card>
    </>
  );
}
