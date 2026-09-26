import { searchIssuers } from "@/db/queries/issuers";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rows = await searchIssuers(
    url.searchParams.get("q") ?? undefined,
    url.searchParams.get("sector") ?? undefined,
    Math.min(500, Number(url.searchParams.get("limit") ?? 100)),
  );
  return ok({ count: rows.length, rows }, await buildMeta());
}
