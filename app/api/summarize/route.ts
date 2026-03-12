import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * POST /api/summarize
 *
 * Summarizes a session transcript into a short memory note for future sessions.
 *
 * Body:    { transcript: { speaker: string; text: string }[], mode: "therapist" | "digital_twin" }
 * Returns: { summary: string }
 */
export async function POST(req: NextRequest) {
  const { transcript, mode, previousMemory } = await req.json();

  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    return NextResponse.json({ summary: "" });
  }

  const transcriptText = transcript
    .map((t: { speaker: string; text: string }) => `${t.speaker}: ${t.text}`)
    .join("\n");

  const modeContext =
    mode === "therapist"
      ? "This was a therapy session between a user and a therapist."
      : "This was a conversation between a user and their digital twin avatar.";

  const previousContext = previousMemory
    ? `Previous session memory:\n${previousMemory}\n\n`
    : "";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system:
      "You are a session memory summarizer. Create a concise note (4–6 sentences) capturing the key topics, emotions, and insights across all sessions. Merge any previous memory with the new session — preserve important ongoing context and add new developments. This note will be injected into future sessions to provide continuity of memory.",
    messages: [
      {
        role: "user",
        content: `${modeContext}\n\n${previousContext}New session transcript:\n${transcriptText}\n\nWrite a merged memory note covering all sessions so far.`,
      },
    ],
  });

  const summary =
    response.content[0].type === "text" ? response.content[0].text : "";

  return NextResponse.json({ summary });
}
