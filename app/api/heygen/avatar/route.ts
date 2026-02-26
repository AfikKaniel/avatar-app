import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/heygen/avatar
 *
 * Accepts a photo (multipart/form-data), uploads it to HeyGen,
 * and creates a Photo Avatar Group.
 *
 * Returns: { avatarId, groupId }
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HEYGEN_API_KEY not set" }, { status: 500 });
  }

  // ── 1. Parse the incoming photo ─────────────────────────────────────────
  const form = await req.formData();
  const photo = form.get("photo") as File | null;
  if (!photo) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }

  // ── 2. Upload the photo to HeyGen asset storage ──────────────────────────
  const photoBuffer = await photo.arrayBuffer();
  const uploadRes = await fetch("https://upload.heygen.com/v1/asset", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "image/jpeg",
    },
    body: photoBuffer,
  });

if (!uploadRes.ok) {
  const body = await uploadRes.text();
  console.log("HeyGen upload error:", body);
  return NextResponse.json({ error: `Asset upload failed: ${body}` }, { status: 500 });
}

  const { data: assetData } = await uploadRes.json();
  const imageKey: string = assetData.image_key;

  // ── 3. Create a Photo Avatar Group ──────────────────────────────────────
  const createRes = await fetch(
    "https://api.heygen.com/v2/photo_avatar/avatar_group/create",
    {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "User Avatar", image_key: imageKey }),
    }
  );

if (!createRes.ok) {
  const body = await createRes.text();
  console.log("HeyGen avatar error:", body);
  return NextResponse.json({ error: `Avatar group creation failed: ${body}` }, { status: 500 });
}

  const { data: avatarData } = await createRes.json();

  return NextResponse.json({
    avatarId: avatarData.id,
    groupId: avatarData.group_id ?? avatarData.id,
  });
}
