/**
 * Client-safe environment values.
 *
 * Separate from `env.ts` on purpose: `env.ts` loads the repo-root `.env` using
 * `node:fs`, which cannot be bundled for the browser. Anything a client
 * component needs lives here instead.
 */
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "BABull",
  displayTimezone: process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE ?? "Asia/Dhaka",
} as const;
