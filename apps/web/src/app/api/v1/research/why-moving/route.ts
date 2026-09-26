import { z } from "zod";

import { fail, ok } from "@/lib/api/envelope";
import { QuantServiceError, quant } from "@/lib/quant/client";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

const Body = z.object({
  issuerId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  if (parsed.data.from > parsed.data.to) {
    return fail("VALIDATION_FAILED", "`from` must be on or before `to`.");
  }

  try {
    const result = await quant.whyMoving(parsed.data);
    return ok(result, await buildMeta({ asOf: `${parsed.data.to}T00:00:00Z` }));
  } catch (err) {
    if (err instanceof QuantServiceError) {
      return fail(
        err.code === "UNREACHABLE" ? "QUANT_SERVICE_UNAVAILABLE" : "INTERNAL",
        err.message,
      );
    }
    return fail("INTERNAL", String(err));
  }
}
