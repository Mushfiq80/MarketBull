import { AlertTriangle } from "lucide-react";

import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Value } from "@/components/evidence/value";
import { formatSessionDate, stateful } from "@/lib/format";

/**
 * People and relationships. Identity resolution is deliberately conservative:
 * two similar names are not merged without corroborating evidence, and any
 * uncertainty is shown rather than hidden.
 */
export function RelationshipPanel({ people }: { people: any[] }) {
  if (!people.length) {
    return (
      <Card>
        <CardHeader><CardTitle>People &amp; relationships</CardTitle></CardHeader>
        <EmptyState reason="no_data" detail="No director or executive records on file for this issuer." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>People &amp; relationships</CardTitle>
        <p className="text-muted-foreground text-xs">
          Each edge carries its source, dates and confidence. Similar names are never merged on
          name alone.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {people.map((p) => (
            <li key={p.edgeId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium">{p.personName ?? "Unnamed"}</span>
              <Badge variant="outline">{String(p.edgeType).replace(/_/g, " ").toLowerCase()}</Badge>
              {p.role ? <span className="text-muted-foreground text-xs">{p.role}</span> : null}
              {p.stakePercent ? (
                <span className="text-xs">
                  <Value value={stateful(p.stakePercent)} kind="percent" />
                </span>
              ) : null}
              {p.personPossibleDuplicateOf ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Badge variant="warning" className="gap-1">
                        <AlertTriangle className="size-3" aria-hidden /> identity uncertain
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    This person record may be the same individual as another. They are kept separate
                    until corroborating evidence establishes the link.
                  </TooltipContent>
                </Tooltip>
              ) : null}
              {p.isBeneficialOwnershipClaim === "yes" ? (
                <Badge variant="serious">beneficial ownership claim</Badge>
              ) : null}
              <span className="text-muted-foreground ml-auto text-xs">
                {p.validFrom ? formatSessionDate(p.validFrom) : "start unknown"}
                {p.validTo ? ` → ${formatSessionDate(p.validTo)}` : " → present"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
