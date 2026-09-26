import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * One pool per process. Next.js dev-mode HMR re-imports modules, so the pool is
 * cached on globalThis to avoid leaking connections on every file save.
 */
const globalForDb = globalThis as unknown as { __babullPool?: Pool };

function pool(): Pool {
  if (!globalForDb.__babullPool) {
    globalForDb.__babullPool = new Pool({
      connectionString: serverEnv().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      // Financial values arrive as decimal strings. Do NOT let pg parse
      // numeric into JS float — precision loss on money is unacceptable.
    });
  }
  return globalForDb.__babullPool;
}

export const db = drizzle(pool(), { schema, casing: "snake_case" });
export type Db = typeof db;
export { schema };
