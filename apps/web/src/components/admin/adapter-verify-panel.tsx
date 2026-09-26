"use client";

import * as React from "react";
import { CheckCircle2, Loader2, PlayCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Report = {
  adapter: string;
  parserVersion: string;
  reachable: boolean;
  httpStatus: number | null;
  snapshotId: string | null;
  storageKey: string | null;
  tableFound: boolean;
  columnsDetected: string[];
  columnsMapped: Record<string, string>;
  columnsUnmapped: string[];
  rowsParsed: number;
  rowsRejected: number;
  rejectionReasons: Record<string, number>;
  sampleRows: Record<string, unknown>[];
  warnings: string[];
  validation: { kind: string; severity: string; summary: string }[];
  durationMs: number;
};

/**
 * Adapter verification panel — the dry run.
 *
 * Fetches, parses and reports field by field WITHOUT writing to the database.
 * This is how a source is validated the first time, and the DSE adapters in this
 * build have never seen a live response.
 */
export function AdapterVerifyPanel({ adapters }: { adapters: string[] }) {
  const known = adapters.length
    ? adapters
    : ["dse_company", "dse_eod", "dse_latest", "dse_index", "bsec", "bb_macro", "bbs"];

  const [adapter, setAdapter] = React.useState(known[0]!);
  const [from, setFrom] = React.useState(
    new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10),
  );
  const [to, setTo] = React.useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = React.useState(false);
  const [report, setReport] = React.useState<Report | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(verify: boolean) {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`/api/v1/admin/ingest/${adapter}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, verify }),
      });
      const json = await res.json();
      if (!res.ok) setError(json?.error?.message ?? "Request failed.");
      else setReport(json.data as Report);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Verify a source adapter</CardTitle>
        <p className="text-muted-foreground text-xs">
          Verification fetches, parses and reports field by field <strong>without writing</strong>.
          Run it before any real ingestion and fix the column synonyms until the report is clean.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Label className="text-xs">Adapter</Label>
            <Select value={adapter} onValueChange={setAdapter}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {known.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="vfrom" className="text-xs">From</Label>
            <Input id="vfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="vto" className="text-xs">To</Label>
            <Input id="vto" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
          </div>
          <Button onClick={() => run(true)} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <PlayCircle />}
            Verify (dry run)
          </Button>
          <Button variant="outline" onClick={() => run(false)} disabled={loading}>
            Ingest for real
          </Button>
        </div>

        {error ? <p className="text-[var(--status-critical)] text-sm">{error}</p> : null}

        {report ? (
          <div className="space-y-3 rounded-md border p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={report.reachable ? "good" : "critical"} className="gap-1">
                {report.reachable ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                {report.reachable ? `reachable (${report.httpStatus})` : "unreachable"}
              </Badge>
              <Badge variant={report.tableFound ? "good" : "critical"}>
                {report.tableFound ? "table found" : "table not found"}
              </Badge>
              <Badge variant={report.rowsParsed > 0 ? "good" : "warning"}>
                {report.rowsParsed} parsed
              </Badge>
              <Badge variant={report.rowsRejected > 0 ? "warning" : "muted"}>
                {report.rowsRejected} rejected
              </Badge>
              <Badge variant={report.columnsUnmapped.length ? "warning" : "muted"}>
                {report.columnsUnmapped.length} unmapped column
                {report.columnsUnmapped.length === 1 ? "" : "s"}
              </Badge>
              <span className="text-muted-foreground tnum ml-auto">{report.durationMs} ms</span>
            </div>

            {report.columnsUnmapped.length ? (
              <div>
                <p className="mb-1 font-medium">Unmapped columns — add these to COLUMN_SYNONYMS</p>
                <p className="text-muted-foreground">
                  Do <strong>not</strong> switch to positional indexing: positions break silently,
                  synonyms break loudly.
                </p>
                <code className="mt-1 block break-all">{report.columnsUnmapped.join(" · ")}</code>
              </div>
            ) : null}

            {Object.keys(report.columnsMapped).length ? (
              <div>
                <p className="mb-1 font-medium">Mapping</p>
                <ul className="grid gap-x-4 sm:grid-cols-2">
                  {Object.entries(report.columnsMapped).map(([field, header]) => (
                    <li key={field} className="text-muted-foreground">
                      <span className="text-foreground">{field}</span> ← &ldquo;{header}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {Object.keys(report.rejectionReasons).length ? (
              <div>
                <p className="mb-1 font-medium">Rejection reasons</p>
                <ul className="text-muted-foreground">
                  {Object.entries(report.rejectionReasons).map(([reason, count]) => (
                    <li key={reason}>
                      <span className="tnum">{count}×</span> {reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {report.sampleRows.length ? (
              <div>
                <p className="mb-1 font-medium">Sample rows — eyeball these for unit errors</p>
                <pre className="bg-secondary/40 max-h-48 overflow-auto rounded p-2 text-[11px]">
                  {JSON.stringify(report.sampleRows, null, 1)}
                </pre>
              </div>
            ) : null}

            {report.warnings.length ? (
              <div>
                <p className="mb-1 font-medium">Warnings</p>
                <ul className="text-muted-foreground list-disc pl-4">
                  {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            ) : null}

            {report.snapshotId ? (
              <p className="text-muted-foreground">
                Raw response saved as snapshot <code>{report.snapshotId}</code>
                {report.storageKey ? <> at <code>{report.storageKey}</code></> : null}. Parsing is
                always replayable against it.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
