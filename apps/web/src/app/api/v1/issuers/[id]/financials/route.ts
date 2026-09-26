import { derivedFor, financials } from "@/db/queries/issuers";
import { ok } from "@/lib/api/envelope";
import { buildMeta, detectSample } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const asOfParam = url.searchParams.get("asOf");

  const [reported, derived] = await Promise.all([
    financials(id, {
      periodType: url.searchParams.get("statement") ?? undefined,
      asOf: asOfParam ? new Date(asOfParam) : undefined,
      limitPeriods: Number(url.searchParams.get("periods") ?? 8),
    }),
    derivedFor(id),
  ]);

  return ok(
    {
      reported,
      derived,
      asOf: asOfParam ?? null,
      note:
        "`reported` is exactly what the issuer published. `derived` is BABull-computed with its " +
        "formula version and input lineage. They are separate so the two can never be confused. " +
        "Pass ?asOf=<iso> to reconstruct what was knowable at a past time.",
    },
    await buildMeta({ sampleData: detectSample(reported as never) }),
  );
}
