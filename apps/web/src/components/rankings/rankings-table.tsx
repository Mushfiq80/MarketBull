"use client";

import * as React from "react";
import Link from "next/link";
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { ConfidenceChip } from "@/components/evidence/confidence-chip";
import { GateBadge } from "@/components/evidence/gate-badge";
import { ScoreInspector, type ScoreDetail } from "@/components/evidence/score-inspector";
import { ScoreStamp } from "@/components/evidence/score-stamp";
import { DeltaValue, Value } from "@/components/evidence/value";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { GateState, Horizon } from "@/lib/domain/states";
import { stateful } from "@/lib/format";
import { cn } from "@/lib/utils";

export type RankingRowView = {
  instrumentId: string;
  issuerId: string;
  ticker: string;
  name: string;
  sector: string | null;
  rank: number | null;
  composite: string | null;
  fundamentalsScore: string | null;
  opportunityScore: string | null;
  exposureQualityScore: string | null;
  conviction: string | null;
  gateState: GateState;
  gateTriggers: { gate: string; reason: string }[] | null;
  compositeDelta: string | null;
  rankDelta: number | null;
  close: string | null;
  turnover: string | null;
  dataCompleteness: string | null;
  modelVersion: string;
  asOf: string;
  usedSampleData: boolean;
  scoreSnapshotId: string;
  shariahStatus: string | null;
  factorValues?: Record<string, number | null>;
  effectiveWeights?: Record<string, unknown>;
};

export function RankingsTable({ rows, horizon }: { rows: RankingRowView[]; horizon: Horizon }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "composite", desc: true }]);

  const columns = React.useMemo<ColumnDef<RankingRowView>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        accessorFn: (r) => r.rank ?? Number.MAX_SAFE_INTEGER,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <span className="tnum text-muted-foreground">{row.original.rank ?? "—"}</span>
            {row.original.rankDelta ? (
              <span
                className={cn(
                  "tnum text-[10px]",
                  row.original.rankDelta > 0 ? "text-[var(--gain)]" : "text-[var(--loss)]",
                )}
                title={`Moved ${Math.abs(row.original.rankDelta)} place(s) since the previous snapshot`}
              >
                {row.original.rankDelta > 0 ? "▲" : "▼"}
                {Math.abs(row.original.rankDelta)}
              </span>
            ) : null}
          </div>
        ),
        size: 70,
      },
      {
        id: "ticker",
        header: "Instrument",
        accessorKey: "ticker",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link href={`/issuers/${row.original.issuerId}`} className="tnum font-medium hover:underline">
              {row.original.ticker}
            </Link>
            <p className="text-muted-foreground truncate text-xs">{row.original.name}</p>
          </div>
        ),
      },
      {
        id: "sector",
        header: "Sector",
        accessorKey: "sector",
        cell: ({ row }) => (
          <span className="text-muted-foreground truncate text-xs">{row.original.sector ?? "—"}</span>
        ),
      },
      {
        id: "composite",
        header: "Score",
        accessorFn: (r) => (r.composite === null ? -1 : Number(r.composite)),
        cell: ({ row }) => {
          const r = row.original;
          const detail: ScoreDetail = {
            id: r.scoreSnapshotId,
            ticker: r.ticker,
            name: r.name,
            horizon,
            asOf: r.asOf,
            modelVersion: r.modelVersion,
            composite: r.composite,
            fundamentals: r.fundamentalsScore,
            opportunity: r.opportunityScore,
            exposureQuality: r.exposureQualityScore,
            conviction: r.conviction,
            dataCompleteness: r.dataCompleteness,
            gateState: r.gateState,
            gateTriggers: r.gateTriggers,
            effectiveWeights: r.effectiveWeights ?? {},
            factorValues: r.factorValues ?? {},
            usedSampleData: r.usedSampleData,
          };
          return (
            // Every score is clickable into its components and evidence.
            <ScoreInspector detail={detail}>
              <span className="flex items-baseline gap-1.5">
                <span className="tnum text-sm font-semibold">
                  {r.composite ? Number(r.composite).toFixed(1) : "—"}
                </span>
                <ScoreStamp horizon={horizon} modelVersion={r.modelVersion} asOf={r.asOf} />
              </span>
            </ScoreInspector>
          );
        },
      },
      {
        id: "delta",
        header: "Δ score",
        accessorFn: (r) => (r.compositeDelta === null ? 0 : Number(r.compositeDelta)),
        cell: ({ row }) => <DeltaValue value={row.original.compositeDelta} kind="ratio" decimals={1} />,
      },
      {
        id: "pillars",
        header: "F / O / Xq",
        cell: ({ row }) => (
          <span className="tnum text-muted-foreground text-xs">
            {fmt(row.original.fundamentalsScore)} / {fmt(row.original.opportunityScore)} /{" "}
            {fmt(row.original.exposureQualityScore)}
          </span>
        ),
      },
      {
        id: "conviction",
        header: "Conviction",
        accessorFn: (r) => (r.conviction === null ? -1 : Number(r.conviction)),
        cell: ({ row }) => <ConfidenceChip conviction={row.original.conviction} />,
      },
      {
        id: "gate",
        header: "Gate",
        accessorKey: "gateState",
        cell: ({ row }) => (
          <GateBadge state={row.original.gateState} triggers={row.original.gateTriggers} />
        ),
      },
      {
        id: "shariah",
        header: "Screen",
        accessorKey: "shariahStatus",
        cell: ({ row }) => {
          const s = row.original.shariahStatus;
          if (!s) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <Badge variant={s === "pass" ? "good" : s === "fail" ? "critical" : "warning"}>
              {s === "undetermined" ? "undet." : s}
            </Badge>
          );
        },
      },
      {
        id: "close",
        header: "Price",
        accessorFn: (r) => (r.close === null ? -1 : Number(r.close)),
        cell: ({ row }) => <Value value={stateful(row.original.close)} kind="price" />,
      },
      {
        id: "turnover",
        header: "Turnover",
        accessorFn: (r) => (r.turnover === null ? -1 : Number(r.turnover)),
        cell: ({ row }) => <Value value={stateful(row.original.turnover)} kind="money" />,
      },
    ],
    [horizon],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="max-h-[calc(100vh-18rem)] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const numeric = ["composite", "delta", "close", "turnover", "conviction", "rank"].includes(
                  header.column.id,
                );
                return (
                  <TableHead key={header.id} className={numeric ? "text-right" : undefined}>
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-foreground",
                          numeric && "flex-row-reverse",
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {/* Explicit arrow — sort direction is never implied by position alone. */}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-30" />
                        )}
                      </button>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(row.original.gateState === "excluded" && "opacity-55")}
            >
              {row.getVisibleCells().map((cell) => {
                const numeric = ["composite", "delta", "close", "turnover", "conviction", "rank"].includes(
                  cell.column.id,
                );
                return (
                  <TableCell key={cell.id} className={numeric ? "text-right" : undefined}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function fmt(v: string | null) {
  return v === null ? "—" : Number(v).toFixed(0);
}
