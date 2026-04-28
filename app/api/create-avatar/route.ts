import { NextRequest, NextResponse } from "next/server";
import { getAvatarSecrets } from "@/lib/db";

export const maxDuration = 60;

/**
 * POST /api/create-avatar
 * Body: multipart/form-data — selfie (image file) + sex + bodyType + bodyFat
 *
 * Uses Stability AI SD3-Large-Turbo image-to-image to transform a selfie into
 * a full-body holographic avatar character. No FAL.ai dependency.
 *
 * X-Avatar-Status header:
 *   "success"            → real AI-generated avatar JPEG
 *   "fallback:<reason>"  → generation failed; iOS falls back to client-side filter
 */

export async function POST(req: NextRequest) {
  const { stabilityKey } = await getAvatarSecrets();
  const apiKey = (stabilityKey ?? process.env.STABILITY_API_KEY ?? "").trim();

  const form = await req.formData();
  const selfieFile = form.get("selfie") as File | null;
  const sex      = ((form.get("sex")      as string) ?? "Female").trim();
  const bodyType = ((form.get("bodyType") as string) ?? "average").trim().toLowerCase();
  const bodyFat  = ((form.get("bodyFat")  as string) ?? "normal").trim().toLowerCase();

  if (!selfieFile) {
    return NextResponse.json({ error: "selfie is required" }, { status: 400 });
  }

  async function fallback(reason: string): Promise<NextResponse> {
    console.warn(`[create-avatar] fallback(${reason})`);
    return NextResponse.json(
      { error: reason },
      { status: 503, headers: { "X-Avatar-Status": `fallback:${reason}` } }
    );
  }

  if (!apiKey) return fallback("no-stability-key");

  // ── Build prompt ──────────────────────────────────────────────────────────
  const genderWord = sex === "Male" ? "male" : "female";

  const buildDesc: Record<string, string> = {
    slim:     "slim lean physique, natural minimal muscle definition",
    average:  "average everyday physique, realistic proportions, some natural muscle tone but not athletic, normal body fat",
    athletic: "athletic fit physique, toned muscles, healthy lean build",
    muscular: "muscular defined physique, strong broad shoulders, visible muscle groups",
  };
  const fatDesc: Record<string, string> = {
    lean:    "very lean low body fat",
    normal:  "normal healthy body fat distribution",
    heavy:   "slightly heavier build, soft body, higher body fat",
  };

  const build = buildDesc[bodyType] ?? buildDesc["average"];
  const fat   = fatDesc[bodyFat]   ?? fatDesc["normal"];

  // ── Call Stability AI SD3-Large-Turbo img2img ─────────────────────────────
  const body = new FormData();
  body.append("image", selfieFile);
  body.append(
    "prompt",
    `full body ${genderWord} person, same face and identity as the reference photo, ` +
    `eyes open looking directly forward with confidence, ` +
    `standing upright, arms relaxed at sides, feet together, ` +
    `${build}, ${fat}, ` +
    `smooth luminous bioluminescent skin with a subtle soft blue-white inner glow, ` +
    `gentle cyan and purple rim lighting, clean dark void background, ` +
    `stylized cinematic 3D CGI character render, smooth skin, 4k, full length head to toe`
  );
  body.append(
    "negative_prompt",
    "circuit patterns, HUD, grid, tech lines, wires, data streams, cyberpunk, " +
    "closed eyes, sleepy, tired, dead eyes, zombie, expressionless, creepy, " +
    "obese, fat, extremely skinny, bodybuilder, overly muscular, unrealistic proportions, " +
    "portrait only, cropped body, missing legs, missing feet, watermark, text, extra limbs"
  );
  body.append("mode",          "image-to-image");
  body.append("model",         "sd3-large-turbo");
  body.append("strength",      "0.60"); // higher than stylize-avatar to allow full-body transformation
  body.append("output_format", "jpeg");

  try {
    const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept:        "image/*",
      },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[create-avatar] Stability AI ${res.status}:`, err.slice(0, 300));
      return fallback(`stability-${res.status}`);
    }

    const imageBuffer = Buffer.from(await res.arrayBuffer());
    console.log(`[create-avatar] success — ${imageBuffer.length} bytes`);

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type":    "image/jpeg",
        "X-Avatar-Status": "success",
      },
    });
  } catch (err) {
    console.error("[create-avatar] network error:", err);
    return fallback(`network:${String(err).slice(0, 80)}`);
  }
}
