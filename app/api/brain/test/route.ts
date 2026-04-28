// POST /api/brain/test
// Runs a live brain test: retrieves RAG chunks + generates a Claude response.
// Used by the admin Live Test tab to make the brain observable.

export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { searchRelevantChunks } from "@/lib/embeddings";
import { buildContext, getBrainSecrets, HealthSnapshot } from "@/lib/context-builder";

const ADMIN_USER_ID = "gaging-global";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { query, testHealthData } = body as { query?: string; testHealthData?: HealthSnapshot | null };

  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  const [allChunks, systemPrompt, secrets] = await Promise.all([
    searchRelevantChunks(ADMIN_USER_ID, query, 5).catch(() => []),
    buildContext(ADMIN_USER_ID, { query, inlineHealthData: testHealthData ?? undefined, isTestData: !!testHealthData }).catch(() => ""),
    getBrainSecrets(),
  ]);

  const anthropicKey = secrets.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const model        = secrets.primaryModel;

  // Only show chunks that actually passed the threshold so the UI reflects
  // what the model saw — not the raw over-retrieval set.
  const chunks = allChunks.filter((c) => c.similarity >= secrets.ragThreshold);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: query }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return NextResponse.json({ error: `Claude error: ${err}` }, { status: 502 });
  }

  const data = await resp.json();
  const response: string = data.content?.[0]?.text ?? "";

  return NextResponse.json({ chunks, response, systemPrompt, modelUsed: model });
}
