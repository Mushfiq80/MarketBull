import { issuerProfile } from "@/db/queries/issuers";
import { fail, ok } from "@/lib/api/envelope";
import { templateForSector } from "@/lib/domain/sectors";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await issuerProfile(id);
  if (!profile) return fail("NOT_FOUND", "Issuer not found.");

  return ok(
    {
      issuer: profile.issuer,
      instruments: profile.instruments,
      current: profile.current,
      scorecardTemplate: templateForSector(profile.issuer.sectorCode),
      note: "Ticker history is preserved; identity is keyed on issuerId, never on ticker.",
    },
    await buildMeta({ asOf: profile.issuer.retrievedAt }),
  );
}
