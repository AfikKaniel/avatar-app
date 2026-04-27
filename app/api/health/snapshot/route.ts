// POST /api/health/snapshot
// iOS sends a HealthKit snapshot on every session start.
// Stored in health_snapshots and used by buildContext() to personalise Claude's replies.

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "@/lib/db";

export async function POST(req: NextRequest) {
  await ensureSchema();

  const body = await req.json();
  const {
    userId,
    hrv,
    restingHr,
    sleepHours,
    sleepQuality,
    steps,
    activeEnergy,
    recoveryScore,
    healthState,
  } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  await sql`
    INSERT INTO health_snapshots
      (user_id, hrv, resting_hr, sleep_hours, sleep_quality, steps, active_energy, recovery_score, health_state)
    VALUES
      (${userId}, ${hrv ?? null}, ${restingHr ?? null}, ${sleepHours ?? null},
       ${sleepQuality ?? null}, ${steps ?? null}, ${activeEnergy ?? null},
       ${recoveryScore ?? null}, ${healthState ?? null})
  `;

  return NextResponse.json({ ok: true });
}
