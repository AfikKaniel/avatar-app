import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Stability AI can take up to ~30s

/**
 * POST /api/stylize-avatar
 * Body: multipart/form-data with `photo` file
 * Returns: JPEG image bytes
 *
 * Calls Stability AI SD3-Turbo img2img to transform the user's photo
 * into a professional digital avatar portrait.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.STABILITY_API_KEY;

  const incoming = await req.formData();
  const photo = incoming.get("photo") as File | null;
  if (!photo) {
    return NextResponse.json({ error: "photo is required" }, { status: 400 });
  }

  // No API key → pass the original photo through unchanged so onboarding never breaks
  if (!apiKey) {
    console.warn("[stylize-avatar] STABILITY_API_KEY not set — returning original photo");
    const buffer = Buffer.from(await photo.arrayBuffer());
    return new NextResponse(buffer, { headers: { "Content-Type": photo.type || "image/jpeg" } });
  }

  const body = new FormData();
  body.append("image", photo);
  body.append(
    "prompt",
    "professional digital avatar portrait, studio lighting, clean dark navy blue background, " +
    "electric blue glowing eyes, cinematic lighting, sharp focus, high quality, detailed skin"
  );
  body.append("mode", "image-to-image");
  body.append("model", "sd3-turbo");
  body.append("strength", "0.35");
  body.append("output_format", "jpeg");

  let res: Response;
  try {
    res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body,
    });
  } catch (err) {
    console.error("[stylize-avatar] Network error:", err);
    // Fallback: return original
    const buffer = Buffer.from(await photo.arrayBuffer());
    return new NextResponse(buffer, { headers: { "Content-Type": photo.type || "image/jpeg" } });
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[stylize-avatar] Stability AI ${res.status}:`, errText);
    // Fallback: return original so the user isn't stuck
    const buffer = Buffer.from(await photo.arrayBuffer());
    return new NextResponse(buffer, { headers: { "Content-Type": photo.type || "image/jpeg" } });
  }

  const data = await res.json();
  if (!data.image) {
    const buffer = Buffer.from(await photo.arrayBuffer());
    return new NextResponse(buffer, { headers: { "Content-Type": photo.type || "image/jpeg" } });
  }

  const buffer = Buffer.from(data.image, "base64");
  return new NextResponse(buffer, { headers: { "Content-Type": "image/jpeg" } });
}
