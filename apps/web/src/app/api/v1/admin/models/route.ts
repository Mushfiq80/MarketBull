import { modelRegistry, recentDrift } from "@/db/queries/quality";
import { ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const [models, drift] = await Promise.all([modelRegistry(), recentDrift(50)]);
  return ok(
    {
      models,
      drift,
      note:
        "Historical published scores are preserved as originally published. A model change produces " +
        "new snapshots under a new version; it never rewrites the past.",
    },
    await buildMeta(),
  );
}
