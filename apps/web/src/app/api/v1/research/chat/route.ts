import { z } from "zod";

import { answer } from "@/lib/ai/chat";
import { fail, ok } from "@/lib/api/envelope";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  question: z.string().min(2).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(12)
    .optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", "A question between 2 and 2000 characters is required.");
  }

  try {
    const turn = await answer(parsed.data.question, parsed.data.history ?? []);
    if (turn.guardrail.blocked) {
      // Surfaced as a normal response, not an error: abstention is a valid answer.
      return ok(turn, await buildMeta());
    }
    return ok(turn, await buildMeta());
  } catch (err) {
    return fail("INTERNAL", String(err));
  }
}
