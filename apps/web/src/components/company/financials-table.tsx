import { Lock } from "lucide-react";

import { EvidenceSheet } from "@/components/evidence/evidence-sheet";
import { Value } from "@/components/evidence/value";
import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SECTOR_PROFILES, type ScorecardTemplate } from "@/lib/domain/sectors";
import { formatSessionDate, stateful } from "@/lib/format";

/**
 * Reported financials by period.
 *
 * Sector-inapplicable metrics are shown as DISABLED with the reason, rather than
 * being computed meaninglessly or silently omitted — the reader should know the
 * difference between "not reported" and "not meaningful here".
 */
export function FinancialsTable({ rows, template }: { rows: any[]; template: ScorecardTemplate }) {
  if (!rows.length) {
    return (
      <Card>
        <EmptyState
          reason="no_data"
          detail="No financial facts on file. They are extracted from annual and quarterly reports by the document pipeline, with human review for low-confidence fields."
        />
      </Card>
    );
  }

  const periods = [...new Set(rows.map((r) => r.periodEnd))].sort().reverse().slice(0, 6);
  const metrics = [...new Set(rows.map((r) => r.metric))].sort();
  const profile = SECTOR_PROFILES[template];

  const lookup = new Map<string, any>();
  for (const r of rows) lookup.set(`${r.metric}:${r.periodEnd}`, r);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Reported financials</CardTitle>
        <p className="text-muted-foreground text-xs">
          As reported by the issuer. BABull-derived ratios live separately so the two can never be
          confused. Scorecard template: <strong>{profile.label}</strong>.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="max-h-[520px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Metric</TableHead>
                {periods.map((p) => (
                  <TableHead key={p} className="text-right">
                    {formatSessionDate(p)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((metric) => {
                const disabledReason = profile.disabledMetrics[metric];
                return (
                  <TableRow key={metric}>
                    <TableCell className="text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        {metric.replace(/_/g, " ")}
                        {disabledReason ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Badge variant="muted" className="cursor-help gap-1">
                                  <Lock className="size-2.5" aria-hidden /> n/a
                                </Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{disabledReason}</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </span>
                    </TableCell>
                    {periods.map((p) => {
                      const row = lookup.get(`${metric}:${p}`);
                      return (
                        <TableCell key={p} className="text-right">
                          {disabledReason ? (
                            <span className="text-muted-foreground">n/a</span>
                          ) : row ? (
                            <EvidenceSheet
                              title={`${metric.replace(/_/g, " ")} · ${formatSessionDate(p)}`}
                              items={[
                                {
                                  id: `${metric}-${p}`,
                                  kind: "document",
                                  summary: `${metric.replace(/_/g, " ")} reported as ${row.value} ${row.unit}.`,
                                  pageRef: row.pageRef,
                                  asOf: row.publishedAt,
                                  claimStatus: "confirmed_document",
                                  sourceAuthority: "official_filing",
                                },
                              ]}
                            >
                              <span className="inline-flex items-center gap-1">
                                <Value value={stateful(row.value)} kind="money" />
                                {row.isRestatement ? (
                                  <Badge variant="warning" title="Restated figure">R</Badge>
                                ) : null}
                              </span>
                            </EvidenceSheet>
                          ) : (
                            <Value value={stateful(null)} />
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
