// GET  /api/brain/secrets  → masked keys + model settings
// PUT  /api/brain/secrets  → upsert (pass null to clear a key)

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "@/lib/db";

function mask(key: string | null): string | null {
  if (!key || key.length < 8) return key;
  return key.slice(0, 7) + "•".repeat(Math.min(key.length - 7, 20));
}

export async function GET() {
  await ensureSchema();
  const rows = await sql`SELECT * FROM brain_secrets WHERE id = 1`;
  const r = rows.rows[0];

  // Fall back to env vars for display status when no DB row
  const openaiSet  = r ? !!r.openai_key    : !!process.env.OPENAI_API_KEY;
  const anthropicSet = r ? !!r.anthropic_key : !!process.env.ANTHROPIC_API_KEY;

  return NextResponse.json({
    openaiKey:     r ? mask(r.openai_key)    : (process.env.OPENAI_API_KEY    ? "sk-••• (env var)" : null),
    anthropicKey:  r ? mask(r.anthropic_key) : (process.env.ANTHROPIC_API_KEY ? "sk-ant-••• (env var)" : null),
    primaryModel:  r?.primary_model  ?? "claude-haiku-4-5-20251001",
    ragThreshold:  r?.rag_threshold  ?? 0.25,
    openaiSet,
    anthropicSet,
  });
}

export async function PUT(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const { openaiKey, anthropicKey, primaryModel, ragThreshold } = body;

  await sql`
    INSERT INTO brain_secrets (id, openai_key, anthropic_key, primary_model, rag_threshold, updated_at)
    VALUES (
      1,
      ${openaiKey ?? null},
      ${anthropicKey ?? null},
      ${primaryModel ?? "claude-haiku-4-5-20251001"},
      ${ragThreshold ?? 0.25},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      openai_key    = COALESCE(EXCLUDED.openai_key,    brain_secrets.openai_key),
      anthropic_key = COALESCE(EXCLUDED.anthropic_key, brain_secrets.anthropic_key),
      primary_model = EXCLUDED.primary_model,
      rag_threshold = EXCLUDED.rag_threshold,
      updated_at    = NOW()
  `;

  return NextResponse.json({ ok: true });
}
