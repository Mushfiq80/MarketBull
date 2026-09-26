import { recentRuns } from "@/db/queries/quality";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rows = await recentRuns(Math.min(200, Number(url.searchParams.get("limit") ?? 50)));
  return ok({ count: rows.length, runs: rows }, await buildMeta());
}
