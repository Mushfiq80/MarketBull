import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceSheet } from "@/components/evidence/evidence-sheet";
import { eventTypeLabel } from "@/lib/domain/event-types";
import { CLAIM_STATUS_LABELS, type ClaimStatus } from "@/lib/domain/states";
import { formatTimestamp } from "@/lib/format";

const VARIANT: Record<ClaimStatus, "good" | "warning" | "serious" | "muted"> = {
  confirmed_document: "good",
  attributed_report: "warning",
  allegation: "serious",
  analyst_interpretation: "muted",
  model_inference: "muted",
};

export function EventTimeline({ events }: { events: any[] }) {
  if (!events.length) {
    return (
      <Card>
        <EmptyState reason="no_data" detail="No events ingested for this issuer yet." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Event timeline</CardTitle>
        <p className="text-muted-foreground text-xs">
          Occurrence time and publication time are tracked separately — the market can only react to
          what has been published.
        </p>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 border-l pl-4">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="bg-border absolute top-1.5 -left-[21px] size-2 rounded-full" aria-hidden />
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{eventTypeLabel(e.eventType)}</Badge>
                <Badge variant={VARIANT[e.claimStatus as ClaimStatus]}>
                  {CLAIM_STATUS_LABELS[e.claimStatus as ClaimStatus]}
                </Badge>
                {e.corroborationCount > 0 ? (
                  <Badge variant="muted">{e.corroborationCount} corroborating</Badge>
                ) : null}
              </div>
              <EvidenceSheet
                title={e.title}
                items={[
                  {
                    id: e.id,
                    kind: e.documentId ? "document" : "external_link",
                    summary: e.summary ?? e.title,
                    url: e.externalUrl,
                    asOf: e.publishedAt,
                    sourceAuthority: e.sourceAuthority,
                    claimStatus: e.claimStatus,
                  },
                ]}
              >
                <p className="mt-1 text-sm">{e.title}</p>
              </EvidenceSheet>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {e.eventAt ? `Occurred ${formatTimestamp(e.eventAt, { withTime: true })}` : "Occurrence time unknown"}
                {" · "}
                {e.publishedAt ? `published ${formatTimestamp(e.publishedAt, { withTime: true })}` : "publication time unknown"}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
