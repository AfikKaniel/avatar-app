// GET /api/avatar/test-key?provider=hedra|elevenlabs|stability|fal|livekit
// Makes a minimal live call to verify each avatar platform key.

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "@/lib/db";
import { RoomServiceClient } from "livekit-server-sdk";

async function getSecrets() {
  try {
    await ensureSchema();
    const rows = await sql`SELECT * FROM avatar_secrets WHERE id = 1`;
    return rows.rows[0] ?? {};
  } catch { return {}; }
}

function resolve(dbVal: string | null | undefined, envKey: string): string {
  return (dbVal || process.env[envKey] || "").trim();
}

async function ping(url: string, headers: Record<string, string>) {
  const t0 = Date.now();
  const resp = await fetch(url, { headers });
  return { ok: resp.ok || resp.status < 500, latencyMs: Date.now() - t0, status: resp.status, resp };
}

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider");
  const r = await getSecrets();

  try {
    if (provider === "hedra") {
      const key = resolve(r.hedra_key, "HEDRA_API_KEY");
      if (!key) return NextResponse.json({ ok: false, error: "No key set" });
      const t0 = Date.now();
      // POST with no body — valid key returns 400 (missing fields), invalid key returns 401/403
      const resp = await fetch("https://api.hedra.com/public/livekit/v1/session", {
        method: "POST",
        headers: { "x-api-key": key },
      });
      const latencyMs = Date.now() - t0;
      if (resp.status === 401 || resp.status === 403)
        return NextResponse.json({ ok: false, error: "Invalid API key" });
      return NextResponse.json({ ok: true, latencyMs });
    }

    if (provider === "elevenlabs") {
      const key = resolve(r.elevenlabs_key, "ELEVENLABS_API_KEY");
      if (!key) return NextResponse.json({ ok: false, error: "No key set" });
      const { ok, latencyMs, status } = await ping("https://api.elevenlabs.io/v1/user", { "xi-api-key": key });
      if (status === 401 || status === 403) return NextResponse.json({ ok: false, error: "Invalid API key" });
      return NextResponse.json({ ok, latencyMs });
    }

    if (provider === "stability") {
      const key = resolve(r.stability_key, "STABILITY_API_KEY");
      if (!key) return NextResponse.json({ ok: false, error: "No key set" });
      const { ok, latencyMs, status } = await ping(
        "https://api.stability.ai/v2beta/user/balance",
        { Authorization: `Bearer ${key}` }
      );
      if (status === 401 || status === 403) return NextResponse.json({ ok: false, error: "Invalid API key" });
      return NextResponse.json({ ok, latencyMs });
    }

    if (provider === "fal") {
      const key = resolve(r.fal_key, "FAL_KEY");
      if (!key) return NextResponse.json({ ok: false, error: "No key set" });
      const t0 = Date.now();
      const resp = await fetch("https://rest.alpha.fal.run/billing/credits", {
        headers: { Authorization: `Key ${key}` },
      });
      const latencyMs = Date.now() - t0;
      if (resp.status === 401 || resp.status === 403) return NextResponse.json({ ok: false, error: "Invalid API key" });
      return NextResponse.json({ ok: true, latencyMs });
    }

    if (provider === "livekit") {
      const apiKey    = resolve(r.livekit_key,    "LIVEKIT_API_KEY");
      const apiSecret = resolve(r.livekit_secret, "LIVEKIT_API_SECRET");
      const wsUrl     = resolve(r.livekit_url,    "LIVEKIT_URL");
      if (!apiKey || !apiSecret || !wsUrl) return NextResponse.json({ ok: false, error: "Key, secret and URL required" });
      const httpUrl = wsUrl.replace("wss://", "https://").replace("ws://", "http://");
      const t0 = Date.now();
      const client = new RoomServiceClient(httpUrl, apiKey, apiSecret);
      await client.listRooms();
      return NextResponse.json({ ok: true, latencyMs: Date.now() - t0 });
    }

    return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 400 });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAuth = msg.toLowerCase().includes("401") || msg.toLowerCase().includes("unauthorized");
    return NextResponse.json({ ok: false, error: isAuth ? "Invalid credentials" : msg });
  }
}
