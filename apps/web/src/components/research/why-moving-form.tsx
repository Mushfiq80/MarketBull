"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Result = {
  issuerId: string;
  window: { from: string; to: string };
  stockReturn: string | null;
  marketReturn: string | null;
  sectorReturn: string | null;
  abnormalReturn: string | null;
  volumeRatio: string | null;
  candidates: {
    rank: number;
    kind: string;
    title: string;
    publishedAt: string | null;
    sourceAuthority: string;
    claimStatus: string;
    timingScore: number;
    sourceScore: number;
    relevanceScore: number;
    corroborationScore: number;
    totalScore: number;
    note: string;
  }[];
  unexplainedResidual: string | null;
  disclaimer: string;
};

export function WhyMovingForm({ initialIssuerId }: { initialIssuerId?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  const [issuerId, setIssuerId] = React.useState(initialIssuerId ?? "");
  const [from, setFrom] = React.useState(weekAgo);
  const [to, setTo] = React.useState(today);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/research/why-moving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issuerId, from, to }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Request failed.");
      } else {
        setResult(json.data as Result);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <Label htmlFor="issuerId" className="text-xs">Issuer id</Label>
              <Input
                id="issuerId"
                value={issuerId}
                onChange={(e) => setIssuerId(e.target.value)}
                placeholder="uuid from a company page URL"
                required
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="from" className="text-xs">From</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="to" className="text-xs">To</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
            </div>
            <Button type="submit" disabled={loading || !issuerId}>
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              Analyse
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="critical" className="mt-4">
          <AlertTitle>Could not analyse</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="Stock return" value={result.stockReturn} />
            <Metric label="Market (DSEX)" value={result.marketReturn} />
            <Metric label="Sector" value={result.sectorReturn} />
            <Metric label="Abnormal" value={result.abnormalReturn} emphasise />
            <Metric label="Turnover vs baseline" value={result.volumeRatio} suffix="×" />
          </div>

          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle>Candidate explanations</CardTitle>
              <p className="text-muted-foreground text-xs">{result.disclaimer}</p>
            </CardHeader>
            <CardContent>
              {result.candidates.length === 0 ? (
                <p className="text-muted-foreground py-4 text-sm">
                  No events were found in or shortly before this window. The move is unexplained by
                  the evidence BABull holds — which is a finding about the data, not about the company.
                </p>
              ) : (
                <ol className="space-y-4">
                  {result.candidates.map((c) => (
                    <li key={`${c.rank}-${c.title}`} className="border-b pb-3 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">#{c.rank}</Badge>
                        <Badge variant="muted">{c.kind.replace(/_/g, " ")}</Badge>
                        <Badge
                          variant={
                            c.claimStatus === "confirmed_document"
                              ? "good"
                              : c.claimStatus === "allegation"
                                ? "serious"
                                : "warning"
                          }
                        >
                          {c.claimStatus.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-muted-foreground tnum ml-auto text-xs">
                          score {c.totalScore.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{c.title}</p>
                      <p className="text-muted-foreground text-xs">{c.note}</p>
                      <div className="text-muted-foreground mt-1 flex flex-wrap gap-3 text-[11px]">
                        <span className="tnum">timing {c.timingScore.toFixed(2)}</span>
                        <span className="tnum">source {c.sourceScore.toFixed(2)}</span>
                        <span className="tnum">relevance {c.relevanceScore.toFixed(2)}</span>
                        <span className="tnum">corroboration {c.corroborationScore.toFixed(2)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {result.unexplainedResidual ? (
                <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
                  Unexplained residual: <span className="tnum">{Number(result.unexplainedResidual).toFixed(2)}%</span>.
                  No candidate accounts convincingly for the move.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  suffix = "%",
  emphasise = false,
}: {
  label: string;
  value: string | null;
  suffix?: string;
  emphasise?: boolean;
}) {
  const n = value === null ? null : Number(value);
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</p>
        <p
          className={
            "tnum mt-0.5 font-semibold " +
            (emphasise ? "text-xl " : "text-lg ") +
            (n === null ? "text-muted-foreground" : n >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")
          }
        >
          {n === null
            ? "—"
            : `${n >= 0 ? "▲ +" : "▼ −"}${Math.abs(n).toFixed(2)}${suffix}`}
        </p>
      </CardContent>
    </Card>
  );
}
