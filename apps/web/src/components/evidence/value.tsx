"use client";

import { ArrowDown, ArrowUp, Clock, Lock, Search } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StatefulValue } from "@/lib/domain/states";
import { formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The ONLY way a market-sensitive value reaches the screen.
 *
 * Keeps the four states distinct — missing ≠ stale ≠ zero ≠ confirmed negative —
 * and guarantees that a colour cue is always paired with a glyph and a sign.
 */
export function Value({
  value,
  kind = "ratio",
  decimals,
  signed = false,
  className,
  tabular = true,
}: {
  value: StatefulValue | null | undefined;
  kind?: "price" | "percent" | "ratio" | "integer" | "money" | "score" | "multiple";
  decimals?: number;
  signed?: boolean;
  className?: string;
  tabular?: boolean;
}) {
  const f = formatValue(value, { kind, decimals, signed });

  const tone = {
    primary: "text-foreground",
    secondary: "text-ink-secondary",
    muted: "text-muted-foreground",
    gain: "text-[var(--gain)]",
    loss: "text-[var(--loss)]",
  }[f.tone];

  const Glyph =
    f.glyph === "up" ? ArrowUp : f.glyph === "down" ? ArrowDown : f.glyph === "clock" ? Clock
      : f.glyph === "lock" ? Lock : f.glyph === "review" ? Search : null;

  const body = (
    <span className={cn("inline-flex items-center gap-1", tone, tabular && "tnum", className)}>
      {Glyph ? <Glyph className="size-3 shrink-0" aria-hidden /> : null}
      <span>{f.text}</span>
    </span>
  );

  if (!f.title) return body;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline-offset-4 decoration-dotted hover:underline">{body}</span>
      </TooltipTrigger>
      <TooltipContent>{f.title}</TooltipContent>
    </Tooltip>
  );
}

/** Signed change with mandatory glyph + sign. Colour is reinforcement only. */
export function DeltaValue({
  value,
  kind = "percent",
  decimals = 2,
  className,
}: {
  value: string | number | null | undefined;
  kind?: "percent" | "ratio" | "price";
  decimals?: number;
  className?: string;
}) {
  const stateful: StatefulValue =
    value === null || value === undefined
      ? { value: null, state: "unavailable", reason: "No comparison value available." }
      : { value: String(value), state: "available" };
  return <Value value={stateful} kind={kind} decimals={decimals} signed className={className} />;
}
