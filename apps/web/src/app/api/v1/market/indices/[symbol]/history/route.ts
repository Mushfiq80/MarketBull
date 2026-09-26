import { indexHistory, latestSessionDate } from "@/db/queries/market";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const url = new URL(request.url);
  const to = url.searchParams.get("to") ?? (await latestSessionDate());
  if (!to) return fail("SOURCE_UNAVAILABLE", "No index data ingested yet.");
  const from =
    url.searchParams.get("from") ??
    new Date(new Date(`${to}T00:00:00Z`).getTime() - 365 * 86400_000).toISOString().slice(0, 10);

  const rows = await indexHistory(symbol.toUpperCase(), from, to);
  if (!rows.length) return fail("NOT_FOUND", `No observations for ${symbol} in that range.`);

  return ok({ symbol: symbol.toUpperCase(), from, to, observations: rows }, await buildMeta({ asOf: `${to}T00:00:00Z` }));
}
