import { currentRegime, regimeHistory } from "@/db/queries/regime";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const current = await currentRegime();
  if (!current) return fail("SOURCE_UNAVAILABLE", "No regime snapshots computed yet.");

  const to = url.searchParams.get("to") ?? current.sessionDate;
  const from =
    url.searchParams.get("from") ??
    new Date(new Date(`${to}T00:00:00Z`).getTime() - 730 * 86400_000).toISOString().slice(0, 10);

  const rows = await regimeHistory(from, to);
  return ok({ from, to, snapshots: rows }, await buildMeta({ asOf: `${to}T00:00:00Z` }));
}
