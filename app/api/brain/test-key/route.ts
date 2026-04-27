// GET /api/brain/test-key?provider=openai|anthropic
// Makes a minimal live API call to verify the stored key actually works.

import { NextRequest, NextResponse } from "next/server";
import { getBrainSecrets } from "@/lib/context-builder";

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider");

  if (provider === "openai") {
    const { openaiKey } = await getBrainSecrets();
    const key = openaiKey ?? process.env.OPENAI_API_KEY ?? "";
    if (!key) return NextResponse.json({ ok: false, error: "No key set" });

    try {
      const t0 = Date.now();
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const latencyMs = Date.now() - t0;
      if (resp.ok) return NextResponse.json({ ok: true, latencyMs });
      const err = await resp.json().catch(() => ({}));
      return NextResponse.json({ ok: false, error: err?.error?.message ?? `HTTP ${resp.status}` });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) });
    }
  }

  if (provider === "anthropic") {
    const { anthropicKey } = await getBrainSecrets();
    const key = anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    if (!key) return NextResponse.json({ ok: false, error: "No key set" });

    try {
      const t0 = Date.now();
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const latencyMs = Date.now() - t0;
      if (resp.ok) return NextResponse.json({ ok: true, latencyMs });
      const err = await resp.json().catch(() => ({}));
      return NextResponse.json({ ok: false, error: err?.error?.message ?? `HTTP ${resp.status}` });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) });
    }
  }

  return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 400 });
}
