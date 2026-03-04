import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

/**
 * POST /api/hedra/save-photo
 *
 * Uploads the user's photo to Vercel Blob (works in production + locally).
 * Returns the public photo URL so the chat page can pass it to the agent.
 *
 * Body: FormData with fields:
 *   photo   — image file (JPEG)
 *   voiceId — ElevenLabs cloned voice ID
 */
export async function POST(req: NextRequest) {
  const form    = await req.formData();
  const photo   = form.get("photo")   as File   | null;
  const voiceId = form.get("voiceId") as string | null;

  if (!photo || !voiceId) {
    return NextResponse.json(
      { error: "photo and voiceId are required" },
      { status: 400 }
    );
  }

  // Upload photo to Vercel Blob (public, so the Python agent can download it)
  try {
    const blob = await put(`avatars/${Date.now()}.jpg`, photo, {
      access: "public",
    });
    return NextResponse.json({ success: true, photoUrl: blob.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Vercel Blob upload failed:", message);
    return NextResponse.json({ error: `Blob upload failed: ${message}` }, { status: 500 });
  }
}
