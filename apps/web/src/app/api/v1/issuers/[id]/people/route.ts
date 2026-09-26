import { relatedCompanies, relatedPeople } from "@/db/queries/issuers";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [people, companies] = await Promise.all([relatedPeople(id), relatedCompanies(id)]);
  return ok(
    {
      people,
      companies,
      note:
        "Each edge carries its source, dates and confidence. People with similar names are kept " +
        "separate until corroborating evidence establishes they are the same individual.",
    },
    await buildMeta(),
  );
}
