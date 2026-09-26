import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { alertEvents, alertRules } from "@/db/schema";
import { logger } from "@/lib/logger";
import { dedupeKey } from "./rules";
import { validateAlertText } from "./language";

/**
 * Alert dispatch: dedupe, rate limit, record, deliver.
 *
 * Every alert is auditable and linked to the evidence that triggered it. An
 * alert whose text fails the language validator is refused rather than softened.
 */

export type AlertCandidate = {
  ruleId: string;
  instrumentId?: string | null;
  issuerId?: string | null;
  message: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  triggerEvidence: Record<string, unknown>;
  evidenceIds?: string[];
  sessionDate: string;
  conditionVersion: string;
  discriminator?: string;
};

export type DispatchOutcome =
  | { state: "created"; id: string }
  | { state: "duplicate" }
  | { state: "suppressed_cooldown" }
  | { state: "suppressed_ratelimit" }
  | { state: "rejected"; reason: string };

export async function dispatch(candidate: AlertCandidate): Promise<DispatchOutcome> {
  // 1. language check — a bad alert is not softened, it is refused.
  const language = validateAlertText(candidate.message);
  if (!language.ok) {
    logger.error("alert text rejected by language validator", {
      ruleId: candidate.ruleId,
      offending: language.offending,
    });
    return {
      state: "rejected",
      reason: `Alert text contained disallowed wording: ${language.offending.join(", ")}.`,
    };
  }

  const [rule] = await db.select().from(alertRules).where(eq(alertRules.id, candidate.ruleId)).limit(1);
  if (!rule) return { state: "rejected", reason: "Rule not found." };
  if (!rule.isEnabled) return { state: "rejected", reason: "Rule is disabled." };

  // 2. cooldown
  if (rule.lastTriggeredAt) {
    const elapsedMinutes = (Date.now() - rule.lastTriggeredAt.getTime()) / 60000;
    if (elapsedMinutes < rule.cooldownMinutes) return { state: "suppressed_cooldown" };
  }

  // 3. daily rate limit
  const since = new Date(Date.now() - 24 * 3600_000);
  const counted = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alertEvents)
    .where(and(eq(alertEvents.ruleId, rule.id), gte(alertEvents.triggeredAt, since)));
  const todayCount = counted[0]?.n ?? 0;
  if (todayCount >= rule.maxPerDay) return { state: "suppressed_ratelimit" };

  // 4. dedupe + insert
  const key = dedupeKey({
    ruleId: candidate.ruleId,
    subjectId: candidate.instrumentId ?? candidate.issuerId ?? null,
    sessionDate: candidate.sessionDate,
    conditionVersion: candidate.conditionVersion,
    discriminator: candidate.discriminator,
  });

  try {
    const [inserted] = await db
      .insert(alertEvents)
      .values({
        ruleId: candidate.ruleId,
        instrumentId: candidate.instrumentId ?? null,
        issuerId: candidate.issuerId ?? null,
        message: candidate.message,
        severity: candidate.severity,
        triggerEvidence: candidate.triggerEvidence,
        evidenceIds: candidate.evidenceIds ?? [],
        dedupeKey: key,
        deliveryState: "pending",
      })
      .onConflictDoNothing({ target: alertEvents.dedupeKey })
      .returning({ id: alertEvents.id });

    if (!inserted) return { state: "duplicate" };

    await db
      .update(alertRules)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(alertRules.id, candidate.ruleId));

    logger.info("alert created", { ruleId: candidate.ruleId, alertId: inserted.id });
    return { state: "created", id: inserted.id };
  } catch (err) {
    logger.error("alert insert failed", { error: String(err) });
    return { state: "rejected", reason: String(err) };
  }
}

/** Mark delivery outcome. Transient failures are retried by the worker. */
export async function markDelivered(alertId: string, error?: string) {
  await db
    .update(alertEvents)
    .set({
      deliveryState: error ? "failed" : "delivered",
      deliveredAt: error ? null : new Date(),
      deliveryError: error ?? null,
    })
    .where(eq(alertEvents.id, alertId));
}
