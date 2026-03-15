import { NextRequest, NextResponse } from "next/server";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

/**
 * GET /api/livekit/connection-details
 *
 * Query params:
 *   mode         - "digital_twin" | "therapist"
 *   language     - "en" | "he" (defaults to "en")
 *   voiceId      - required when mode=digital_twin
 *   photoUrl     - required when mode=digital_twin
 *   memory       - optional summary of previous sessions
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
  const mode     = searchParams.get("mode") ?? "digital_twin";
  const language = searchParams.get("language") ?? "en";
  const voiceId  = searchParams.get("voiceId");
  const photoUrl = searchParams.get("photoUrl");
  const memory       = searchParams.get("memory") ?? "";
  const goal         = searchParams.get("goal") ?? "";
  const goalTarget   = searchParams.get("goalTarget") ?? "";
  const goalCurrent  = searchParams.get("goalCurrent") ?? "";
  const isCheckin    = searchParams.get("isCheckin") === "1";

  if (mode === "digital_twin" && (!voiceId || !photoUrl)) {
    return NextResponse.json(
      { error: "voiceId and photoUrl are required for digital_twin mode" },
      { status: 400 }
    );
  }

  const roomName        = `avatar-${crypto.randomUUID()}`;
  const participantName = `user-${crypto.randomUUID().slice(0, 8)}`;
  const httpUrl         = wsUrl.replace("wss://", "https://").replace("ws://", "http://");

  const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  await roomService.createRoom({
    name:     roomName,
    metadata: JSON.stringify({ mode, language, voice_id: voiceId, photo_url: photoUrl }),
  });

  const agentDispatchClient = new AgentDispatchClient(httpUrl, apiKey, apiSecret);
  try {
    const dispatch = await agentDispatchClient.createDispatch(roomName, "avatar-agent");
    console.log("[dispatch] created:", JSON.stringify(dispatch));
  } catch (err) {
    console.error("[dispatch] FAILED:", err);
  }

  const participantMeta: Record<string, string | null> = { mode, language };
  if (mode === "digital_twin") {
    participantMeta.voice_id  = voiceId;
    participantMeta.photo_url = photoUrl;
  }
  if (memory)       participantMeta.memory       = memory;
  if (goal)         participantMeta.goal         = goal;
  if (goalTarget)   participantMeta.goal_target  = goalTarget;
  if (goalCurrent)  participantMeta.goal_current = goalCurrent;
  participantMeta.is_checkin = isCheckin ? "1" : "0";

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    ttl: "15m",
    metadata: JSON.stringify(participantMeta),
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
