import "./src/lib/load-env";

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // No fallback on purpose: a silent default would let migrations run against
    // the wrong database and look like they worked.
    url: mustHaveDatabaseUrl(),
  },
  verbose: true,
  strict: true,
});

function mustHaveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env at the REPO ROOT " +
        "(D:\\Projects\\BABull\\.env), not inside apps/web, and set DATABASE_URL.",
    );
  }
  return url;
}
