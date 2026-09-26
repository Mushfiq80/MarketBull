import Link from "next/link";

import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { searchIssuers } from "@/db/queries/issuers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies" };

export default async function IssuersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const rows = await searchIssuers(params.q, params.sector, 200);

  return (
    <>
      <PageHeader
        title="Companies"
        description={params.q ? `Results for “${params.q}”` : "Every instrument in the master, with its current listing status."}
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            reason="no_data"
            detail={
              params.q
                ? `Nothing matched “${params.q}”. Historical tickers resolve too, so an empty result usually means the instrument master has not been ingested.`
                : undefined
            }
          />
        </Card>
      ) : (
        <div className="max-h-[calc(100vh-14rem)] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.instrumentId}>
                  <TableCell>
                    <Link href={`/issuers/${r.issuerId}`} className="tnum font-medium hover:underline">
                      {r.ticker}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[420px] truncate">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.sector ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.listingStatus === "listed" ? "good" : "warning"}>
                      {r.listingStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
