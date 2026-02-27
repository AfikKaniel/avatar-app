import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY;
  console.error("HEYGEN KEY:", apiKey ? apiKey.slice(0, 15) : "MISSING");

  if (!apiKey) {
    return NextResponse.json({ error: "HEYGEN_API_KEY not set" }, { status: 500 });
  }

  const form = await req.formData();
  const photo = form.get("photo") as File | null;
  if (!photo) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }

  const photoBuffer = await photo.arrayBuffer();
  const uploadRes = await fetch("https://upload.heygen.com/v1/asset", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "image/jpeg",
    },
    body: photoBuffer,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    console.log("HeyGen upload error:", body);
    return NextResponse.json({ error: `Asset upload failed: ${body}` }, { status: 500 });
  }

  const uploadData = await uploadRes.json();
  console.log("Upload response:", JSON.stringify(uploadData));
  const imageKey: string = uploadData.data.image_key;

  const createRes = await fetch(
    "https://api.heygen.com/v2/photo_avatar/avatar_group/create",
    {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "User Avatar",
        image_key: imageKey,
        prompt: "A high-quality digital avatar based on the person in the photo.",
      }),
    }
  );

  if (!createRes.ok) {
    const body = await createRes.text();
    console.log("HeyGen avatar error:", body);
    return NextResponse.json({ error: `Avatar group creation failed: ${body}` }, { status: 500 });
  }

  const avatarData = await createRes.json();
  return NextResponse.json({
    avatarId: avatarData.id,
    groupId: avatarData.group_id ?? avatarData.id,
  });
}
