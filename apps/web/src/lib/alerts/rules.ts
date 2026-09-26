import { z } from "zod";

/**
 * Alert rule definitions and their parameter schemas.
 *
 * Each rule type validates its own conditions, so a malformed rule fails at
 * creation rather than silently never firing.
 */

export const RULE_TYPES = [
  "price_threshold",
  "volume_spike",
  "new_filing",
  "corporate_action",
  "governance_event",
  "data_quality",
  "thesis_change",
  "gate_change",
  "regime_transition",
  "shariah_status_change",
  "score_move",
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

export const CONDITION_SCHEMAS = {
  price_threshold: z.object({
    direction: z.enum(["above", "below"]),
    price: z.string(),
  }),
  volume_spike: z.object({
    multipleOfMedian: z.number().min(1.5).default(5),
    baselineSessions: z.number().int().min(20).default(60),
  }),
  new_filing: z.object({
    documentTypes: z.array(z.string()).default([]),
  }),
  corporate_action: z.object({
    actionTypes: z.array(z.string()).default([]),
  }),
  governance_event: z.object({
    minSeverity: z.enum(["info", "low", "medium", "high", "critical"]).default("medium"),
    statuses: z.array(z.string()).default(["final_finding", "proceeding", "interim_order"]),
  }),
  data_quality: z.object({
    minSeverity: z.enum(["info", "low", "medium", "high", "critical"]).default("high"),
    kinds: z.array(z.string()).default([]),
  }),
  thesis_change: z.object({
    minScoreDelta: z.number().min(1).default(10),
  }),
  gate_change: z.object({
    toStates: z.array(z.enum(["eligible", "restricted", "review_required", "excluded"]))
      .default(["restricted", "excluded"]),
  }),
  regime_transition: z.object({
    onlyOnStateChange: z.boolean().default(true),
  }),
  shariah_status_change: z.object({
    methodology: z.string().default("aaoifi_style"),
  }),
  score_move: z.object({
    minDelta: z.number().min(1).default(15),
    horizon: z.enum(["short", "medium", "long"]).default("medium"),
  }),
} as const;

export function validateConditions(ruleType: string, conditions: unknown) {
  const schema = (CONDITION_SCHEMAS as Record<string, z.ZodTypeAny>)[ruleType];
  if (!schema) {
    return { ok: false as const, error: `Unknown rule type '${ruleType}'.` };
  }
  const parsed = schema.safeParse(conditions);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true as const, data: parsed.data };
}

export const RULE_LABELS: Record<RuleType, string> = {
  price_threshold: "Price crosses a threshold",
  volume_spike: "Turnover unusual versus baseline",
  new_filing: "New filing published",
  corporate_action: "Corporate action announced",
  governance_event: "Governance or regulatory record",
  data_quality: "Data quality problem",
  thesis_change: "Thesis or score change",
  gate_change: "Risk gate change",
  regime_transition: "Market regime classification change",
  shariah_status_change: "Screen status change",
  score_move: "Score moved materially",
};

/** Deduplication key: identical (rule, subject, day, condition) collapses to one. */
export function dedupeKey(parts: {
  ruleId: string;
  subjectId: string | null;
  sessionDate: string;
  conditionVersion: string;
  discriminator?: string;
}): string {
  return [
    parts.ruleId,
    parts.subjectId ?? "market",
    parts.sessionDate,
    parts.conditionVersion,
    parts.discriminator ?? "",
  ].join("|");
}
