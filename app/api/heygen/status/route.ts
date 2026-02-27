import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/heygen/status?groupId=xxx
 *
 * Checks the training status of a Photo Avatar Group.
 * Returns { status, avatarId } where:
 *   status   — "pending" | "processing" | "completed" | "failed"
 *   avatarId — the real streaming avatar_id (only present when completed)
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HEYGEN_API_KEY not set" }, { status: 500 });
  }

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.heygen.com/v2/photo_avatar/${groupId}`,
    {
      headers: { "X-Api-Key": apiKey },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Status check failed: ${body}` }, { status: res.status });
  }

  const { data } = await res.json();

  // HeyGen returns data.id (same as groupId) and data.status
  // The avatar_id for streaming is data.id once status === "completed"
  const avatarId: string | null =
    data?.status === "completed" ? (data?.id ?? null) : null;

  return NextResponse.json({
    status: data?.status ?? "pending",
    avatarId,
  });
}
