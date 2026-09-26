import { ownershipHistory } from "@/db/queries/issuers";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await ownershipHistory(id, 36);
  return ok(
    {
      snapshots: rows,
      note:
        "Shareholding as DISCLOSED by the issuer. A disclosed holding is not necessarily ultimate " +
        "beneficial ownership, which BABull only asserts where a lawful source establishes it.",
    },
    await buildMeta({ asOf: rows[0]?.retrievedAt }),
  );
}
