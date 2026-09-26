import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSessionDate } from "@/lib/format";

/**
 * Shariah screen result.
 *
 * "Unable to determine" is a first-class outcome and is never promoted to a
 * pass. The panel states plainly that this is a screen, not a certification.
 */
export function ShariahPanel({ screen }: { screen: any | null }) {
  if (!screen) {
    return (
      <Card>
        <CardHeader><CardTitle>Shariah screen</CardTitle></CardHeader>
        <EmptyState
          reason="not_computed"
          detail="Not screened yet. Run the screening pipeline after financials are ingested."
        />
      </Card>
    );
  }

  const variant =
    screen.status === "pass" ? "good" : screen.status === "fail" ? "critical" : "warning";
  const business = (screen.businessActivityResults ?? []) as any[];
  const ratios = (screen.financialRatioResults ?? []) as any[];
  const undetermined = (screen.undeterminedReasons ?? []) as string[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          Shariah screen
          <Badge variant={variant}>
            {screen.status === "undetermined" ? "unable to determine" : screen.status}
          </Badge>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          {screen.methodology} v{screen.methodologyVersion} · data as of{" "}
          {formatSessionDate(screen.dataDate)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <section>
          <p className="text-muted-foreground mb-1 font-medium">Business activity</p>
          <ul className="space-y-1">
            {business.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <Badge variant={b.outcome === "pass" ? "good" : b.outcome === "fail" ? "critical" : "warning"}>
                  {b.outcome}
                </Badge>
                <span className="text-muted-foreground">{b.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="text-muted-foreground mb-1 font-medium">Financial ratios</p>
          <ul className="space-y-1">
            {ratios.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <Badge variant={r.outcome === "pass" ? "good" : r.outcome === "fail" ? "critical" : "warning"}>
                  {r.outcome}
                </Badge>
                <span className="flex-1">{String(r.rule).replace(/_/g, " ")}</span>
                <span className="tnum text-muted-foreground">
                  {r.actual ?? "—"} {r.threshold ? `(limit ${r.threshold})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {undetermined.length ? (
          <p className="text-muted-foreground">
            Undetermined because: {undetermined.map((u) => u.replace(/_/g, " ")).join(", ")}.
          </p>
        ) : null}

        <p className="text-muted-foreground border-t pt-2">
          This is a data screen under the named methodology and data date. It is{" "}
          <strong>not a religious certification and not a fatwa</strong>. Where data is missing or
          activity is ambiguous the result is &ldquo;unable to determine&rdquo; — never an assumed pass.
        </p>
      </CardContent>
    </Card>
  );
}
