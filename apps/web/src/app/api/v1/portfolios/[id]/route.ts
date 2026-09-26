import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { portfolioHoldings, portfolioTransactions } from "@/db/queries/portfolio";
import { portfolios } from "@/db/schema";
import { fail, ok } from "@/lib/api/envelope";
import { currentUserId } from "@/lib/auth";
import { buildMeta } from "../../_shared";

export const dynamic = "force-dynamic";

async function owned(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  const portfolio = await owned(id, userId);
  if (!portfolio) return fail("NOT_FOUND", "Portfolio not found.");

  const [holdings, transactions] = await Promise.all([
    portfolioHoldings(id),
    portfolioTransactions(id, 200),
  ]);
  return ok({ portfolio, holdings, transactions }, await buildMeta());
}

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  cashBalance: z.string().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  if (!(await owned(id, userId))) return fail("NOT_FOUND", "Portfolio not found.");

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail("VALIDATION_FAILED", "Invalid payload.");

  const [row] = await db
    .update(portfolios)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(portfolios.id, id))
    .returning();
  return ok(row, await buildMeta());
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return fail("UNAUTHORIZED", "No current user.");
  if (!(await owned(id, userId))) return fail("NOT_FOUND", "Portfolio not found.");
  await db.delete(portfolios).where(eq(portfolios.id, id));
  return ok({ deleted: id }, await buildMeta());
}
