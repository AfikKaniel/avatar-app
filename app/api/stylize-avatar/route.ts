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
  if (!apiKey) {
    return NextResponse.json({ error: "STABILITY_API_KEY not configured" }, { status: 500 });
  }

  const incoming = await req.formData();
  const photo = incoming.get("photo") as File | null;
  if (!photo) {
    return NextResponse.json({ error: "photo is required" }, { status: 400 });
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
  body.append("strength", "0.45");   // 0 = keep original, 1 = ignore original
  body.append("output_format", "jpeg");

  const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[stylize-avatar] Stability AI error:", err);
    return NextResponse.json({ error: "Stylization failed" }, { status: 500 });
  }

  const data = await res.json();
  if (!data.image) {
    return NextResponse.json({ error: "No image returned" }, { status: 500 });
  }

  const buffer = Buffer.from(data.image, "base64");
  return new NextResponse(buffer, {
    headers: { "Content-Type": "image/jpeg" },
  });
}
