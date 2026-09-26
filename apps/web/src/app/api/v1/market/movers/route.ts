import { latestSessionDate, movers, type MoverKind } from "@/db/queries/market";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta, detectSample } from "../../_shared";

export const dynamic = "force-dynamic";

const KINDS: MoverKind[] = ["gainers", "losers", "active", "unusual"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = (url.searchParams.get("kind") ?? "gainers") as MoverKind;
  if (!KINDS.includes(kind)) {
    return fail("VALIDATION_FAILED", `kind must be one of ${KINDS.join(", ")}.`);
  }
  const date = url.searchParams.get("date") ?? (await latestSessionDate());
  if (!date) return fail("SOURCE_UNAVAILABLE", "No market data ingested yet.");

  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 10));
  const rows = await movers(date, kind, limit);

  return ok(
    { sessionDate: date, kind, rows },
    await buildMeta({ asOf: `${date}T00:00:00Z`, sampleData: detectSample(rows as never) }),
  );
}
