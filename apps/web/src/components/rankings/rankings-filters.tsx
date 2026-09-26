"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Horizon } from "@/lib/domain/states";

const ALL = "__all__";

/** Filters live in one row above the table. */
export function RankingsFilters({
  horizon,
  sectors,
}: {
  horizon: Horizon;
  sectors: (string | null)[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    router.push(`/rankings?${next.toString()}`);
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select value={params.get("sector") ?? ALL} onValueChange={(v) => update("sector", v)}>
        <SelectTrigger className="h-8 w-[190px] text-xs">
          <SelectValue placeholder="All sectors" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All sectors</SelectItem>
          {sectors.filter(Boolean).map((s) => (
            <SelectItem key={s!} value={s!}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get("gate") ?? "eligible"} onValueChange={(v) => update("gate", v)}>
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="eligible">Eligible only</SelectItem>
          <SelectItem value="all">Include gated</SelectItem>
          <SelectItem value="review_required">Review required</SelectItem>
          <SelectItem value="restricted">Restricted</SelectItem>
          <SelectItem value="excluded">Excluded</SelectItem>
        </SelectContent>
      </Select>

      <Select value={params.get("shariah") ?? ALL} onValueChange={(v) => update("shariah", v)}>
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <SelectValue placeholder="Any screen status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any screen status</SelectItem>
          <SelectItem value="pass">Shariah: pass</SelectItem>
          <SelectItem value="undetermined">Shariah: undetermined</SelectItem>
          <SelectItem value="fail">Shariah: fail</SelectItem>
        </SelectContent>
      </Select>

      <Select value={params.get("minTurnover") ?? ALL} onValueChange={(v) => update("minTurnover", v)}>
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue placeholder="Any liquidity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any liquidity</SelectItem>
          <SelectItem value="500000">Turnover ≥ 5 lakh</SelectItem>
          <SelectItem value="5000000">Turnover ≥ 50 lakh</SelectItem>
          <SelectItem value="20000000">Turnover ≥ 2 crore</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="outline" size="sm" className="ml-auto h-8 text-xs" asChild>
        <a href={`/api/v1/rankings/${horizon}/export?${params.toString()}`}>
          <Download className="size-3.5" /> CSV
        </a>
      </Button>
    </div>
  );
}
