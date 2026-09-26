import Link from "next/link";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { DeltaValue, Value } from "@/components/evidence/value";
import { FreshnessBadge } from "@/components/evidence/freshness-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { breadthFor, indexCards, latestSessionDate, movers, sectorPulse } from "@/db/queries/market";
import { currentRegime } from "@/db/queries/regime";
import { formatSessionDate, stateful } from "@/lib/format";
import { SectorPulse } from "@/components/market/sector-pulse";
import { RegimeBanner } from "@/components/market/regime-banner";
import { BreadthPanel } from "@/components/market/breadth-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Market" };

export default async function MarketHomePage() {
  const sessionDate = await latestSessionDate();

  if (!sessionDate) {
    return (
      <>
        <PageHeader title="Market" description="What is happening on the Dhaka Stock Exchange." />
        <Card>
          <EmptyState reason="no_data" />
        </Card>
      </>
    );
  }

  const [indices, breadth, regime, gainers, losers, active, unusual, sectors] = await Promise.all([
    indexCards(sessionDate),
    breadthFor(sessionDate),
    currentRegime(),
    movers(sessionDate, "gainers", 8),
    movers(sessionDate, "losers", 8),
    movers(sessionDate, "active", 8),
    movers(sessionDate, "unusual", 6),
    sectorPulse(sessionDate),
  ]);

  return (
    <>
      <PageHeader
        title="Market"
        description={`Session ${formatSessionDate(sessionDate)} · all values carry their own as-of stamp`}
      />

      {regime ? <RegimeBanner regime={regime} /> : null}

      {/* --- index cards --- */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {indices.map((idx) => (
          <Card key={idx.symbol}>
            <CardHeader className="flex-row items-start justify-between gap-2 pb-2">
              <div>
                <CardTitle className="text-sm">{idx.symbol}</CardTitle>
                <p className="text-muted-foreground text-xs">{formatSessionDate(idx.sessionDate)}</p>
              </div>
              <FreshnessBadge
                state={idx.close ? "ok" : "never_run"}
                sourceId={idx.sourceId ?? undefined}
              />
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold">
                  <Value
                    value={stateful(idx.close, idx.quality === "sample" ? "available" : "available")}
                    kind="price"
                    tabular={false}
                  />
                </span>
                <DeltaValue value={idx.changePct} kind="percent" />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Turnover <Value value={stateful(idx.totalTurnover)} kind="money" /> ·{" "}
                <Value value={stateful(idx.totalTrades)} kind="integer" /> trades
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* --- breadth + sector pulse --- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <BreadthPanel breadth={breadth} />
        </div>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sector pulse</CardTitle>
          </CardHeader>
          <CardContent>
            <SectorPulse rows={sectors} />
          </CardContent>
        </Card>
      </div>

      {/* --- movers --- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <MoverCard title="Top gainers" Icon={TrendingUp} rows={gainers} />
        <MoverCard title="Top losers" Icon={TrendingDown} rows={losers} />
        <MoverCard title="Most active" Icon={Activity} rows={active} showTurnover />
      </div>

      {/* --- unusual activity --- */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Unusual activity</CardTitle>
          <p className="text-muted-foreground text-xs">
            Statistically unusual versus each name&apos;s own baseline. These are observations, not
            allegations — nothing here implies manipulation or misconduct.
          </p>
        </CardHeader>
        <CardContent>
          {unusual.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              Nothing exceeded the detection thresholds for this session.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {(unusual as any[]).map((u, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <Link href={`/issuers/${u.instrumentId}`} className="tnum font-medium hover:underline">
                    {u.ticker}
                  </Link>
                  <Badge variant="outline">{String(u.kind).replace(/_/g, " ")}</Badge>
                  <span className="text-muted-foreground flex-1">{u.observation}</span>
                  {u.hasDisclosure ? (
                    <Badge variant="good">disclosure in window</Badge>
                  ) : (
                    <Badge variant="warning">no disclosure found</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function MoverCard({
  title,
  Icon,
  rows,
  showTurnover = false,
}: {
  title: string;
  Icon: typeof TrendingUp;
  rows: any[];
  showTurnover?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="text-muted-foreground size-4" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground px-4 pb-4 text-xs">No priced instruments this session.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">{showTurnover ? "Turnover" : "Change"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.instrumentId}>
                  <TableCell>
                    <Link href={`/issuers/${r.instrumentId}`} className="tnum font-medium hover:underline">
                      {r.ticker}
                    </Link>
                    {r.limitBound ? (
                      <Badge variant="warning" className="ml-1.5">limit</Badge>
                    ) : null}
                    {r.tradingState && r.tradingState !== "normal" ? (
                      <Badge variant="critical" className="ml-1.5">{r.tradingState}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Value value={stateful(r.close)} kind="price" />
                  </TableCell>
                  <TableCell className="text-right">
                    {showTurnover ? (
                      <Value value={stateful(r.turnover)} kind="money" />
                    ) : (
                      <DeltaValue value={r.changePct} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
