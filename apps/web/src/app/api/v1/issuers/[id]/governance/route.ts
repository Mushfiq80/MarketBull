import { governanceFor } from "@/db/queries/issuers";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await governanceFor(id);
  return ok(
    {
      ...result,
      note:
        "Status distinguishes allegation, interim order, proceeding, final finding and reversal. " +
        "Only a final finding may be described as a finding; everything else stays attributed to its " +
        "source. An absence of records is not a clean bill of health.",
    },
    await buildMeta(),
  );
}
