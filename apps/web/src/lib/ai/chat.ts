import { logger } from "@/lib/logger";
import { routeQuestion, toolsFor } from "./agents";
import { ABSTENTION_MESSAGE, SYSTEM_PROMPT, check } from "./guardrails";
import { TOOL_SPECS, execute } from "./tools";
import { complete, providerEnabled, type ChatMessage } from "./provider";

export type ChatTurn = {
  answer: string;
  role: string;
  toolCalls: { name: string; ok: boolean }[];
  evidenceIds: string[];
  guardrail: { blocked: boolean; violations: { phrase: string; reason: string }[] };
  abstained: boolean;
};

const MAX_ROUNDS = 5;

/**
 * One grounded chat turn.
 *
 * The loop is deliberately short and the tool set deliberately narrow. If the
 * model cannot ground an answer within these rounds, it abstains — which is a
 * correct outcome, not a failure.
 */
export async function answer(question: string, history: ChatMessage[] = []): Promise<ChatTurn> {
  if (!providerEnabled()) {
    return {
      answer:
        "The research chat needs an LLM provider configured (LLM_PROVIDER, LLM_MODEL, LLM_API_KEY in .env). " +
        "Every other surface of BABull works without one, because no number depends on a model.",
      role: "orchestrator",
      toolCalls: [],
      evidenceIds: [],
      guardrail: { blocked: false, violations: [] },
      abstained: true,
    };
  }

  const role = routeQuestion(question);
  const allowed = new Set(toolsFor(role));
  const specs = TOOL_SPECS.filter((t) => allowed.has(t.name));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: question },
  ];

  const evidenceIds: string[] = [];
  const toolCalls: { name: string; ok: boolean }[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await complete(messages, specs);

    if (response.toolCalls.length === 0) {
      const guard = check(response.text, evidenceIds);
      if (!guard.ok) {
        logger.warn("chat response blocked by guardrails", {
          violations: guard.violations.length,
          uncited: guard.uncitedClaims.length,
        });
        return {
          answer:
            ABSTENTION_MESSAGE +
            (guard.violations.length
              ? `the draft answer made claims this product does not make (${guard.violations
                  .map((v) => v.reason)
                  .join("; ")}).`
              : `some figures had no evidence behind them (${guard.uncitedClaims.length} statement(s)).`),
          role,
          toolCalls,
          evidenceIds,
          guardrail: {
            blocked: true,
            violations: guard.violations.map((v) => ({ phrase: v.phrase, reason: v.reason })),
          },
          abstained: true,
        };
      }
      return {
        answer: response.text,
        role,
        toolCalls,
        evidenceIds,
        guardrail: { blocked: false, violations: [] },
        abstained: false,
      };
    }

    for (const call of response.toolCalls) {
      if (!allowed.has(call.name)) {
        messages.push({
          role: "assistant",
          content: `Tool ${call.name} is not available to the ${role} role.`,
        });
        toolCalls.push({ name: call.name, ok: false });
        continue;
      }
      const result = await execute(call.name, call.input);
      toolCalls.push({ name: call.name, ok: result.ok });
      if (result.ok) {
        evidenceIds.push(...result.evidenceIds);
        messages.push({
          role: "assistant",
          content: `Tool ${call.name} returned:\n${JSON.stringify(result.data, null, 1).slice(0, 12000)}`,
        });
      } else {
        messages.push({ role: "assistant", content: `Tool ${call.name} failed: ${result.error}` });
      }
    }
  }

  return {
    answer:
      ABSTENTION_MESSAGE +
      "I could not ground an answer within the allowed number of retrieval rounds.",
    role,
    toolCalls,
    evidenceIds,
    guardrail: { blocked: false, violations: [] },
    abstained: true,
  };
}
