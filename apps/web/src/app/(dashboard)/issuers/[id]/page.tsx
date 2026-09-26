import { notFound } from "next/navigation";
import Link from "next/link";

import { ConfidenceChip } from "@/components/evidence/confidence-chip";
import { GateBadge } from "@/components/evidence/gate-badge";
import { ScoreStamp } from "@/components/evidence/score-stamp";
import { Value } from "@/components/evidence/value";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PriceChartPanel } from "@/components/company/price-chart-panel";
import { FinancialsTable } from "@/components/company/financials-table";
import { EventTimeline } from "@/components/company/event-timeline";
import { OwnershipPanel } from "@/components/company/ownership-panel";
import { GovernancePanel } from "@/components/company/governance-panel";
import { RelationshipPanel } from "@/components/company/relationship-panel";
import { ShariahPanel } from "@/components/company/shariah-panel";
import { PeerTable } from "@/components/company/peer-table";
import { CorporateActionsTable } from "@/components/company/corporate-actions-table";
import {
  corporateActionsFor, eventTimeline, financials, governanceFor, issuerProfile,
  latestScores, ownershipHistory, peers, relatedPeople, shariahFor,
} from "@/db/queries/issuers";
import { priceSeries } from "@/db/queries/market";
import { latestSessionDate } from "@/db/queries/market";
import { templateForSector } from "@/lib/domain/sectors";
import type { GateState, Horizon } from "@/lib/domain/states";
import { stateful } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function IssuerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await issuerProfile(id);
  if (!profile) notFound();

  const { issuer, current } = profile;
  const sessionDate = (await latestSessionDate()) ?? new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 730 * 86400_000).toISOString().slice(0, 10);

  const [scores, fins, events, ownership, governance, people, screen, peerRows, actions, bars] =
    await Promise.all([
      latestScores(id),
      financials(id, { limitPeriods: 8 }),
      eventTimeline(id, { limit: 40 }),
      ownershipHistory(id),
      governanceFor(id),
      relatedPeople(id),
      shariahFor(id),
      peers(id, sessionDate),
      corporateActionsFor(id),
      current ? priceSeries(current.id, from, sessionDate, true) : Promise.resolve([]),
    ]);

  const template = templateForSector(issuer.sectorCode);
  const byHorizon = new Map(scores.map((s) => [s.horizon, s]));

  return (
    <>
      <PageHeader
        title={`${current?.ticker ?? "—"} · ${issuer.name}`}
        description={[issuer.sectorCode, current?.listingStatus, `scorecard: ${template}`]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/research/why-moving?issuerId=${id}`}>Why moving?</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/issuers/${id}/fox`}>FOX research</Link>
            </Button>
          </>
        }
      />

      {/* --- score strip --- */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {(["short", "medium", "long"] as Horizon[]).map((h) => {
          const s = byHorizon.get(h);
          return (
            <Card key={h}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[11px] tracking-wide uppercase">{h}</span>
                  {s ? (
                    <ScoreStamp
                      horizon={h}
                      modelVersion={s.modelVersion}
                      asOf={s.asOf instanceof Date ? s.asOf.toISOString() : String(s.asOf)}
                    />
                  ) : null}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="tnum text-2xl font-semibold">
                    {s?.composite ? Number(s.composite).toFixed(1) : "—"}
                  </span>
                  {s ? <ConfidenceChip conviction={s.conviction} breakdown={s.convictionBreakdown as never} /> : null}
                </div>
                {s ? (
                  <div className="mt-2">
                    <GateBadge
                      state={s.gateState as GateState}
                      triggers={s.gateTriggers as { gate: string; reason: string }[] | null}
                    />
                  </div>
                ) : (
                  <p className="text-muted-foreground mt-2 text-xs">Not scored for this horizon yet.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <PriceChartPanel bars={bars} ticker={current?.ticker ?? ""} />

      <Tabs defaultValue="business" className="mt-4">
        <TabsList>
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="ownership">Ownership &amp; people</TabsTrigger>
          <TabsTrigger value="governance">Governance</TabsTrigger>
          <TabsTrigger value="peers">Peers</TabsTrigger>
        </TabsList>

        <TabsContent value="business">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Business</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {issuer.businessDescription ? (
                  <p>{issuer.businessDescription}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    No business description on file. It is extracted from annual reports once the
                    document pipeline has run for this issuer.
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <Field label="Shares outstanding" value={current?.sharesOutstanding} kind="integer" />
                  <Field label="Free float" value={current?.freeFloatShares} kind="integer" />
                  <Field label="Paid-up capital" value={current?.paidUpCapital} kind="money" />
                  <Field label="Face value" value={current?.faceValue} kind="price" />
                  <Field label="Listing date" value={current?.listingDate as never} kind="ratio" />
                  <div>
                    <dt className="text-muted-foreground">ISIN</dt>
                    <dd className="tnum">{current?.isin ?? "—"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <ShariahPanel screen={screen} />
          </div>
          <div className="mt-4">
            <CorporateActionsTable rows={actions} />
          </div>
        </TabsContent>

        <TabsContent value="financials">
          <FinancialsTable rows={fins} template={template} />
        </TabsContent>

        <TabsContent value="events">
          <EventTimeline events={events} />
        </TabsContent>

        <TabsContent value="ownership">
          <div className="grid gap-4 lg:grid-cols-2">
            <OwnershipPanel snapshots={ownership} />
            <RelationshipPanel people={people} />
          </div>
        </TabsContent>

        <TabsContent value="governance">
          <GovernancePanel actions={governance.actions} flags={governance.flags} />
        </TabsContent>

        <TabsContent value="peers">
          <PeerTable rows={peerRows} currentIssuerId={id} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Field({
  label,
  value,
  kind,
}: {
  label: string;
  value: unknown;
  kind: "integer" | "money" | "price" | "ratio";
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <Value value={stateful(value as string | number | null)} kind={kind} />
      </dd>
    </div>
  );
}
