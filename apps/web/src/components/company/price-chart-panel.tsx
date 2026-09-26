"use client";

import * as React from "react";

import { PriceChart, type Candle } from "@/components/charts/price-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const RANGES = [
  { key: "3m", label: "3M", days: 90 },
  { key: "6m", label: "6M", days: 180 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "2y", label: "2Y", days: 730 },
] as const;

export function PriceChartPanel({ bars, ticker }: { bars: any[]; ticker: string }) {
  const [range, setRange] = React.useState<(typeof RANGES)[number]["key"]>("1y");
  const [log, setLog] = React.useState(false);

  const days = RANGES.find((r) => r.key === range)!.days;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const candles: Candle[] = React.useMemo(
    () =>
      bars
        .filter((b) => b.sessionDate >= cutoff && b.open && b.high && b.low && b.close)
        .map((b) => ({
          time: b.sessionDate,
          open: Number(b.open),
          high: Number(b.high),
          low: Number(b.low),
          close: Number(b.close),
          volume: b.volume ? Number(b.volume) : undefined,
        })),
    [bars, cutoff],
  );

  const limitBoundCount = bars.filter((b) => b.sessionDate >= cutoff && b.limitBound).length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-sm">{ticker} price</CardTitle>
          <p className="text-muted-foreground text-xs">
            Corporate-action adjusted. Unadjusted prices would misread a bonus issue as a crash.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {limitBoundCount > 0 ? (
            <Badge variant="warning" title="Sessions that closed at the circuit limit">
              {limitBoundCount} limit-bound
            </Badge>
          ) : null}
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={range === r.key ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={log ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setLog(!log)}
            title="Logarithmic price scale"
          >
            log
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <PriceChart candles={candles} logScale={log} />
      </CardContent>
    </Card>
  );
}
