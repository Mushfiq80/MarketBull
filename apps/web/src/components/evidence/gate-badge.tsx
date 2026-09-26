import { CircleCheck, CircleX, Eye, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GATE_LABELS, type GateState } from "@/lib/domain/states";

const CONFIG: Record<GateState, { variant: "good" | "serious" | "warning" | "critical"; Icon: typeof CircleCheck }> = {
  eligible: { variant: "good", Icon: CircleCheck },
  restricted: { variant: "serious", Icon: ShieldAlert },
  review_required: { variant: "warning", Icon: Eye },
  excluded: { variant: "critical", Icon: CircleX },
};

/**
 * Risk gates are non-compensatory: they are shown as their own state, never
 * folded into the score. A suspended stock with brilliant fundamentals is still
 * un-buyable, and the UI has to say so plainly.
 */
export function GateBadge({
  state,
  triggers,
}: {
  state: GateState;
  triggers?: { gate: string; reason: string }[] | null;
}) {
  const { variant, Icon } = CONFIG[state];
  const active = triggers?.filter(Boolean) ?? [];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant={variant} className="cursor-help gap-1">
            <Icon className="size-3" aria-hidden />
            {GATE_LABELS[state]}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        {active.length ? (
          <ul className="space-y-1">
            {active.map((t) => (
              <li key={t.gate}>
                <span className="font-medium">{t.gate.replace(/_/g, " ")}</span>: {t.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p>No gate triggered. Eligible for this horizon&apos;s ranking.</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
