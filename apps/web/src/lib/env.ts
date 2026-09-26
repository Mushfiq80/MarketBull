// Side-effect import: loads the repo-root .env. Placed here rather than only in
// next.config.ts because Next spawns separate workers for build and for route
// handlers, and each needs the variables in its own process.
import "./load-env";

import { z } from "zod";

/**
 * Server-side environment. Validated once, at first import, so a
 * misconfiguration fails at boot rather than at 2am in a route handler.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),

  QUANT_SERVICE_URL: z.string().url().default("http://127.0.0.1:8000"),
  QUANT_SERVICE_TOKEN: z.string().min(16, "QUANT_SERVICE_TOKEN must be at least 16 chars"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),

  LLM_PROVIDER: z.enum(["anthropic", "openai", "google", "none"]).default("none"),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_EMBEDDING_MODEL: z.string().optional(),
  LLM_EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),

  SINGLE_OPERATOR_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCheck your .env against .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Re-exported for convenience on the server. Client code imports it directly
 *  from `./public-env`, which has no Node dependencies. */
export { publicEnv } from "./public-env";
