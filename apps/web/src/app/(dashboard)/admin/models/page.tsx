import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shell/empty-state";
import { modelRegistry, recentDrift } from "@/db/queries/quality";
import { formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Models" };

export default async function ModelsPage() {
  const [models, drift] = await Promise.all([modelRegistry(), recentDrift(40)]);

  return (
    <>
      <PageHeader
        title="Model registry"
        description="Versions, validation state and drift. Historical published scores are never recomputed."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Versions</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {models.length === 0 ? (
            <EmptyState
              reason="not_computed"
              detail="No model versions registered yet. They are recorded the first time a pipeline runs."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Family</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Config hash</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Promoted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.family}</TableCell>
                    <TableCell className="tnum">{m.version}</TableCell>
                    <TableCell className="tnum text-muted-foreground text-xs">{m.configHash}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          m.state === "promoted"
                            ? "good"
                            : m.state === "validated"
                              ? "outline"
                              : m.state === "rolled_back"
                                ? "critical"
                                : "muted"
                        }
                      >
                        {String(m.state).replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{m.isActive ? <Badge variant="good">active</Badge> : "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs">
                      {m.promotedAt ? formatTimestamp(m.promotedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle>Drift observations</CardTitle>
          <p className="text-muted-foreground text-xs">
            A model that was validated once and never watched is a model being trusted on faith.
          </p>
        </CardHeader>
        <CardContent className="px-0">
          {drift.length === 0 ? (
            <p className="text-muted-foreground px-4 pb-4 text-xs">No drift observations recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Baseline</TableHead>
                  <TableHead>Breach</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drift.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">
                      {d.modelFamily} {d.modelVersion}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {String(d.driftKind).replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-xs">{d.metric}</TableCell>
                    <TableCell className="tnum text-right">{d.value ?? "—"}</TableCell>
                    <TableCell className="tnum text-muted-foreground text-right">
                      {d.baselineValue ?? "—"}
                    </TableCell>
                    <TableCell>
                      {d.breachedThreshold ? <Badge variant="critical">breached</Badge> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
