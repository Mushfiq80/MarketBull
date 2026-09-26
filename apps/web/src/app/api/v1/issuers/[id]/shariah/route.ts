import { shariahFor } from "@/db/queries/issuers";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await shariahFor(id);
  if (!row) return fail("SOURCE_UNAVAILABLE", "This issuer has not been screened yet.");

  return ok(
    {
      status: row.status,
      methodology: row.methodology,
      methodologyVersion: row.methodologyVersion,
      dataDate: row.dataDate,
      businessActivityResults: row.businessActivityResults,
      financialRatioResults: row.financialRatioResults,
      undeterminedReasons: row.undeterminedReasons,
      disclaimer:
        `Screened under ${row.methodology} v${row.methodologyVersion} using data as of ${row.dataDate}. ` +
        "This is a data screen, not a religious certification and not a fatwa. Where data is missing " +
        "or activity is ambiguous the result is 'undetermined' — never an assumed pass.",
    },
    await buildMeta({ asOf: row.asOf }),
  );
}
