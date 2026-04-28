// GET  /api/avatar/secrets  → masked keys + set status
// PUT  /api/avatar/secrets  → upsert (omit a field to leave it unchanged)

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "@/lib/db";

function mask(key: string | null): string | null {
  if (!key || key.length < 8) return key;
  return key.slice(0, 7) + "•".repeat(Math.min(key.length - 7, 20));
}

function envOr(dbVal: string | null | undefined, envKey: string) {
  return dbVal ?? (process.env[envKey] ? `(env var)` : null);
}

function isSet(dbVal: string | null | undefined, envKey: string) {
  return !!(dbVal || process.env[envKey]);
}

export async function GET() {
  await ensureSchema();
  const rows = await sql`SELECT * FROM avatar_secrets WHERE id = 1`;
  const r = rows.rows[0];

  return NextResponse.json({
    hedraKey:      mask(envOr(r?.hedra_key,      "HEDRA_API_KEY")),
    hedraSecret:   mask(envOr(r?.hedra_secret,   "HEDRA_API_SECRETS")),
    stabilityKey:  mask(envOr(r?.stability_key,  "STABILITY_API_KEY")),
    elevenlabsKey: mask(envOr(r?.elevenlabs_key, "ELEVENLABS_API_KEY")),
    livekitKey:    mask(envOr(r?.livekit_key,    "LIVEKIT_API_KEY")),
    livekitSecret: mask(envOr(r?.livekit_secret, "LIVEKIT_API_SECRET")),
    livekitUrl:          envOr(r?.livekit_url,   "LIVEKIT_URL"),

    hedraSet:      isSet(r?.hedra_key,      "HEDRA_API_KEY"),
    hedraSecretSet:isSet(r?.hedra_secret,   "HEDRA_API_SECRETS"),
    stabilitySet:  isSet(r?.stability_key,  "STABILITY_API_KEY"),
    elevenlabsSet: isSet(r?.elevenlabs_key, "ELEVENLABS_API_KEY"),
    livekitSet:    isSet(r?.livekit_key,    "LIVEKIT_API_KEY") &&
                   isSet(r?.livekit_secret, "LIVEKIT_API_SECRET") &&
                   isSet(r?.livekit_url,    "LIVEKIT_URL"),
  });
}

export async function PUT(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();

  await sql`
    INSERT INTO avatar_secrets (id, hedra_key, hedra_secret, stability_key, fal_key, elevenlabs_key, livekit_key, livekit_secret, livekit_url, updated_at)
    VALUES (
      1,
      ${body.hedraKey      ?? null},
      ${body.hedraSecret   ?? null},
      ${body.stabilityKey  ?? null},
      ${body.falKey        ?? null},
      ${body.elevenlabsKey ?? null},
      ${body.livekitKey    ?? null},
      ${body.livekitSecret ?? null},
      ${body.livekitUrl    ?? null},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      hedra_key      = COALESCE(EXCLUDED.hedra_key,      avatar_secrets.hedra_key),
      hedra_secret   = COALESCE(EXCLUDED.hedra_secret,   avatar_secrets.hedra_secret),
      stability_key  = COALESCE(EXCLUDED.stability_key,  avatar_secrets.stability_key),
      fal_key        = COALESCE(EXCLUDED.fal_key,        avatar_secrets.fal_key),
      elevenlabs_key = COALESCE(EXCLUDED.elevenlabs_key, avatar_secrets.elevenlabs_key),
      livekit_key    = COALESCE(EXCLUDED.livekit_key,    avatar_secrets.livekit_key),
      livekit_secret = COALESCE(EXCLUDED.livekit_secret, avatar_secrets.livekit_secret),
      livekit_url    = COALESCE(EXCLUDED.livekit_url,    avatar_secrets.livekit_url),
      updated_at     = NOW()
  `;

  return NextResponse.json({ ok: true });
}
