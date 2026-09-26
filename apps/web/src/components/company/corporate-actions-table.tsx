import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Value } from "@/components/evidence/value";
import { formatSessionDate, stateful } from "@/lib/format";

export function CorporateActionsTable({ rows }: { rows: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Corporate actions</CardTitle>
        <p className="text-muted-foreground text-xs">
          The ledger that makes per-share values and historical prices comparable. Conflicting
          records are preserved and flagged rather than auto-resolved.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground px-4 pb-4 text-xs">No corporate actions on file.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Announced</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Ex-date</TableHead>
                <TableHead className="text-right">Ratio</TableHead>
                <TableHead className="text-right">Cash/share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Badge variant="outline">{String(a.actionType).replace(/_/g, " ")}</Badge>
                      {a.conflictsWith ? (
                        <Badge variant="warning" className="gap-1" title="Sources disagree on this action">
                          <AlertTriangle className="size-2.5" aria-hidden /> conflict
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{formatSessionDate(a.announcementDate)}</TableCell>
                  <TableCell>{formatSessionDate(a.recordDate)}</TableCell>
                  <TableCell>{formatSessionDate(a.exDate)}</TableCell>
                  <TableCell className="text-right"><Value value={stateful(a.ratio)} kind="ratio" decimals={4} /></TableCell>
                  <TableCell className="text-right"><Value value={stateful(a.cashAmountPerShare)} kind="price" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
