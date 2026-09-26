import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { alertRules } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { RULE_LABELS, RULE_TYPES, validateConditions } from "@/lib/alerts/rules";
import { buildMeta } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  const rows = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.userId, userId))
    .orderBy(desc(alertRules.createdAt));
  return ok({ count: rows.length, rules: rows, availableTypes: RULE_LABELS }, await buildMeta());
}

const CreateBody = z.object({
  name: z.string().min(1).max(160),
  ruleType: z.enum(RULE_TYPES),
  instrumentId: z.string().uuid().optional(),
  watchlistId: z.string().uuid().optional(),
  portfolioId: z.string().uuid().optional(),
  isMarketWide: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).default({}),
  channels: z.array(z.string()).default(["in_app"]),
  cooldownMinutes: z.number().int().min(5).max(20160).optional(),
  maxPerDay: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");

  const parsed = CreateBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", parsed.error.issues.map((i) => i.message).join("; "));
  }

  // Conditions are validated per rule type, so a malformed rule fails now rather
  // than silently never firing.
  const conditions = validateConditions(parsed.data.ruleType, parsed.data.conditions);
  if (!conditions.ok) return fail("VALIDATION_FAILED", conditions.error);

  const scopes = [
    parsed.data.instrumentId,
    parsed.data.watchlistId,
    parsed.data.portfolioId,
    parsed.data.isMarketWide ? "market" : undefined,
  ].filter(Boolean);
  if (scopes.length !== 1) {
    return fail(
      "VALIDATION_FAILED",
      "Exactly one scope is required: instrumentId, watchlistId, portfolioId, or isMarketWide.",
    );
  }

  const [row] = await db
    .insert(alertRules)
    .values({
      userId,
      name: parsed.data.name,
      ruleType: parsed.data.ruleType,
      instrumentId: parsed.data.instrumentId ?? null,
      watchlistId: parsed.data.watchlistId ?? null,
      portfolioId: parsed.data.portfolioId ?? null,
      isMarketWide: parsed.data.isMarketWide ?? false,
      conditions: conditions.data as Record<string, unknown>,
      channels: parsed.data.channels,
      cooldownMinutes: parsed.data.cooldownMinutes ?? 1440,
      maxPerDay: parsed.data.maxPerDay ?? 10,
    })
    .returning();

  return ok(row, await buildMeta());
}
