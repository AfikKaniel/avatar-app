// GET /api/brain/config   — read current brain config
// PUT /api/brain/config   — overwrite brain config

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getBrainConfig, BrainConfig } from "@/lib/context-builder";
import { ensureSchema } from "@/lib/db";

export async function GET() {
  await ensureSchema();
  const config = await getBrainConfig();
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  await ensureSchema();
  const body: BrainConfig = await req.json();

  const { personaPrompt, knowledgeRules, responseStyle, safetyRules } = body;
  if (!personaPrompt || !knowledgeRules || !responseStyle || !safetyRules) {
    return NextResponse.json(
      { error: "All four fields are required: personaPrompt, knowledgeRules, responseStyle, safetyRules" },
      { status: 400 }
    );
  }

  await sql`
    INSERT INTO brain_config (id, persona_prompt, knowledge_rules, response_style, safety_rules, updated_at)
    VALUES (1, ${personaPrompt}, ${knowledgeRules}, ${responseStyle}, ${safetyRules}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      persona_prompt  = EXCLUDED.persona_prompt,
      knowledge_rules = EXCLUDED.knowledge_rules,
      response_style  = EXCLUDED.response_style,
      safety_rules    = EXCLUDED.safety_rules,
      updated_at      = NOW()
  `;

  return NextResponse.json({ ok: true });
}
