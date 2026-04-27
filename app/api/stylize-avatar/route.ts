import { NextRequest, NextResponse } from "next/server";
import { getAvatarSecrets } from "@/lib/db";

export const maxDuration = 60;

/**
 * POST /api/stylize-avatar
 * Body: multipart/form-data with `photo` file
 * Returns: JPEG image bytes + X-Stylize-Status header
 *
 * Uses Stability AI SD3-Large-Turbo img2img to transform the user's face photo
 * into a clean stylized avatar portrait that Hedra animates for the talking head.
 * Falls back to the original photo on any error so Hedra still has something to work with.
 *
 * Key fix from previous version: model must be "sd3-large-turbo" not "sd3-turbo".
 * sd3-turbo does NOT support image-to-image mode.
 */
export async function POST(req: NextRequest) {
  const { stabilityKey } = await getAvatarSecrets();
  const apiKey = stabilityKey ?? process.env.STABILITY_API_KEY ?? "";

  const incoming = await req.formData();
  const photo = incoming.get("photo") as File | null;
  if (!photo) {
    return NextResponse.json({ error: "photo is required" }, { status: 400 });
  }

  async function fallback(reason: string): Promise<NextResponse> {
    console.warn(`[stylize-avatar] fallback: ${reason}`);
    const ab = await photo!.arrayBuffer();
    return new NextResponse(Buffer.from(ab), {
      headers: {
        "Content-Type": photo!.type || "image/jpeg",
        "X-Stylize-Status": `fallback:${reason}`,
      },
    });
  }

  if (!apiKey) return fallback("no-stability-key");

  const body = new FormData();
  body.append("image", photo);
  body.append(
    "prompt",
    "close-up face portrait of the same person, exact facial identity preserved, " +
    "eyes open looking directly forward with calm confidence, " +
    "smooth luminous bioluminescent skin with soft blue-white inner glow, " +
    "gentle cyan and purple rim lighting, dark void background, " +
    "stylized cinematic 3D CGI avatar render, head and shoulders only, 4k, sharp focus"
  );
  body.append(
    "negative_prompt",
    "different person, altered identity, sunglasses, closed eyes, " +
    "full body, torso below chest, circuit patterns, HUD overlay, " +
    "cartoon, anime, 2D illustration, watermark, text, blurry"
  );
  body.append("mode", "image-to-image");
  body.append("model", "sd3-large-turbo");
  body.append("strength", "0.35");
  body.append("output_format", "jpeg");

  try {
    const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "image/*",
      },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[stylize-avatar] Stability AI ${res.status}:`, err.slice(0, 300));
      return fallback(`stability-${res.status}`);
    }

    const imageBuffer = Buffer.from(await res.arrayBuffer());
    console.log(`[stylize-avatar] success — ${imageBuffer.length} bytes`);

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "X-Stylize-Status": "success",
      },
    });
  } catch (err) {
    console.error("[stylize-avatar] network error:", err);
    return fallback(`network:${String(err).slice(0, 80)}`);
  }
}
