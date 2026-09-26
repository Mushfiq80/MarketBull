"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { CHROME, MARKS, divergingBucket, seriesColor } from "@/lib/charts/theme";

const AXIS = { stroke: CHROME.axis, tick: { fill: CHROME.textMuted, fontSize: 11 }, tickLine: false };
const GRID = { stroke: CHROME.grid, strokeDasharray: MARKS.gridDash, vertical: false };

function TooltipBox({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover rounded-md border px-2.5 py-1.5 text-xs shadow-md">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="tnum flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-[2px]" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-medium">{formatter ? formatter(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Single-series line. No legend — the title names it. */
export function Sparkline({ data, dataKey = "value", color }: { data: any[]; dataKey?: string; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color ?? seriesColor(0)}
          strokeWidth={MARKS.lineWidth}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TimeSeriesChart({
  data,
  xKey,
  series,
  formatter,
}: {
  data: any[];
  xKey: string;
  series: { key: string; label: string }[];
  formatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* ONE y-axis. Never dual-axis — two scales on one chart is the #1 chart mistake. */}
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} minTickGap={32} />
        <YAxis {...AXIS} width={52} />
        <Tooltip content={<TooltipBox formatter={formatter} />} cursor={{ stroke: CHROME.axis }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={seriesColor(i)}
            strokeWidth={MARKS.lineWidth}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AreaSeriesChart({ data, xKey, dataKey, label }: { data: any[]; xKey: string; dataKey: string; label: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={seriesColor(0)} stopOpacity={0.35} />
            <stop offset="100%" stopColor={seriesColor(0)} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} minTickGap={32} />
        <YAxis {...AXIS} width={52} />
        <Tooltip content={<TooltipBox />} />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={label}
          stroke={seriesColor(0)}
          strokeWidth={MARKS.lineWidth}
          fill="url(#areaFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars with 4px rounded data-ends anchored to the baseline. */
export function CategoryBarChart({
  data,
  categoryKey,
  valueKey,
  diverging = false,
  formatter,
}: {
  data: any[];
  categoryKey: string;
  valueKey: string;
  diverging?: boolean;
  formatter?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => Math.abs(Number(d[valueKey]) || 0)), 1);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }} barCategoryGap={MARKS.barGapPx}>
        <CartesianGrid {...GRID} horizontal={false} vertical />
        <XAxis type="number" {...AXIS} />
        <YAxis type="category" dataKey={categoryKey} {...AXIS} width={110} />
        <Tooltip content={<TooltipBox formatter={formatter} />} cursor={{ fill: "transparent" }} />
        {diverging ? <ReferenceLine x={0} stroke={CHROME.axis} /> : null}
        <Bar dataKey={valueKey} radius={[0, MARKS.barRadius, MARKS.barRadius, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={diverging ? divergingBucket(Number(d[valueKey]) / max) : seriesColor(0)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
