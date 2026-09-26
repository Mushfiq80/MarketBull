import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSessionDate } from "@/lib/format";

const STATUS_VARIANT: Record<string, "good" | "warning" | "serious" | "critical" | "muted"> = {
  final_finding: "critical",
  proceeding: "serious",
  interim_order: "serious",
  allegation: "warning",
  resolved: "good",
  reversed: "muted",
};

const STATUS_COPY: Record<string, string> = {
  final_finding: "A final official finding.",
  proceeding: "An open official proceeding. Not a finding.",
  interim_order: "An interim order. Not a final finding.",
  allegation: "An allegation, attributed to its source. Not established.",
  resolved: "Resolved.",
  reversed: "Reversed or set aside.",
};

/**
 * Governance and regulatory history.
 *
 * The status distinction is load-bearing: an allegation, an interim order, a
 * final finding and a reversal are different things, and only a final finding
 * is described as a finding.
 */
export function GovernancePanel({ actions, flags }: { actions: any[]; flags: any[] }) {
  if (!actions.length && !flags.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Governance &amp; regulatory</CardTitle></CardHeader>
        <EmptyState
          reason="no_data"
          detail="No regulatory actions or governance flags recorded. That is an absence of records, not a clean bill of health."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Regulatory record</CardTitle>
          <p className="text-muted-foreground text-xs">
            Only a final official finding is described as a finding. Everything else stays attributed.
          </p>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-muted-foreground text-xs">No regulatory actions on file.</p>
          ) : (
            <ul className="divide-y">
              {actions.map((a) => (
                <li key={a.id} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_VARIANT[a.status] ?? "muted"}>
                      {String(a.status).replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="outline">{a.authority}</Badge>
                    <Badge variant="muted">{a.severity}</Badge>
                    {a.issueDate ? (
                      <span className="text-muted-foreground ml-auto text-xs">
                        {formatSessionDate(a.issueDate)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm">{a.subject}</p>
                  <p className="text-muted-foreground text-xs">{STATUS_COPY[a.status] ?? ""}</p>
                  {a.appealContext ? (
                    <p className="text-muted-foreground text-xs">Appeal context: {a.appealContext}</p>
                  ) : null}
                  {a.officialUrl ? (
                    <a
                      href={a.officialUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary text-xs hover:underline"
                    >
                      Official source
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Governance flags</CardTitle>
          <p className="text-muted-foreground text-xs">
            Derived indicators feeding the X pillar. Reviewable before they drive an exclusion.
          </p>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <p className="text-muted-foreground text-xs">No flags raised.</p>
          ) : (
            <ul className="divide-y">
              {flags.map((f) => (
                <li key={f.id} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={f.severity === "critical" ? "critical" : f.severity === "high" ? "serious" : "warning"}>
                      {String(f.flagType).replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="muted">{f.reviewState}</Badge>
                  </div>
                  <p className="text-sm">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
