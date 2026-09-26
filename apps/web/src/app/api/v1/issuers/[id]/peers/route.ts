import { peers } from "@/db/queries/issuers";
import { latestSessionDate } from "@/db/queries/market";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionDate = (await latestSessionDate()) ?? null;
  if (!sessionDate) return fail("SOURCE_UNAVAILABLE", "No market data ingested yet.");

  const rows = await peers(id, sessionDate);
  return ok(
    {
      sessionDate,
      peers: rows,
      note:
        "Peer groups are documented, not inferred. Where no explicit peer group is recorded, the " +
        "sector is used as a fallback — sector peers can differ materially in business model.",
    },
    await buildMeta({ asOf: `${sessionDate}T00:00:00Z` }),
  );
}
