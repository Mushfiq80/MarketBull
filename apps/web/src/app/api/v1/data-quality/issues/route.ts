import { openIssues } from "@/db/queries/quality";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rows = await openIssues({
    severity: url.searchParams.get("severity") ?? undefined,
    state: url.searchParams.get("state") ?? "open",
    limit: Math.min(500, Number(url.searchParams.get("limit") ?? 100)),
  });
  return ok({ count: rows.length, issues: rows }, await buildMeta());
}
