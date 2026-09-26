import { AlertTriangle, CircleCheck, Clock, HelpCircle } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdapterVerifyPanel } from "@/components/admin/adapter-verify-panel";
import { openIssues, recentRuns, sourceHealth } from "@/db/queries/quality";
import { formatAge, formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data quality" };

export default async function DataQualityPage() {
  const [sources, runs, issues] = await Promise.all([sourceHealth(), recentRuns(25), openIssues({ limit: 50 })]);

  const now = Date.now();
  const enriched = sources.map((s) => {
    const lag = s.lastSuccessAt ? (now - s.lastSuccessAt.getTime()) / 60000 : null;
    const budget = s.freshnessBudgetMinutes ?? 1440;
    const state = !s.lastSuccessAt
      ? "never_run"
      : s.lastErrorState
        ? "unavailable"
        : lag !== null && lag > budget
          ? "stale"
          : "ok";
    return { ...s, lag, budget, state };
  });

  const neverRun = enriched.filter((s) => s.state === "never_run");

  return (
    <>
      <PageHeader
        title="Data quality"
        description="Source freshness, ingestion runs and open issues. Nothing here is silently corrected."
      />

      {neverRun.length === enriched.length && enriched.length > 0 ? (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>No source has been ingested yet</AlertTitle>
          <AlertDescription>
            The DSE adapters have never seen a live response — the machine this was built on could not
            reach dse.com.bd. Verify each adapter first with the panel below: it fetches, parses and
            reports field by field <strong>without writing to the database</strong>. Read the report,
            fix the column synonyms, then ingest.
          </AlertDescription>
        </Alert>
      ) : null}

      <AdapterVerifyPanel adapters={enriched.map((s) => s.sourceId)} />

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Last success</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead>Rights</TableHead>
                <TableHead>Parser</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map((s) => (
                <TableRow key={s.sourceId}>
                  <TableCell className="font-medium">{s.sourceId}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {String(s.sourceType).replace(/_/g, " ")}
                  </TableCell>
                  <TableCell>
                    <StateBadge state={s.state} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {s.lastSuccessAt ? formatAge(s.lastSuccessAt) : "never"}
                  </TableCell>
                  <TableCell className="tnum text-muted-foreground text-right text-xs">
                    {s.budget >= 1440 ? `${Math.round(s.budget / 1440)}d` : `${s.budget}m`}
                  </TableCell>
                  <TableCell className="text-xs">
                    <RightsBadges rights={s.rights as never} />
                  </TableCell>
                  <TableCell className="tnum text-muted-foreground text-xs">
                    {s.parserVersion ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {enriched.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-center">
                    No sources registered. Run `npm run db:seed:reference`.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Recent ingestion runs</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Adapter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Written</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.adapter}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "succeeded" ? "good" : r.status === "partial" ? "warning" : "critical"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="tnum text-right">{r.rowsWritten}</TableCell>
                    <TableCell className="tnum text-right">{r.rowsRejected}</TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs">
                      {formatAge(r.startedAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground text-center">
                      No ingestion runs recorded.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Open issues</CardTitle>
            <p className="text-muted-foreground text-xs">
              Parse failures and source conflicts become rows here rather than being quietly fixed.
            </p>
          </CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <p className="text-muted-foreground text-xs">No open data-quality issues.</p>
            ) : (
              <ul className="divide-y">
                {issues.map((i) => (
                  <li key={i.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={
                          i.severity === "critical" || i.severity === "high"
                            ? "critical"
                            : i.severity === "medium"
                              ? "warning"
                              : "muted"
                        }
                      >
                        {i.severity}
                      </Badge>
                      <Badge variant="outline">{String(i.issueKind).replace(/_/g, " ")}</Badge>
                      {i.sourceId ? <span className="text-muted-foreground text-xs">{i.sourceId}</span> : null}
                      <span className="text-muted-foreground ml-auto text-xs">
                        {formatTimestamp(i.detectedAt, { withTime: true })}
                      </span>
                    </div>
                    <p className="text-xs">{i.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StateBadge({ state }: { state: string }) {
  if (state === "ok") {
    return (
      <Badge variant="good" className="gap-1">
        <CircleCheck className="size-3" aria-hidden /> live
      </Badge>
    );
  }
  if (state === "stale") {
    return (
      <Badge variant="warning" className="gap-1">
        <Clock className="size-3" aria-hidden /> stale
      </Badge>
    );
  }
  if (state === "unavailable") {
    return (
      <Badge variant="critical" className="gap-1">
        <AlertTriangle className="size-3" aria-hidden /> failing
      </Badge>
    );
  }
  return (
    <Badge variant="muted" className="gap-1">
      <HelpCircle className="size-3" aria-hidden /> never run
    </Badge>
  );
}

function RightsBadges({
  rights,
}: {
  rights: { userDisplay?: boolean; redistribution?: boolean; fullText?: boolean } | null;
}) {
  if (!rights) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={rights.userDisplay ? "good" : "muted"}>display</Badge>
      <Badge variant={rights.redistribution ? "good" : "muted"}>redistribute</Badge>
      <Badge variant={rights.fullText ? "good" : "muted"}>full text</Badge>
    </span>
  );
}
