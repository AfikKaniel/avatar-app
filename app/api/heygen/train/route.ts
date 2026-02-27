import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/heygen/train
 *
 * Triggers avatar model training for a given group.
 * Training takes ~2 minutes. The avatar becomes usable after completion.
 *
 * Body: { groupId: string }
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HEYGEN_API_KEY not set" }, { status: 500 });
  }

  const { groupId } = await req.json();
  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  const res = await fetch(
    "https://api.heygen.com/v2/photo_avatar/train",
    {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ group_id: groupId }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Training failed: ${body}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
