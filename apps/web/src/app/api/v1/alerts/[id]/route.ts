import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { alertRules } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { validateConditions } from "@/lib/alerts/rules";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().min(1).max(160).optional(),
  isEnabled: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  cooldownMinutes: z.number().int().min(5).max(20160).optional(),
  maxPerDay: z.number().int().min(1).max(100).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");

  const [rule] = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
    .limit(1);
  if (!rule) return fail("NOT_FOUND", "Alert rule not found.");

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("VALIDATION_FAILED", "Invalid payload.");

  let conditions = rule.conditions;
  if (parsed.data.conditions) {
    const validated = validateConditions(rule.ruleType, parsed.data.conditions);
    if (!validated.ok) return fail("VALIDATION_FAILED", validated.error);
    conditions = validated.data as Record<string, unknown>;
  }

  const [row] = await db
    .update(alertRules)
    .set({
      name: parsed.data.name ?? rule.name,
      isEnabled: parsed.data.isEnabled ?? rule.isEnabled,
      conditions,
      cooldownMinutes: parsed.data.cooldownMinutes ?? rule.cooldownMinutes,
      maxPerDay: parsed.data.maxPerDay ?? rule.maxPerDay,
    })
    .where(eq(alertRules.id, id))
    .returning();
  return ok(row, await buildMeta());
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  const [rule] = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
    .limit(1);
  if (!rule) return fail("NOT_FOUND", "Alert rule not found.");
  await db.delete(alertRules).where(eq(alertRules.id, id));
  return ok({ deleted: id }, await buildMeta());
}
