"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { candlestickColors, lightweightChartsTheme } from "@/lib/charts/theme";

export type Candle = {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

/**
 * OHLCV candlestick + volume pane, via lightweight-charts.
 *
 * Recharts is NOT used here on purpose (ADR 0005): it has no candle mark, no
 * OHLC crosshair tooltip and no linked volume pane, and the price chart is the
 * single most-looked-at object in the product.
 */
export function PriceChart({
  candles,
  height = 380,
  logScale = false,
}: {
  candles: Candle[];
  height?: number;
  logScale?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    // Dynamic import keeps the library out of the server bundle and off pages
    // that never show a price chart.
    void (async () => {
      const LWC = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const chart = LWC.createChart(containerRef.current, {
        ...lightweightChartsTheme(containerRef.current),
        width: containerRef.current.clientWidth,
        height,
        rightPriceScale: {
          ...lightweightChartsTheme(containerRef.current).rightPriceScale,
          mode: logScale ? 1 : 0,
          scaleMargins: { top: 0.08, bottom: 0.28 },
        },
      });

      const candleSeries = chart.addSeries(LWC.CandlestickSeries, {
        ...candlestickColors(containerRef.current),
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      candleSeries.setData(
        candles.map((c) => ({
          time: c.time as never,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );

      if (candles.some((c) => c.volume !== undefined)) {
        const volumeSeries = chart.addSeries(LWC.HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
        const colors = candlestickColors(containerRef.current);
        volumeSeries.setData(
          candles.map((c) => ({
            time: c.time as never,
            value: c.volume ?? 0,
            color: c.close >= c.open ? `${colors.upColor}55` : `${colors.downColor}55`,
          })),
        );
      }

      chart.timeScale().fitContent();

      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width) chart.applyOptions({ width });
      });
      observer.observe(containerRef.current);

      cleanup = () => {
        observer.disconnect();
        chart.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // resolvedTheme is a dependency so the chart re-themes on toggle —
    // lightweight-charts reads a JS options object and cannot see CSS variables.
  }, [candles, height, logScale, resolvedTheme]);

  if (candles.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-md border border-dashed text-xs"
        style={{ height }}
      >
        No price history for this range.
      </div>
    );
  }

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
