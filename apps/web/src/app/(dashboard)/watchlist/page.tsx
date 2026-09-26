import Link from "next/link";

import { ConfidenceChip } from "@/components/evidence/confidence-chip";
import { GateBadge } from "@/components/evidence/gate-badge";
import { DeltaValue, Value } from "@/components/evidence/value";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { latestSessionDate } from "@/db/queries/market";
import { listWatchlists, watchlistItemsWithScores } from "@/db/queries/portfolio";
import { currentUserId } from "@/lib/auth";
import type { GateState } from "@/lib/domain/states";
import { stateful } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  const userId = await currentUserId();
  if (!userId) {
    return (
      <>
        <PageHeader title="Watchlist" />
        <Card>
          <EmptyState reason="no_data" detail="No operator user exists yet. Run `npm run db:seed:reference`." />
        </Card>
      </>
    );
  }

  const sessionDate = (await latestSessionDate()) ?? new Date().toISOString().slice(0, 10);
  const lists = await listWatchlists(userId);

  if (!lists.length) {
    return (
      <>
        <PageHeader title="Watchlist" />
        <Card>
          <EmptyState reason="no_data" detail="No watchlists yet. Create one from a company page." />
        </Card>
      </>
    );
  }

  const withItems = await Promise.all(
    lists.map(async (l) => ({ list: l, items: await watchlistItemsWithScores(l.id, sessionDate) })),
  );

  return (
    <>
      <PageHeader
        title="Watchlist"
        description="Score drift since you added each name, plus current gate state."
      />
      <div className="space-y-4">
        {withItems.map(({ list, items }) => (
          <Card key={list.id}>
            <CardHeader className="pb-2">
              <CardTitle>{list.name}</CardTitle>
              {list.description ? (
                <p className="text-muted-foreground text-xs">{list.description}</p>
              ) : null}
            </CardHeader>
            <CardContent className="px-0">
              {items.length === 0 ? (
                <p className="text-muted-foreground px-4 pb-4 text-xs">No instruments in this list.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Δ since added</TableHead>
                      <TableHead>Conviction</TableHead>
                      <TableHead>Gate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => {
                      const changePct =
                        i.close && i.ycp && Number(i.ycp) !== 0
                          ? ((Number(i.close) - Number(i.ycp)) / Number(i.ycp)) * 100
                          : null;
                      const drift =
                        i.composite && i.scoreAtAdd
                          ? Number(i.composite) - Number(i.scoreAtAdd)
                          : null;
                      return (
                        <TableRow key={i.itemId}>
                          <TableCell>
                            <Link href={`/issuers/${i.issuerId}`} className="tnum font-medium hover:underline">
                              {i.ticker}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate">{i.name}</TableCell>
                          <TableCell className="text-right">
                            <Value value={stateful(i.close)} kind="price" />
                          </TableCell>
                          <TableCell className="text-right">
                            <DeltaValue value={changePct?.toFixed(4) ?? null} />
                          </TableCell>
                          <TableCell className="tnum text-right">
                            {i.composite ? Number(i.composite).toFixed(1) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <DeltaValue value={drift?.toFixed(1) ?? null} kind="ratio" decimals={1} />
                          </TableCell>
                          <TableCell>
                            <ConfidenceChip conviction={i.conviction} />
                          </TableCell>
                          <TableCell>
                            {i.gateState ? <GateBadge state={i.gateState as GateState} /> : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
