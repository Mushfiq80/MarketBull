import { z } from "zod";

import { fail, ok } from "@/lib/api/envelope";
import { QuantServiceError, quant } from "@/lib/quant/client";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ticker: z.string().max(20).optional(),
  /** Dry run: fetch, parse and report without writing. Always try this first. */
  verify: z.boolean().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ adapter: string }> }) {
  const { adapter } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("VALIDATION_FAILED", "Invalid ingestion parameters.");

  try {
    if (parsed.data.verify) {
      const report = await quant.verifyAdapter(adapter, {
        from: parsed.data.from,
        to: parsed.data.to,
      });
      return ok(report, await buildMeta());
    }
    const result = await quant.ingest(adapter, parsed.data);
    return ok(result, await buildMeta());
  } catch (err) {
    if (err instanceof QuantServiceError) {
      return fail(
        err.code === "UNREACHABLE" ? "QUANT_SERVICE_UNAVAILABLE" : "INTERNAL",
        err.message,
        { adapter },
      );
    }
    return fail("INTERNAL", String(err));
  }
}
