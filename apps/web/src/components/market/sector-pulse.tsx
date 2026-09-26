"use client";

import Link from "next/link";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { divergingBucket } from "@/lib/charts/theme";
import { formatCompactMoney } from "@/lib/format";

/**
 * Sector heat strip. Diverging blue↔red with a neutral gray midpoint, and the
 * signed number is always printed on the cell so colour is never load-bearing.
 */
export function SectorPulse({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return <p className="text-muted-foreground py-6 text-center text-xs">No sector data for this session.</p>;
  }

  const values = rows.map((r) => Number(r.medianChangePct ?? 0));
  const scale = Math.max(...values.map(Math.abs), 1);

  return (
    <div className="grid grid-cols-2 gap-[2px] sm:grid-cols-3 lg:grid-cols-4">
      {rows.map((r) => {
        const change = r.medianChangePct === null ? null : Number(r.medianChangePct);
        const bg = change === null ? "var(--muted)" : divergingBucket(change / scale);
        return (
          <Tooltip key={r.sector ?? "unclassified"}>
            <TooltipTrigger asChild>
              <Link
                href={`/rankings?sector=${encodeURIComponent(r.sector ?? "")}`}
                className="focus-visible:ring-ring block rounded-sm p-2 transition-opacity hover:opacity-85 focus-visible:ring-2"
                style={{ backgroundColor: bg }}
              >
                <span className="block truncate text-[11px] font-medium text-white mix-blend-luminosity">
                  {r.sector ?? "Unclassified"}
                </span>
                <span className="tnum block text-sm font-semibold text-white mix-blend-luminosity">
                  {change === null ? "—" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)}%`}
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{r.sector ?? "Unclassified"}</p>
              <p className="text-muted-foreground">
                Median change across {r.instrumentCount} instrument{r.instrumentCount === 1 ? "" : "s"}
              </p>
              <p className="text-muted-foreground">
                Turnover {r.totalTurnover ? formatCompactMoney(Number(r.totalTurnover)) : "—"}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
