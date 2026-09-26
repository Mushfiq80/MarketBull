import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RiskPanel({ score, report }: { score: any; report: any | null }) {
  const risks = (report?.keyRisks ?? []) as { risk: string; severity: string }[];
  const gaps = (report?.dataGaps ?? []) as string[];
  const triggers = (score.gateTriggers ?? []) as { gate: string; reason: string }[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Risks &amp; data gaps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {triggers.length ? (
          <section>
            <p className="text-muted-foreground mb-1 font-medium">Active gates</p>
            <ul className="space-y-1.5">
              {triggers.map((t) => (
                <li key={t.gate}>
                  <Badge variant="serious">{t.gate.replace(/_/g, " ")}</Badge>
                  <p className="text-muted-foreground mt-0.5">{t.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {risks.length ? (
          <section>
            <p className="text-muted-foreground mb-1 font-medium">Key risks</p>
            <ul className="space-y-1">
              {risks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <Badge variant={r.severity === "high" || r.severity === "critical" ? "critical" : "warning"}>
                    {r.severity}
                  </Badge>
                  <span>{r.risk}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <p className="text-muted-foreground mb-1 font-medium">Data gaps</p>
          {gaps.length ? (
            <ul className="text-muted-foreground list-disc space-y-0.5 pl-4">
              {gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Data completeness{" "}
              <span className="tnum text-foreground">
                {score.dataCompleteness ? `${Number(score.dataCompleteness).toFixed(0)}%` : "—"}
              </span>
              . Missing inputs reduce conviction; they are never treated as neutral or safe.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
