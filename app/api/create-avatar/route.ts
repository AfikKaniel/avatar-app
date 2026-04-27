import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getAvatarSecrets } from "@/lib/db";

// Vercel Hobby plan silently caps at 60s regardless of this value.
// We use fal.ai's async queue + polling to stay well within that limit.
export const maxDuration = 60;

/**
 * POST /api/create-avatar
 * Body: multipart/form-data with `selfie` (image file) + `sex` ("Male" | "Female")
 *
 * Uses fal-ai/flux-pulid via the async queue API:
 *   1. Submit job to fal queue  → immediate requestId (~1s)
 *   2. Poll status every 2s     → result ready in ~20-45s
 *   3. Download result image    → return to iOS as binary JPEG
 *
 * X-Avatar-Status header tells the iOS client what happened:
 *   "success"          → real AI-generated avatar
 *   "fallback:<reason>" → something failed; body is the raw selfie
 */

export async function POST(req: NextRequest) {
  const { falKey: dbFalKey } = await getAvatarSecrets();
  const falKey = (dbFalKey ?? process.env.FAL_KEY ?? "").trim();

  const form = await req.formData();
  const selfieFile = form.get("selfie") as File | null;
  const sex      = ((form.get("sex")      as string) ?? "Female").trim();
  const bodyType = ((form.get("bodyType") as string) ?? "average").trim().toLowerCase();
  const bodyFat  = ((form.get("bodyFat")  as string) ?? "normal").trim().toLowerCase();

  if (!selfieFile) {
    return NextResponse.json({ error: "selfie is required" }, { status: 400 });
  }

  // Return 503 (not 200) so iOS throws instead of silently accepting the selfie.
  async function fallback(reason: string): Promise<NextResponse> {
    console.warn(`[create-avatar] fallback(${reason})`);
    return NextResponse.json(
      { error: reason },
      { status: 503, headers: { "X-Avatar-Status": `fallback:${reason}` } }
    );
  }

  if (!falKey) return fallback("no-fal-key");

  // ── Step 1: Upload selfie to Vercel Blob (~1-2s) ──────────────────────────
  let selfieUrl: string;
  try {
    const selfieBuffer = Buffer.from(await selfieFile.arrayBuffer());
    const blob = await put(
      `gaging-selfie-${Date.now()}.jpg`,
      selfieBuffer,
      { access: "public", contentType: selfieFile.type || "image/jpeg" }
    );
    selfieUrl = blob.url;
  } catch (err) {
    return fallback(`blob-upload:${String(err).slice(0, 80)}`);
  }

  // ── Step 2: Build prompt ──────────────────────────────────────────────────
  const genderWord = sex === "Male" ? "male" : "female";

  // Body build description from user selection
  const buildDesc: Record<string, string> = {
    slim:     "slim lean physique, natural minimal muscle definition",
    average:  "average everyday physique, realistic proportions, some natural muscle tone but not athletic, normal body fat",
    athletic: "athletic fit physique, toned muscles, healthy lean build",
    muscular: "muscular defined physique, strong broad shoulders, visible muscle groups",
  };
  const fatDesc: Record<string, string> = {
    lean:    "very lean low body fat",
    normal:  "normal healthy body fat distribution, natural skin folds",
    heavy:   "slightly heavier build, soft body, higher body fat",
  };
  const build = buildDesc[bodyType] ?? buildDesc["average"];
  const fat   = fatDesc[bodyFat]   ?? fatDesc["normal"];

  const prompt =
    `full body ${genderWord} person, same face and identity as the reference photo, ` +
    `eyes open looking directly forward with confidence, ` +
    `standing upright, arms relaxed at sides, feet together, ` +
    `${build}, ${fat}, ` +
    `smooth luminous bioluminescent skin with a subtle soft blue-white inner glow, ` +
    `gentle cyan and purple rim lighting, clean dark void background, ` +
    `stylized cinematic 3D CGI character render, smooth skin, 4k, full length head to toe`;

  const negativePrompt =
    "circuit, patterns, HUD, grid, tech lines, wires, data streams, cyberpunk, " +
    "closed eyes, sleepy, tired, dead eyes, zombie, expressionless, creepy, " +
    "obese, fat, extremely skinny, bodybuilder, overly muscular, unrealistic proportions, " +
    "portrait only, cropped body, missing legs, missing feet, watermark, text, extra limbs";

  // ── Step 3: Submit to fal.ai queue (returns immediately with requestId) ───
  let requestId: string;
  try {
    const queueRes = await fetch("https://queue.fal.run/fal-ai/flux-pulid", {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        negative_prompt: negativePrompt,
        reference_image_url: selfieUrl,
        id_weight: 0.85,
        num_steps: 25,
        guidance: 3.5,
        true_cfg: 1.0,
        start_step: 2,
        image_size: { width: 768, height: 1344 },
        num_images: 1,
      }),
    });

    if (!queueRes.ok) {
      const err = await queueRes.text();
      console.error(`[create-avatar] queue submit ${queueRes.status}:`, err.slice(0, 300));
      return fallback(`queue-submit-${queueRes.status}`);
    }

    const queueData = await queueRes.json();
    requestId = queueData.request_id;
    if (!requestId) return fallback("no-request-id");
  } catch (err) {
    return fallback(`queue-network:${String(err).slice(0, 80)}`);
  }

  // ── Step 4: Poll for result (budget: ~50s, poll every 2s = up to 25 tries) ─
  const pollUrl = `https://queue.fal.run/fal-ai/flux-pulid/requests/${requestId}`;
  const statusUrl = `${pollUrl}/status`;
  const maxPolls = 25;
  const pollInterval = 2000;

  let resultUrl: string | undefined;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    try {
      const statusRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${falKey}` },
      });

      if (!statusRes.ok) continue;

      const status = await statusRes.json();
      const state: string = status?.status ?? "";

      if (state === "COMPLETED") {
        // Fetch the actual result
        const resultRes = await fetch(pollUrl, {
          headers: { Authorization: `Key ${falKey}` },
        });
        if (resultRes.ok) {
          const resultData = await resultRes.json();
          resultUrl = resultData?.images?.[0]?.url ?? resultData?.image?.url;
        }
        break;
      }

      if (state === "FAILED") {
        console.error("[create-avatar] fal job failed:", JSON.stringify(status).slice(0, 300));
        return fallback("fal-job-failed");
      }

      // IN_QUEUE or IN_PROGRESS — keep polling
    } catch {
      // transient poll error — keep trying
    }
  }

  if (!resultUrl) return fallback("poll-timeout");

  // ── Step 5: Download result and return to iOS ─────────────────────────────
  try {
    const imgRes = await fetch(resultUrl);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    return new NextResponse(imgBuf, {
      headers: {
        "Content-Type": "image/jpeg",
        "X-Avatar-Status": "success",
      },
    });
  } catch (err) {
    return fallback(`result-download:${String(err).slice(0, 80)}`);
  }
}
