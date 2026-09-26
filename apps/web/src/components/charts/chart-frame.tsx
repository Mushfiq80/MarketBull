"use client";

import * as React from "react";
import { Table2, LineChart as LineChartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Every chart is wrapped in this. It provides the mandatory table-view toggle,
 * which serves two purposes: accessibility, and the light-mode contrast relief
 * required for the aqua/yellow/magenta series slots.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  tableColumns,
  tableRows,
  height = 260,
  actions,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  legend?: { label: string; color: string }[];
  tableColumns: string[];
  tableRows: (string | number | null)[][];
  height?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = React.useState<"chart" | "table">("chart");

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          {title ? <p className="truncate text-sm font-medium">{title}</p> : null}
          {subtitle ? <p className="text-muted-foreground truncate text-xs">{subtitle}</p> : null}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={view === "chart" ? "Show as table" : "Show as chart"}
            onClick={() => setView(view === "chart" ? "table" : "chart")}
          >
            {view === "chart" ? <Table2 className="size-3.5" /> : <LineChartIcon className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Legend is always present for ≥2 series; identity is never colour-alone. */}
      {legend && legend.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          {legend.map((l) => (
            <span key={l.label} className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className="inline-block size-2 rounded-[2px]" style={{ backgroundColor: l.color }} aria-hidden />
              {l.label}
            </span>
          ))}
        </div>
      ) : null}

      {view === "chart" ? (
        <div style={{ height }}>{children}</div>
      ) : (
        <div className="max-h-[320px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {tableColumns.map((c, i) => (
                  <TableHead key={c} className={i > 0 ? "text-right" : undefined}>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => (
                    <TableCell key={ci} className={ci > 0 ? "tnum text-right" : undefined}>
                      {cell ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {tableRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tableColumns.length} className="text-muted-foreground text-center">
                    No data
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
