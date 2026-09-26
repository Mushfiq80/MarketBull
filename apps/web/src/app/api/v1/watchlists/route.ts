import { z } from "zod";

import { db } from "@/db/client";
import { listWatchlists } from "@/db/queries/portfolio";
import { watchlists } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { buildMeta } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  const rows = await listWatchlists(userId);
  return ok({ count: rows.length, watchlists: rows }, await buildMeta());
}

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
});

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");

  const parsed = CreateBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("VALIDATION_FAILED", "A name is required.");

  const [row] = await db
    .insert(watchlists)
    .values({ userId, name: parsed.data.name, description: parsed.data.description })
    .returning();
  return ok(row, await buildMeta());
}
