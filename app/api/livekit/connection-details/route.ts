import { NextRequest, NextResponse } from "next/server";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

/**
 * GET /api/livekit/connection-details?voiceId=xxx&photoUrl=xxx
 *
 * Creates a LiveKit room with user metadata (voice_id + photo_url) embedded,
 * so the Python agent can pick them up and start the correct avatar session.
 *
 * Returns: { serverUrl, roomName, participantToken }
 */
export async function GET(req: NextRequest) {
  const apiKey    = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl     = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      { error: "LiveKit credentials not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const voiceId  = searchParams.get("voiceId");
  const photoUrl = searchParams.get("photoUrl");

  if (!voiceId || !photoUrl) {
    return NextResponse.json(
      { error: "voiceId and photoUrl are required" },
      { status: 400 }
    );
  }

  const roomName        = `avatar-${crypto.randomUUID()}`;
  const participantName = `user-${crypto.randomUUID().slice(0, 8)}`;
  const httpUrl         = wsUrl.replace("wss://", "https://").replace("ws://", "http://");

  // Create the room with metadata so the Python agent knows which voice + photo to use
  const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  await roomService.createRoom({
    name:     roomName,
    metadata: JSON.stringify({ voice_id: voiceId, photo_url: photoUrl }),
  });

  // Create participant token
  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    ttl: "15m",
  });
  token.addGrant({
    room:           roomName,
    roomJoin:       true,
    canPublish:     true,
    canPublishData: true,
    canSubscribe:   true,
  });

  return NextResponse.json(
    {
      serverUrl:        wsUrl,
      roomName,
      participantToken: await token.toJwt(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
