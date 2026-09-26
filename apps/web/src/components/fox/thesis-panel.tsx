import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EvidenceSheet } from "@/components/evidence/evidence-sheet";

/**
 * Thesis, counter-thesis and invalidation conditions.
 *
 * The counter-thesis is not optional decoration: a research product that only
 * argues one side is a sales document.
 */
export function ThesisPanel({ report }: { report: any | null }) {
  if (!report) return null;

  const invalidation = (report.invalidationConditions ?? []) as {
    condition: string;
    direction: "confirms" | "weakens" | "invalidates";
  }[];
  const changes = (report.changesSincePrevious ?? []) as {
    kind: "positive" | "negative";
    detail: string;
  }[];
  const bindings = (report.evidenceBindings ?? []) as {
    claim: string;
    evidenceIds: string[];
    kind: "fact" | "inference";
  }[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Thesis &amp; counter-thesis</CardTitle>
        {report.sampleWatermark ? (
          <Badge variant="warning">SAMPLE — NOT RESEARCH</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {report.thesis ? (
          <section>
            <p className="text-muted-foreground mb-1 text-[11px] tracking-wide uppercase">Thesis</p>
            <p>{report.thesis}</p>
          </section>
        ) : null}

        {report.counterThesis ? (
          <section>
            <p className="text-muted-foreground mb-1 text-[11px] tracking-wide uppercase">
              Counter-thesis
            </p>
            <p>{report.counterThesis}</p>
          </section>
        ) : null}

        {changes.length ? (
          <section>
            <p className="text-muted-foreground mb-1 text-[11px] tracking-wide uppercase">
              Changed since last analysis
            </p>
            <ul className="space-y-1">
              {changes.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <Badge variant={c.kind === "positive" ? "good" : "serious"}>{c.kind}</Badge>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {invalidation.length ? (
          <section>
            <p className="text-muted-foreground mb-1 text-[11px] tracking-wide uppercase">
              What would confirm, weaken or invalidate this
            </p>
            <ul className="space-y-1">
              {invalidation.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <Badge
                    variant={
                      c.direction === "confirms" ? "good" : c.direction === "weakens" ? "warning" : "critical"
                    }
                  >
                    {c.direction}
                  </Badge>
                  <span>{c.condition}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {bindings.length ? (
          <section className="border-t pt-3">
            <p className="text-muted-foreground mb-1 text-[11px] tracking-wide uppercase">
              Claim provenance
            </p>
            <ul className="space-y-1">
              {bindings.map((b, i) => (
                <li key={i} className="text-xs">
                  <EvidenceSheet
                    title={b.claim}
                    items={b.evidenceIds.map((id) => ({
                      id,
                      kind: "document" as const,
                      summary: "Supporting evidence record.",
                    }))}
                  >
                    <span className="flex items-start gap-2">
                      <Badge variant={b.kind === "fact" ? "good" : "muted"}>{b.kind}</Badge>
                      <span className="text-muted-foreground">{b.claim}</span>
                    </span>
                  </EvidenceSheet>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-2 text-xs">
              Every statement is labelled as a documented fact or as model inference. Inference is
              never presented as fact.
            </p>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
