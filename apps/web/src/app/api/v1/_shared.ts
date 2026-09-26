import { loadSourceStatuses } from "@/db/queries/common";
import { sourceStatusFrom, type Meta } from "@/lib/api/envelope";

/**
 * Build the standard meta block. Every market/model response carries it, so the
 * UI can always find as_of, per-source freshness and the sample-data flag.
 */
export async function buildMeta(
  opts: {
    asOf?: string | Date | null;
    modelVersion?: string;
    sampleData?: boolean;
    dataStates?: Meta["dataStates"];
  } = {},
): Promise<Partial<Meta>> {
  let sourceStatus = {};
  try {
    sourceStatus = sourceStatusFrom(await loadSourceStatuses());
  } catch {
    sourceStatus = {};
  }
  return {
    asOf:
      opts.asOf instanceof Date
        ? opts.asOf.toISOString()
        : (opts.asOf as string | null | undefined) ?? null,
    modelVersion: opts.modelVersion,
    sourceStatus,
    sampleData: opts.sampleData ?? false,
    dataStates: opts.dataStates,
  };
}

/** True when any row in a result set is sample-tagged (ADR 0007). */
export function detectSample(rows: { sourceId?: string | null; usedSampleData?: boolean | null }[]) {
  return rows.some((r) => r.sourceId === "sample" || r.usedSampleData === true);
}
