import { NextResponse } from "next/server";

/* ===========================================================================
   The response envelope. Every route that returns market or model output uses
   it, so the UI can always find as_of, freshness and the sample-data flag.
   Contract is documented in babull-docs/04-api.md.
   =========================================================================== */

export type SourceState = "ok" | "stale" | "unavailable" | "restricted" | "never_run";

export type SourceStatus = Record<string, { state: SourceState; lagMinutes: number | null }>;

export type Meta = {
  asOf: string | null;
  modelVersion?: string;
  sourceStatus: SourceStatus;
  dataStates?: { available: number; stale: number; unavailable: number };
  /** True when ANY contributing row was sample-tagged. Drives the amber banner. */
  sampleData: boolean;
  requestId: string;
};

export type Envelope<T> = { data: T; meta: Meta };

export type ApiErrorCode =
  | "SOURCE_UNAVAILABLE"
  | "SAMPLE_DATA_BLOCKED"
  | "MODEL_UNCALIBRATED"
  | "INSUFFICIENT_EVIDENCE"
  | "GATE_EXCLUDED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "QUANT_SERVICE_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_FOR: Record<ApiErrorCode, number> = {
  SOURCE_UNAVAILABLE: 503,
  SAMPLE_DATA_BLOCKED: 409,
  MODEL_UNCALIBRATED: 409,
  INSUFFICIENT_EVIDENCE: 422,
  GATE_EXCLUDED: 409,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  QUANT_SERVICE_UNAVAILABLE: 503,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function ok<T>(data: T, meta: Partial<Meta> = {}): NextResponse<Envelope<T>> {
  return NextResponse.json({
    data,
    meta: {
      asOf: meta.asOf ?? null,
      modelVersion: meta.modelVersion,
      sourceStatus: meta.sourceStatus ?? {},
      dataStates: meta.dataStates,
      sampleData: meta.sampleData ?? false,
      requestId: meta.requestId ?? requestId(),
    },
  });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message, requestId: requestId(), ...extra } },
    { status: STATUS_FOR[code] },
  );
}

/**
 * Build a SourceStatus map from source rows, applying each source's own
 * freshness budget. A value past its budget is `stale` — real, but flagged.
 */
export function sourceStatusFrom(
  rows: {
    sourceId: string;
    lastSuccessAt: Date | null;
    freshnessBudgetMinutes: number | null;
    lastErrorState: string | null;
  }[],
): SourceStatus {
  const out: SourceStatus = {};
  const now = Date.now();
  for (const r of rows) {
    if (!r.lastSuccessAt) {
      out[r.sourceId] = { state: "never_run", lagMinutes: null };
      continue;
    }
    const lag = Math.round((now - r.lastSuccessAt.getTime()) / 60000);
    const budget = r.freshnessBudgetMinutes ?? 24 * 60;
    out[r.sourceId] = {
      state: r.lastErrorState ? "unavailable" : lag > budget ? "stale" : "ok",
      lagMinutes: lag,
    };
  }
  return out;
}
