import { eventTimeline } from "@/db/queries/issuers";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const types = url.searchParams.get("type")?.split(",").filter(Boolean);

  const rows = await eventTimeline(id, {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    types: types?.length ? types : undefined,
    limit: Math.min(200, Number(url.searchParams.get("limit") ?? 50)),
  });

  return ok(
    {
      count: rows.length,
      events: rows,
      note:
        "eventAt is when it happened; publishedAt is when the market could know. claimStatus " +
        "distinguishes a confirmed document from an attributed report or an allegation — only the " +
        "first may be stated as fact.",
    },
    await buildMeta(),
  );
}
