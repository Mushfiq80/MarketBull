import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { scoreSnapshots, watchlistItems, watchlists } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { buildMeta } from "../../../_shared";

export const dynamic = "force-dynamic";

const AddBody = z.object({
  instrumentId: z.string().uuid(),
  note: z.string().max(2000).optional(),
  userThesis: z.string().max(4000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");

  const [list] = await db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)))
    .limit(1);
  if (!list) return fail("NOT_FOUND", "Watchlist not found.");

  const parsed = AddBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("VALIDATION_FAILED", "instrumentId must be a uuid.");

  // Capture the score at add time so drift since then is measurable later.
  const [latest] = await db
    .select({ composite: scoreSnapshots.composite })
    .from(scoreSnapshots)
    .where(
      and(
        eq(scoreSnapshots.instrumentId, parsed.data.instrumentId),
        eq(scoreSnapshots.horizon, "medium"),
      ),
    )
    .orderBy(desc(scoreSnapshots.sessionDate))
    .limit(1);

  const [row] = await db
    .insert(watchlistItems)
    .values({
      watchlistId: id,
      instrumentId: parsed.data.instrumentId,
      note: parsed.data.note,
      userThesis: parsed.data.userThesis,
      scoreAtAdd: latest?.composite ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) return fail("VALIDATION_FAILED", "That instrument is already in this watchlist.");
  return ok(row, await buildMeta());
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");

  const url = new URL(request.url);
  const instrumentId = url.searchParams.get("instrumentId");
  if (!instrumentId) return fail("VALIDATION_FAILED", "instrumentId query parameter is required.");

  const [list] = await db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)))
    .limit(1);
  if (!list) return fail("NOT_FOUND", "Watchlist not found.");

  await db
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.watchlistId, id), eq(watchlistItems.instrumentId, instrumentId)));
  return ok({ removed: instrumentId }, await buildMeta());
}
