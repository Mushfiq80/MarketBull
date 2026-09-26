import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { watchlistItemsWithScores } from "@/db/queries/portfolio";
import { latestSessionDate } from "@/db/queries/market";
import { watchlists } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { buildMeta, detectSample } from "../../_shared";

export const dynamic = "force-dynamic";

async function owned(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  const list = await owned(id, userId);
  if (!list) return fail("NOT_FOUND", "Watchlist not found.");

  const sessionDate = (await latestSessionDate()) ?? new Date().toISOString().slice(0, 10);
  const items = await watchlistItemsWithScores(id, sessionDate);
  return ok(
    { watchlist: list, sessionDate, items },
    await buildMeta({ asOf: `${sessionDate}T00:00:00Z`, sampleData: detectSample(items as never) }),
  );
}

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  if (!(await owned(id, userId))) return fail("NOT_FOUND", "Watchlist not found.");

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("VALIDATION_FAILED", "Invalid payload.");

  const [row] = await db
    .update(watchlists)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(watchlists.id, id))
    .returning();
  return ok(row, await buildMeta());
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  if (!(await owned(id, userId))) return fail("NOT_FOUND", "Watchlist not found.");

  await db.delete(watchlists).where(eq(watchlists.id, id));
  return ok({ deleted: id }, await buildMeta());
}
