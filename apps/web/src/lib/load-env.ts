import fs from "node:fs";
import path from "node:path";

// Namespace import with a defensive runtime fallback, not a plain default or
// named import: @next/env is CommonJS, and the two toolchains that load this
// file disagree on how to reach its exports.
//   - Under `tsx` (real Node ESM, used by the seed scripts): the named export
//     `loadEnvConfig` is not statically detected by Node's CJS/ESM interop,
//     but the whole `module.exports` object always lands on `.default`.
//   - Under Next's own `next.config.ts` loader (its SWC-compiled CommonJS):
//     `@next/env` carries an `__esModule` flag with no real `.default`
//     property, so the namespace object IS the module and `loadEnvConfig`
//     sits on it directly — `.default` is undefined there.
// Checking both shapes at runtime is the only way this works under both.
import * as nextEnvNS from "@next/env";
const nextEnvAny = nextEnvNS as unknown as {
  loadEnvConfig?: typeof import("@next/env").loadEnvConfig;
  default?: typeof import("@next/env");
};
const loadEnvConfig = nextEnvAny.loadEnvConfig ?? nextEnvAny.default!.loadEnvConfig;

/**
 * Load the single repo-root `.env`.
 *
 * There is ONE environment file for the whole project, at the repo root, because
 * the web app and the Python quant service must agree on DATABASE_URL and
 * QUANT_SERVICE_TOKEN. Keeping two copies in sync by hand is how a "401 from the
 * quant service" mystery starts.
 *
 * Next.js, drizzle-kit and the tsx seed scripts all run with `apps/web` as their
 * working directory, so none of them would find the root file on their own. This
 * module is imported for its side effect by `next.config.ts`, `drizzle.config.ts`
 * and every script under `src/db/seed/`.
 *
 * `apps/web/.env.local` still works and takes precedence, for machine-specific
 * overrides you do not want in the shared file.
 */

/** Walk up from the working directory to the workspace root. */
function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  for (let depth = 0; depth < 6; depth++) {
    const pkg = path.join(current, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, "utf8")) as { workspaces?: unknown };
        if (parsed.workspaces) return current;
      } catch {
        // Unreadable package.json — keep walking rather than guessing.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fall back to the conventional layout so a missing root package.json does not
  // turn into a confusing "DATABASE_URL is not set".
  return path.resolve(start, "../..");
}

const repoRoot = findRepoRoot(process.cwd());

loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", {
  info: () => {}, // Next already logs its own env loading; do not double up.
  error: (...args: unknown[]) => console.error(...args),
});

export { repoRoot };
