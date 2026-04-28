// POST /api/brain/metric-insight
// Generates a personalized one-paragraph insight for a specific health metric
// using the GAGING brain config + user health snapshot + Claude.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getBrainConfig } from "@/lib/context-builder";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getHealthSnapshot(userId: string) {
  try {
    const result = await sql`
      SELECT hrv, resting_hr, sleep_hours, sleep_quality, steps, active_energy, recovery_score, health_state
      FROM   health_snapshots
      WHERE  user_id = ${userId}
      ORDER  BY created_at DESC
      LIMIT  1
    `;
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const { userId, metric, value, healthState } = await req.json();

    if (!metric || !value) {
      return NextResponse.json({ error: "metric and value are required" }, { status: 400 });
    }

    const [brainConfig, snapshot] = await Promise.all([
      getBrainConfig(),
      userId ? getHealthSnapshot(userId) : Promise.resolve(null),
    ]);

    const healthContext = snapshot
      ? `Current health data: HRV ${snapshot.hrv ?? "?"}ms, resting HR ${snapshot.resting_hr ?? "?"}bpm, sleep ${snapshot.sleep_hours ?? "?"}h, steps ${snapshot.steps ?? "?"}, recovery ${snapshot.recovery_score ?? "?"}%, state: ${snapshot.health_state ?? healthState ?? "good"}.`
      : `Health state: ${healthState ?? "good"}.`;

    const systemPrompt = `${brainConfig.personaPrompt}\n\n${brainConfig.knowledgeRules}\n\n${brainConfig.responseStyle}\n\n${brainConfig.safetyRules}`;

    const userPrompt = `${healthContext}\n\nThe user tapped on their ${metric} metric which currently shows ${value}. Give a single insightful 2-sentence response about this specific metric: what it means for them today, and one concrete action they can take. Be direct and personal. No bullet points.`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const insight = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    return NextResponse.json({ insight });
  } catch (err) {
    console.error("metric-insight error:", err);
    return NextResponse.json(
      { insight: "Keep monitoring this metric — consistency is what drives lasting change." },
      { status: 200 }
    );
  }
}
