import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { auditLog, dataQualityIssues } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

const Body = z.object({
  state: z.enum(["open", "investigating", "resolved", "accepted", "wont_fix"]),
  resolution: z.string().max(2000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("VALIDATION_FAILED", "A valid `state` is required.");

  const [before] = await db.select().from(dataQualityIssues).where(eq(dataQualityIssues.id, id)).limit(1);
  if (!before) return fail("NOT_FOUND", "Issue not found.");

  const actor = (await currentUserId()) ?? "system";
  const resolved = parsed.data.state === "resolved" || parsed.data.state === "wont_fix";

  const [after] = await db
    .update(dataQualityIssues)
    .set({
      state: parsed.data.state,
      resolution: parsed.data.resolution ?? before.resolution,
      resolvedAt: resolved ? new Date() : null,
      resolvedBy: resolved ? actor : null,
    })
    .where(eq(dataQualityIssues.id, id))
    .returning();

  // Data corrections are audited — who changed what, and why.
  await db.insert(auditLog).values({
    actor,
    actorKind: "user",
    action: "data_quality_issue.update",
    targetTable: "data_quality_issues",
    targetId: id,
    before: { state: before.state, resolution: before.resolution },
    after: { state: parsed.data.state, resolution: parsed.data.resolution ?? null },
    reason: parsed.data.resolution,
  });

  return ok(after, await buildMeta());
}
