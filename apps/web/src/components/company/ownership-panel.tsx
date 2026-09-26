import { EmptyState } from "@/components/shell/empty-state";
import { Value } from "@/components/evidence/value";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSessionDate, stateful } from "@/lib/format";

/**
 * Sponsor/director shareholding moves matter more on DSE than in deep markets,
 * so this is a dated series rather than a single current snapshot.
 */
export function OwnershipPanel({ snapshots }: { snapshots: any[] }) {
  if (!snapshots.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Shareholding</CardTitle></CardHeader>
        <EmptyState reason="no_data" detail="No disclosed shareholding snapshots on file." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Shareholding composition</CardTitle>
        <p className="text-muted-foreground text-xs">
          As disclosed by the issuer. A disclosed holding is not necessarily ultimate beneficial
          ownership, and BABull does not assert the latter without a source that establishes it.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>As of</TableHead>
              <TableHead className="text-right">Sponsor/dir</TableHead>
              <TableHead className="text-right">Govt</TableHead>
              <TableHead className="text-right">Institution</TableHead>
              <TableHead className="text-right">Foreign</TableHead>
              <TableHead className="text-right">Public</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{formatSessionDate(s.asOfDate)}</TableCell>
                <TableCell className="text-right"><Value value={stateful(s.sponsorDirectorPct)} kind="percent" /></TableCell>
                <TableCell className="text-right"><Value value={stateful(s.governmentPct)} kind="percent" /></TableCell>
                <TableCell className="text-right"><Value value={stateful(s.institutionalPct)} kind="percent" /></TableCell>
                <TableCell className="text-right"><Value value={stateful(s.foreignPct)} kind="percent" /></TableCell>
                <TableCell className="text-right"><Value value={stateful(s.publicPct)} kind="percent" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
