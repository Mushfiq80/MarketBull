import { breadthFor, latestSessionDate } from "@/db/queries/market";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? (await latestSessionDate());
  if (!date) return fail("SOURCE_UNAVAILABLE", "No market data ingested yet.");

  const breadth = await breadthFor(date);
  if (!breadth) {
    return fail("SOURCE_UNAVAILABLE", "No breadth snapshot on or before that date.");
  }
  return ok(breadth, await buildMeta({ asOf: `${breadth.sessionDate}T00:00:00Z` }));
}
