"use client";

import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";

type SessionState = "idle" | "connecting" | "ready" | "error";

export default function ChatPage() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const roomRef   = useRef<Room | null>(null);
  const [state, setState]       = useState<SessionState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [micOn, setMicOn]       = useState(true);

  // ── Start the LiveKit session ─────────────────────────────────────────────
  async function startSession() {
    const voiceId  = typeof window !== "undefined" ? localStorage.getItem("voiceId")  : null;
    const photoUrl = typeof window !== "undefined" ? localStorage.getItem("photoUrl") : null;

    if (!voiceId || !photoUrl) {
      setErrorMsg("No avatar found. Please complete onboarding first.");
      setState("error");
      return;
    }

    setState("connecting");

    try {
      // 1. Get a LiveKit room token from our backend
      const params = new URLSearchParams({ voiceId, photoUrl });
      const res = await fetch(`/api/livekit/connection-details?${params}`);
      if (!res.ok) throw new Error("Could not get connection details");
      const { serverUrl, participantToken } = await res.json();

      // 2. Create and connect the LiveKit room
      const room = new Room();
      roomRef.current = room;

      // 3. Wire avatar video track when the agent publishes it
      room.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          _participant: RemoteParticipant
        ) => {
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
          }
          // Audio is attached automatically by LiveKit
          if (track.kind === Track.Kind.Audio) {
            const audioEl = track.attach() as HTMLAudioElement;
            audioEl.play().catch(() => {});
            document.body.appendChild(audioEl);
          }
        }
      );

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach();
      });

      room.on(RoomEvent.Disconnected, () => setState("idle"));

      await room.connect(serverUrl, participantToken, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);

      setState("ready");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to start session");
      setState("error");
    }
  }

  // ── Toggle microphone ─────────────────────────────────────────────────────
  async function toggleMic() {
    if (!roomRef.current) return;
    const next = !micOn;
    await roomRef.current.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  // ── End session ───────────────────────────────────────────────────────────
  async function endSession() {
    // Detach any lingering audio elements
    document.querySelectorAll("audio[data-lk-audio]").forEach((el) => el.remove());
    if (videoRef.current) videoRef.current.srcObject = null;
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setState("idle");
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  return (
    <main className="flex flex-col h-screen max-w-2xl mx-auto px-4 py-4 gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Your Avatar</h1>
        {state !== "idle" && (
          <button
            onClick={endSession}
            className="text-sm text-gray-400 hover:text-red-400 transition"
          >
            End Session
          </button>
        )}
      </div>

      {/* ── Avatar Video ── */}
      <div className="relative bg-gray-900 rounded-2xl overflow-hidden flex-1 flex items-center justify-center" style={{ maxHeight: "75vh" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ display: state === "ready" ? "block" : "none" }}
        />

        {state === "idle" && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-400">Your avatar is waiting</p>
            <button
              onClick={startSession}
              className="bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-8 rounded-xl transition"
            >
              Start Talking
            </button>
          </div>
        )}

        {state === "connecting" && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Waking up your avatar…</p>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <p className="text-red-400 font-semibold">{errorMsg}</p>
            {errorMsg.includes("onboarding") && (
              <a href="/onboarding" className="text-[#6C63FF] underline text-sm">
                Go to Onboarding
              </a>
            )}
          </div>
        )}

        {/* Mic status indicator */}
        {state === "ready" && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1">
            <span
              className={`w-2 h-2 rounded-full ${
                micOn ? "bg-green-400 animate-pulse" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-white">
              {micOn ? "Mic on — speak to your avatar" : "Mic off"}
            </span>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      {state === "ready" && (
        <div className="flex justify-center gap-3">
          <button
            onClick={toggleMic}
            className={`px-6 py-2 rounded-xl border font-medium text-sm transition ${
              micOn
                ? "border-gray-600 text-gray-300 hover:border-gray-400"
                : "border-red-500 text-red-400 hover:border-red-400"
            }`}
          >
            {micOn ? "🎤 Mute" : "🎤 Unmute"}
          </button>
          <button
            onClick={endSession}
            className="px-6 py-2 rounded-xl border border-red-600 text-red-400 hover:border-red-400 font-medium text-sm transition"
          >
            End Session
          </button>
        </div>
      )}
    </main>
  );
}
