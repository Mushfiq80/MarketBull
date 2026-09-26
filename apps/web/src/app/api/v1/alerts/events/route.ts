import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { alertEvents, alertRules } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  const url = new URL(request.url);

  const rows = await db
    .select({
      id: alertEvents.id,
      ruleId: alertEvents.ruleId,
      ruleName: alertRules.name,
      ruleType: alertRules.ruleType,
      message: alertEvents.message,
      severity: alertEvents.severity,
      triggerEvidence: alertEvents.triggerEvidence,
      evidenceIds: alertEvents.evidenceIds,
      triggeredAt: alertEvents.triggeredAt,
      deliveryState: alertEvents.deliveryState,
      readAt: alertEvents.readAt,
    })
    .from(alertEvents)
    .innerJoin(alertRules, eq(alertRules.id, alertEvents.ruleId))
    .where(eq(alertRules.userId, userId))
    .orderBy(desc(alertEvents.triggeredAt))
    .limit(Math.min(200, Number(url.searchParams.get("limit") ?? 50)));

  return ok({ count: rows.length, events: rows }, await buildMeta());
}
