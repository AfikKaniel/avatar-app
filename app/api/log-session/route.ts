import { NextRequest, NextResponse } from "next/server";
import { logSession } from "@/lib/db";

/**
 * POST /api/log-session
 *
 * Body: { mode, language, goal, goalTarget, goalCurrent, summary }
 * Logs an anonymous session record to Postgres for later analysis.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mode, language, goal, goalTarget, goalCurrent, summary } = body;

    if (!mode) {
      return NextResponse.json({ error: "mode is required" }, { status: 400 });
    }

    await logSession({ mode, language: language ?? "en", goal, goalTarget, goalCurrent, summary });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[log-session] error:", err);
    return NextResponse.json({ error: "Failed to log session" }, { status: 500 });
  }
}
