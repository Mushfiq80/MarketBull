import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/* ===========================================================================
   Typed client for the Python quant service.
   The browser NEVER talks to this — it is server-only, authenticated with a
   shared secret, and the service binds to 127.0.0.1.
   =========================================================================== */

export class QuantServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "QuantServiceError";
  }
}

async function call<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const env = serverEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 60_000);

  try {
    const res = await fetch(`${env.QUANT_SERVICE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-BABull-Token": env.QUANT_SERVICE_TOKEN,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const detail = (parsed as { detail?: { code?: string; message?: string } } | null)?.detail;
      throw new QuantServiceError(
        detail?.message ?? `Quant service returned ${res.status}`,
        res.status,
        detail?.code,
        parsed,
      );
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof QuantServiceError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new QuantServiceError("Quant service timed out", 504, "TIMEOUT");
    }
    logger.error("quant service unreachable", { path, error: String(err) });
    throw new QuantServiceError(
      "Quant service is not reachable. Is it running on port 8000?",
      503,
      "UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}

/* --- types shared with the Python service -------------------------------- */

export type AdapterVerifyReport = {
  adapter: string;
  reachable: boolean;
  httpStatus: number | null;
  snapshotId: string | null;
  tableFound: boolean;
  columnsDetected: string[];
  columnsMapped: Record<string, string>;
  columnsUnmapped: string[];
  rowsParsed: number;
  rowsRejected: number;
  rejectionReasons: Record<string, number>;
  sampleRows: Record<string, unknown>[];
  warnings: string[];
  durationMs: number;
};

export type IngestResult = {
  runId: string;
  adapter: string;
  status: "succeeded" | "failed" | "partial";
  rowsFetched: number;
  rowsWritten: number;
  rowsRejected: number;
  rejectionReasons: Record<string, number>;
  message?: string;
};

export type WhyMovingResult = {
  issuerId: string;
  window: { from: string; to: string };
  stockReturn: string | null;
  marketReturn: string | null;
  sectorReturn: string | null;
  abnormalReturn: string | null;
  volumeRatio: string | null;
  /** Ranked candidates. Never presented as "the cause". */
  candidates: {
    rank: number;
    kind: string;
    title: string;
    occurredAt: string | null;
    publishedAt: string | null;
    sourceAuthority: string;
    claimStatus: string;
    timingScore: number;
    sourceScore: number;
    relevanceScore: number;
    corroborationScore: number;
    totalScore: number;
    evidenceIds: string[];
    note: string;
  }[];
  unexplainedResidual: string | null;
  disclaimer: string;
};

export type BacktestSubmission = {
  runId: string;
  status: "running" | "blocked";
  blockedReason?: string;
  guardResults?: Record<string, { passed: boolean; detail?: string }>;
};

/* --- API ------------------------------------------------------------------ */

export const quant = {
  health: () => call<{ status: string; adapters: string[]; models: Record<string, string> }>("/health"),

  /** Dry run — fetches, parses and reports WITHOUT writing to the database. */
  verifyAdapter: (adapter: string, window?: { from?: string; to?: string }) =>
    call<AdapterVerifyReport>(`/ingest/${adapter}/verify`, {
      method: "POST",
      body: window ?? {},
      timeoutMs: 120_000,
    }),

  ingest: (adapter: string, body: Record<string, unknown> = {}) =>
    call<IngestResult>(`/ingest/${adapter}`, { method: "POST", body, timeoutMs: 600_000 }),

  computeFactors: (body: { asOf: string; instrumentIds?: string[] }) =>
    call<{ computed: number; unavailable: number; modelVersion: string }>("/factors/compute", {
      method: "POST",
      body,
      timeoutMs: 300_000,
    }),

  scoreFox: (body: { asOf: string; horizon: string; instrumentIds?: string[] }) =>
    call<{ scored: number; gated: number; modelVersion: string }>("/fox/score", {
      method: "POST",
      body,
      timeoutMs: 300_000,
    }),

  classifyRegime: (body: { asOf: string }) =>
    call<{ state: string; stateScore: number; modelVersion: string }>("/regime/classify", {
      method: "POST",
      body,
    }),

  forecastRegime: (body: { asOf: string; horizonSessions: number }) =>
    call<{ calibrationState: string; forecasts: unknown[] }>("/regime/forecast", {
      method: "POST",
      body,
    }),

  screenShariah: (body: { methodology: string; issuerIds?: string[] }) =>
    call<{ screened: number; pass: number; fail: number; undetermined: number }>("/shariah/screen", {
      method: "POST",
      body,
      timeoutMs: 300_000,
    }),

  whyMoving: (body: { issuerId: string; from: string; to: string }) =>
    call<WhyMovingResult>("/why-moving", { method: "POST", body, timeoutMs: 120_000 }),

  runBacktest: (body: Record<string, unknown>) =>
    call<BacktestSubmission>("/backtest/run", { method: "POST", body, timeoutMs: 120_000 }),

  extractDocument: (body: { documentId: string }) =>
    call<{ factsExtracted: number; needsReview: number }>("/documents/extract", {
      method: "POST",
      body,
      timeoutMs: 300_000,
    }),

  models: () => call<{ family: string; version: string; state: string; isActive: boolean }[]>("/models"),
};
