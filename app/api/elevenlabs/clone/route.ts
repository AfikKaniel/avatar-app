import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/elevenlabs/clone
 *
 * Accepts a voice recording (multipart/form-data with field "audio"),
 * sends it to ElevenLabs Instant Voice Cloning, and returns the new voice ID.
 *
 * Returns: { voiceId: string }
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });
  }

  // ── 1. Parse audio file from form data ──────────────────────────────────
  const form = await req.formData();
  const audio = form.get("audio") as File | null;
  if (!audio) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }

  // ── 2. Forward to ElevenLabs IVC endpoint ───────────────────────────────
  // ElevenLabs expects multipart/form-data with:
  //   name        — voice label
  //   files[]     — one or more audio files (≥1 minute recommended)
  const elevenlabsForm = new FormData();
  elevenlabsForm.append("name", "My Cloned Voice");
  elevenlabsForm.append("description", "Cloned from user onboarding recording");
  elevenlabsForm.append("remove_background_noise", "false");
  // Re-attach the audio file with a .mp3 extension so ElevenLabs accepts it
  elevenlabsForm.append("files", audio, "voice.mp3");

  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      // NOTE: Do NOT set Content-Type — fetch sets it with the boundary automatically
    },
    body: elevenlabsForm,
  });

  if (!res.ok) {
    const body = await res.text();
    console.log("ElevenLabs error:", body);
    return NextResponse.json({ error: `Voice cloning failed: ${body}` }, { status: 500 });
  }

  const data = await res.json();
  return NextResponse.json({ voiceId: data.voice_id });
}
