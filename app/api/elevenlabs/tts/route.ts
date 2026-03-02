import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/elevenlabs/tts
 *
 * Converts text to speech using ElevenLabs with the user's cloned voice.
 * Returns raw audio/mpeg so the browser can play it directly.
 *
 * Body: { voiceId: string, text: string }
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });
  }

  const { voiceId, text } = await req.json();
  if (!voiceId || !text) {
    return NextResponse.json({ error: "voiceId and text are required" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("ElevenLabs TTS error:", body);
    return NextResponse.json({ error: `TTS failed: ${body}` }, { status: res.status });
  }

  const audioBuffer = await res.arrayBuffer();
  return new NextResponse(audioBuffer, {
    headers: { "Content-Type": "audio/mpeg" },
  });
}
