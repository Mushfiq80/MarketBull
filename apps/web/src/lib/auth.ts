import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { serverEnv } from "@/lib/env";

/**
 * Current user.
 *
 * SINGLE_OPERATOR_MODE resolves to the seeded operator without a session, so
 * local R&D needs no login. The schema is multi-user throughout, so adding real
 * auth later does not require touching any query.
 */
export async function currentUserId(): Promise<string | null> {
  if (serverEnv().SINGLE_OPERATOR_MODE) {
    try {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "operator"))
        .limit(1);
      return row?.id ?? null;
    } catch {
      return null;
    }
  }
  // Real session lookup goes here when SINGLE_OPERATOR_MODE is turned off.
  return null;
}

export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new Error("UNAUTHORIZED");
  return id;
}
