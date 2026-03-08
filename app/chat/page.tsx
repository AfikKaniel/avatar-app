"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";

type SessionState = "language" | "idle" | "connecting" | "ready" | "error";
type Mode = "digital_twin" | "therapist";
type Language = "en" | "he";

const LANGUAGES: { code: Language; label: string; native: string; flag: string }[] = [
  { code: "en", label: "English", native: "English", flag: "🇺🇸" },
  { code: "he", label: "Hebrew",  native: "עברית",   flag: "🇮🇱" },
];

function ChatPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = (searchParams.get("mode") ?? "digital_twin") as Mode;

  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef  = useRef<Room | null>(null);
  const [state, setState]       = useState<SessionState>("language");
  const [language, setLanguage] = useState<Language | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [micOn, setMicOn]       = useState(true);

  const label = mode === "therapist" ? "Your Therapist" : "Your Digital Twin";
  const connectingLabel = mode === "therapist" ? "Connecting to your therapist…" : "Waking up your avatar…";

  async function startSession(lang: Language) {
    setState("connecting");

    try {
      let params: URLSearchParams;

      if (mode === "therapist") {
        params = new URLSearchParams({ mode: "therapist", language: lang });
      } else {
        const voiceId  = localStorage.getItem("voiceId");
        const photoUrl = localStorage.getItem("photoUrl");

        if (!voiceId || !photoUrl) {
          setErrorMsg("No avatar found. Please complete onboarding first.");
          setState("error");
          return;
        }
        params = new URLSearchParams({ mode: "digital_twin", voiceId, photoUrl, language: lang });
      }

      const res = await fetch(`/api/livekit/connection-details?${params}`);
      if (!res.ok) throw new Error("Could not get connection details");
      const { serverUrl, participantToken } = await res.json();

      const room = new Room();
      roomRef.current = room;

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

      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        router.push("/");
      });

      await room.connect(serverUrl, participantToken, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);

      setState("ready");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to start session");
      setState("error");
    }
  }

  async function toggleMic() {
    if (!roomRef.current) return;
    const next = !micOn;
    await roomRef.current.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  async function endSession() {
    document.querySelectorAll("audio").forEach((el) => el.remove());
    if (videoRef.current) videoRef.current.srcObject = null;
    await roomRef.current?.disconnect();
    roomRef.current = null;
    router.push("/");
  }

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Language picker ──────────────────────────────────────────────────────
  if (state === "language") {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen px-4 gap-8" style={{ marginTop: "-8vh" }}>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-white">Choose Your Language</h1>
          <p className="text-gray-400 text-sm">
            The conversation will be in the language you select.
          </p>
        </div>

        <div className="flex gap-4">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                setLanguage(lang.code);
                startSession(lang.code);
              }}
              className="flex flex-col items-center gap-3 w-40 py-6 rounded-2xl border border-[#6C63FF]/40 bg-[#6C63FF]/5 hover:bg-[#6C63FF]/15 hover:border-[#6C63FF]/70 transition group"
            >
              <span className="text-5xl">{lang.flag}</span>
              <span className="text-white font-semibold text-sm group-hover:text-[#a09cf0] transition">
                {lang.native}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => router.push("/")}
          className="text-gray-500 hover:text-gray-300 text-sm transition"
        >
          ← Back
        </button>
      </main>
    );
  }

  // ── Session screen ────────────────────────────────────────────────────────
  return (
    <main className="flex flex-col h-screen max-w-2xl mx-auto px-4 py-4 gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">{label}</h1>
          {language && (
            <span className="text-lg" title={LANGUAGES.find(l => l.code === language)?.label}>
              {LANGUAGES.find(l => l.code === language)?.flag}
            </span>
          )}
        </div>
        {state === "ready" && (
          <button
            onClick={endSession}
            className="text-sm text-gray-400 hover:text-red-400 transition"
          >
            End Session
          </button>
        )}
      </div>

      <div
        className="relative bg-gray-900 rounded-2xl overflow-hidden flex-1 flex items-center justify-center"
        style={{ maxHeight: "75vh" }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ display: state === "ready" ? "block" : "none" }}
        />

        {(state === "idle" || state === "connecting") && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">{connectingLabel}</p>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <p className="text-red-400 font-semibold">{errorMsg}</p>
            <button
              onClick={() => router.push("/")}
              className="text-[#6C63FF] underline text-sm"
            >
              Go back home
            </button>
          </div>
        )}

        {state === "ready" && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1">
            <span
              className={`w-2 h-2 rounded-full ${
                micOn ? "bg-green-400 animate-pulse" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-white">
              {micOn ? "Mic on — speak freely" : "Mic off"}
            </span>
          </div>
        )}
      </div>

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
            {micOn ? "Mute" : "Unmute"}
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

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
