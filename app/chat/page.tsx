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
  type TranscriptionSegment,
  type Participant,
} from "livekit-client";

type SessionState = "language" | "idle" | "connecting" | "ready" | "error";
type Mode = "digital_twin" | "therapist";
type Language = "en" | "he";

const LANGUAGES: { code: Language; label: string; native: string; flag: string }[] = [
  { code: "en", label: "English", native: "English", flag: "🇺🇸" },
  { code: "he", label: "Hebrew",  native: "עברית",   flag: "🇮🇱" },
];

function ConnectingLoader({ messages, mode }: { messages: string[]; mode: Mode }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % messages.length), 2600);
    return () => clearInterval(t);
  }, [messages]);

  const icon = mode === "therapist" ? "🛋️" : "🧬";

  return (
    <div className="flex flex-col items-center justify-center gap-6 w-full h-full py-12">
      <span className="text-5xl select-none">{icon}</span>
      <div className="w-12 h-12 border-[3px] border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
      <p key={idx} className="text-white font-black text-xl tracking-tight text-center px-8 max-w-xs leading-snug">
        {messages[idx]}
      </p>
    </div>
  );
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = (searchParams.get("mode") ?? "digital_twin") as Mode;

  const videoRef       = useRef<HTMLVideoElement>(null);
  const roomRef        = useRef<Room | null>(null);
  const transcriptRef  = useRef<{ speaker: string; text: string }[]>([]);
  const audioElemsRef  = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [state, setState]         = useState<SessionState>("language");
  const [language, setLanguage]   = useState<Language | null>(null);
  const [errorMsg, setErrorMsg]   = useState("");
  const [micOn, setMicOn]         = useState(true);
  const [avatarPhoto, setAvatarPhoto] = useState<string>("");
  const [videoReady, setVideoReady]   = useState(false);

  const memoryKey = `sessionMemory_${mode}`;
  const isEndingRef = useRef(false);

  useEffect(() => {
    if (mode === "digital_twin") {
      setAvatarPhoto(localStorage.getItem("photoUrl") ?? "");
    }
  }, [mode]);

  const label = mode === "therapist" ? "Your Therapist" : "Your Digital Twin";
  const CONNECTING_MESSAGES = mode === "therapist"
    ? [
        "Your therapist is finishing their coffee… ☕",
        "Warming up the empathy engine…",
        "Booking your virtual couch…",
        "Loading unconditional positive regard…",
      ]
    : [
        "Waking up your digital twin… 🧬",
        "Convincing your better self to show up…",
        "Loading your inner voice…",
        "Syncing your conscience… ⚡",
        "Your avatar is doing warm-ups…",
      ];

  async function startSession(lang: Language) {
    setState("connecting");
    setVideoReady(false);
    transcriptRef.current = [];

    try {
      let params: URLSearchParams;

      const memory       = localStorage.getItem(memoryKey) ?? "";
      const goal         = localStorage.getItem("userGoal") ?? "";
      const goalTarget   = localStorage.getItem("goalTarget") ?? "";
      const goalCurrent  = localStorage.getItem("goalCurrent") ?? "";

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

      if (memory)       params.set("memory", memory);
      if (goal)         params.set("goal", goal);
      if (goalTarget)   params.set("goalTarget", goalTarget);
      if (goalCurrent)  params.set("goalCurrent", goalCurrent);

      const res = await fetch(`/api/livekit/connection-details?${params}`);
      if (!res.ok) throw new Error("Could not get connection details");
      const { serverUrl, participantToken } = await res.json();

      const room = new Room();
      roomRef.current = room;

      room.on(
        RoomEvent.TranscriptionReceived,
        (segments: TranscriptionSegment[], participant: Participant | undefined) => {
          for (const seg of segments) {
            if (seg.final && seg.text.trim()) {
              const speaker = participant?.isLocal ? "User" : "Avatar";
              transcriptRef.current.push({ speaker, text: seg.text.trim() });
            }
          }
        }
      );

      room.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          _participant: RemoteParticipant
        ) => {
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            videoRef.current.onloadeddata = () => setVideoReady(true);
          }
          if (track.kind === Track.Kind.Audio) {
            const audioEl = track.attach() as HTMLAudioElement;
            audioEl.play().catch(() => {});
            document.body.appendChild(audioEl);
            if (track.sid) audioElemsRef.current.set(track.sid, audioEl);
          }
        }
      );

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        // Only detach audio — detaching video nulls srcObject and causes black flicker
        // between avatar utterances. Video is cleaned up explicitly in endSession.
        if (track.kind === Track.Kind.Audio) {
          track.detach();
          if (track.sid) {
            const el = audioElemsRef.current.get(track.sid);
            if (el) {
              el.remove();
              audioElemsRef.current.delete(track.sid);
            }
          }
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        if (!isEndingRef.current) {
          router.push("/");
        }
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
    isEndingRef.current = true;
    audioElemsRef.current.forEach((el) => el.remove());
    audioElemsRef.current.clear();
    if (videoRef.current) videoRef.current.srcObject = null;
    await roomRef.current?.disconnect();
    roomRef.current = null;

    const transcript = transcriptRef.current;
    let summary = "";
    if (transcript.length > 0) {
      try {
        const previousMemory = localStorage.getItem(memoryKey) ?? "";
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, mode, previousMemory }),
        });
        if (res.ok) {
          const data = await res.json();
          summary = data.summary ?? "";
          if (summary) localStorage.setItem(memoryKey, summary);
        }
      } catch {
        // Memory save failed silently — don't block navigation
      }
    }

    // Log session to database (fire-and-forget)
    fetch("/api/log-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        language: language ?? "en",
        goal: localStorage.getItem("userGoal") ?? "",
        goalTarget: localStorage.getItem("goalTarget") ?? "",
        goalCurrent: localStorage.getItem("goalCurrent") ?? "",
        summary,
      }),
    }).catch(() => {});

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
              className="flex flex-col items-center gap-3 w-40 py-6 rounded-2xl border border-gray-600 bg-white/5 active:bg-white/10 transition"
            >
              <span className="text-5xl">{lang.flag}</span>
              <span className="text-white font-semibold text-sm">
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
        {state === "ready" && videoReady && (
          <button
            onClick={endSession}
            className="text-sm text-gray-400 hover:text-gray-200 transition"
          >
            ← Return to Lobby
          </button>
        )}
      </div>

      <div
        className="relative bg-gray-900 rounded-2xl overflow-hidden flex-1 flex items-center justify-center"
        style={{
          maxHeight: "75vh",
          backgroundImage: state === "ready" && videoReady && avatarPhoto ? `url(${avatarPhoto})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ display: state === "ready" && videoReady ? "block" : "none" }}
        />

        {(state === "idle" || state === "connecting" || (state === "ready" && !videoReady)) && (
          <ConnectingLoader messages={CONNECTING_MESSAGES} mode={mode} />
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

        {state === "ready" && videoReady && (
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

      {state === "ready" && videoReady && (
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
