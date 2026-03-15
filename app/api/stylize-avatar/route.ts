import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Stability AI can take up to ~30s

/**
 * POST /api/stylize-avatar
 * Body: multipart/form-data with `photo` file
 * Returns: JPEG image bytes + X-Stylize-Status header for debugging
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.STABILITY_API_KEY;

  const incoming = await req.formData();
  const photo = incoming.get("photo") as File | null;
  if (!photo) {
    return NextResponse.json({ error: "photo is required" }, { status: 400 });
  }

  function originalResponse(reason: string) {
    console.warn(`[stylize-avatar] fallback(${reason})`);
    return photo!.arrayBuffer().then((ab) => {
      const buffer = Buffer.from(ab);
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": photo!.type || "image/jpeg",
          "X-Stylize-Status": `fallback:${reason}`,
        },
      });
    });
  }

  if (!apiKey) {
    return originalResponse("no-key");
  }

  const body = new FormData();
  body.append("image", photo);
  body.append(
    "prompt",
    "same person, preserve exact facial features and identity, professional digital avatar portrait, " +
    "cinematic studio lighting, clean dark navy blue background, sharp focus, high quality skin"
  );
  body.append("mode", "image-to-image");
  body.append("model", "sd3-turbo");
  body.append("strength", "0.25");
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
    return originalResponse(`network-error:${String(err).slice(0, 80)}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[stylize-avatar] Stability AI ${res.status}:`, errText);
    return originalResponse(`api-${res.status}`);
  }

  const data = await res.json();
  if (!data.image) {
    console.error("[stylize-avatar] No image in response:", JSON.stringify(data).slice(0, 200));
    return originalResponse("no-image-field");
  }

  const buffer = Buffer.from(data.image, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "X-Stylize-Status": "success",
    },
  });
}
