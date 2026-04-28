// POST /api/chat
// Text chat endpoint. Builds a rich system prompt from brain config, HealthKit data,
// session memory, and RAG over uploaded medical documents, then calls Claude.
//
// Body: {
//   message:          string          — user's message
//   userId:           string          — device UUID (required for personalised context)
//   language?:        "en" | "he"
//   inlineHealthData?: { hrv, restingHr, sleepHours, sleepQuality,
//                        steps, activeEnergy, recoveryScore, healthState }
// }

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildContext, getAnthropicKey, getPrimaryModel } from "@/lib/context-builder";
import { ensureSchema } from "@/lib/db";

const LANGUAGE_SUFFIX: Record<string, string> = {
  en: "Always respond in English.",
  he: "Always respond in Hebrew (עברית). Use natural, conversational Hebrew.",
};

export async function POST(req: NextRequest) {
  await ensureSchema();

  const { message, userId, language, inlineHealthData } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const langSuffix = LANGUAGE_SUFFIX[language ?? "en"] ?? LANGUAGE_SUFFIX.en;

  // Build full context — includes brain config + health + memory + RAG over medical docs.
  // Falls back gracefully if userId is missing (no personalisation).
  const systemPrompt = userId
    ? await buildContext(userId, { query: message, inlineHealthData }).catch(
        () => defaultSystemPrompt(langSuffix)
      )
    : defaultSystemPrompt(langSuffix);

  const [apiKey, model] = await Promise.all([getAnthropicKey(), getPrimaryModel()]);
  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model,
    max_tokens: 400,
    system: `${systemPrompt}\n\n${langSuffix}`,
    messages: [{ role: "user", content: message }],
  });

  const reply =
    response.content[0].type === "text" ? response.content[0].text : "";

  return NextResponse.json({ reply });
}

function defaultSystemPrompt(langSuffix: string): string {
  return `You are GAGING — the user's personal AI health companion and digital twin.
You speak in first person as if you are a wiser, healthier version of the user themselves.
Keep responses conversational and concise (2–4 sentences). Never break character.
${langSuffix}`;
}
