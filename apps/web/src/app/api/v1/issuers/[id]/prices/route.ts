import { issuerProfile } from "@/db/queries/issuers";
import { latestSessionDate, priceSeries } from "@/db/queries/market";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta, detectSample } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);

  const profile = await issuerProfile(id);
  if (!profile?.current) return fail("NOT_FOUND", "Issuer or current instrument not found.");

  const to = url.searchParams.get("to") ?? (await latestSessionDate());
  if (!to) return fail("SOURCE_UNAVAILABLE", "No price data ingested yet.");
  const from =
    url.searchParams.get("from") ??
    new Date(new Date(`${to}T00:00:00Z`).getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const adjusted = url.searchParams.get("adjusted") !== "false";

  const rows = await priceSeries(profile.current.id, from, to, adjusted);

  return ok(
    {
      ticker: profile.current.ticker,
      from,
      to,
      adjustmentBasis: adjusted ? "corporate_action_adjusted" : "raw",
      bars: rows,
      note: adjusted
        ? "Corporate-action adjusted. Use adjusted=false for prices exactly as reported."
        : "Raw as-reported prices. A bonus issue will appear as a price drop — use the adjusted series for any factor spanning a corporate action.",
    },
    await buildMeta({ asOf: `${to}T00:00:00Z`, sampleData: detectSample(rows as never) }),
  );
}
