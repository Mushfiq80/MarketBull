import Link from "next/link";

import { EmptyState } from "@/components/shell/empty-state";
import { GateBadge } from "@/components/evidence/gate-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { GateState } from "@/lib/domain/states";
import { cn } from "@/lib/utils";

export function PeerTable({ rows, currentIssuerId }: { rows: any[]; currentIssuerId: string }) {
  if (!rows.length) {
    return (
      <Card>
        <EmptyState reason="no_data" detail="No peer group defined and no sector classification to fall back on." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Peer comparison</CardTitle>
        <p className="text-muted-foreground text-xs">
          Peer groups are documented, not inferred. A sector-based fallback is used when no explicit
          peer group is recorded — sector peers can differ materially in business model.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>Company</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Conviction</TableHead>
              <TableHead>Gate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.issuerId} className={cn(r.issuerId === currentIssuerId && "bg-secondary/50")}>
                <TableCell>
                  <Link href={`/issuers/${r.issuerId}`} className="tnum font-medium hover:underline">
                    {r.ticker}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[320px] truncate">{r.name}</TableCell>
                <TableCell className="tnum text-right">
                  {r.composite ? Number(r.composite).toFixed(1) : "—"}
                </TableCell>
                <TableCell className="tnum text-right">
                  {r.conviction ? Number(r.conviction).toFixed(0) : "—"}
                </TableCell>
                <TableCell>
                  {r.gateState ? <GateBadge state={r.gateState as GateState} /> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
