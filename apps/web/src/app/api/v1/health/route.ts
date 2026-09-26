import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { serverEnv } from "@/lib/env";
import { quant } from "@/lib/quant/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await db.execute(sql`select 1`);
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, detail: String(err) };
  }

  try {
    const health = await quant.health();
    checks.quantService = { ok: health.status === "ok", detail: health.status };
  } catch (err) {
    checks.quantService = { ok: false, detail: String(err) };
  }

  try {
    const env = serverEnv();
    checks.config = { ok: true, detail: `llm=${env.LLM_PROVIDER}` };
  } catch (err) {
    checks.config = { ok: false, detail: String(err) };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503 });
}
