"use client";

import { useEffect, useRef, useState } from "react";
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
  TaskMode,
  VoiceEmotion,
} from "@heygen/streaming-avatar";

type Message = { role: "user" | "avatar"; text: string };
type SessionState = "idle" | "connecting" | "ready" | "speaking" | "error";

export default function ChatPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarRef = useRef<StreamingAvatar | null>(null);
  const [state, setState] = useState<SessionState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Load saved avatar/voice IDs from localStorage (set during onboarding)
  const avatarId =
    typeof window !== "undefined" ? localStorage.getItem("avatarId") ?? "" : "";
  const voiceId =
    typeof window !== "undefined" ? localStorage.getItem("voiceId") ?? "" : "";

  // ── Start streaming avatar session ─────────────────────────────────────
  async function startSession() {
    if (!avatarId || !voiceId) {
      setErrorMsg(
        "No avatar found. Please complete onboarding first."
      );
      setState("error");
      return;
    }

    setState("connecting");
    try {
      // 1. Get a short-lived session token from our backend (keeps API key safe)
      const tokenRes = await fetch("/api/heygen/token", { method: "POST" });
      if (!tokenRes.ok) throw new Error("Could not get session token");
      const { token } = await tokenRes.json();

      // 2. Initialize the HeyGen SDK with that token
      const avatar = new StreamingAvatar({ token });
      avatarRef.current = avatar;

      // 3. Wire up the video stream
      avatar.on(StreamingEvents.STREAM_READY, (e) => {
        if (videoRef.current) {
          videoRef.current.srcObject = e.detail as MediaStream;
          videoRef.current.play();
        }
        setState("ready");
      });

      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => setState("speaking"));
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => setState("ready"));
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => setState("idle"));

      // 4. Start the avatar with the user's ElevenLabs cloned voice
      await avatar.createStartAvatar({
        quality: AvatarQuality.High,
        avatarName: avatarId,
        voice: {
          voiceId: voiceId,
          emotion: VoiceEmotion.FRIENDLY,
        },
        language: "en",
      });

      // 5. Greet the user
      await avatar.speak({
        text: "Hey! It's me — well, a version of you. Ask me anything or just have a conversation!",
        task_type: TaskType.REPEAT,
        taskMode: TaskMode.ASYNC,
      });

      addMessage("avatar", "Hey! It's me — well, a version of you. Ask me anything or just have a conversation!");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to start session");
      setState("error");
    }
  }

  // ── Send a text message to the avatar ──────────────────────────────────
  async function sendMessage(text: string) {
    if (!text.trim() || !avatarRef.current || state === "speaking") return;

    addMessage("user", text);
    setInputText("");

    try {
      // Call our backend which calls Claude for a smart reply
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error("Chat API failed");
      const { reply } = await res.json();

      addMessage("avatar", reply);

      // Make the avatar speak the reply in the user's cloned voice
      await avatarRef.current.speak({
        text: reply,
        task_type: TaskType.REPEAT,
        taskMode: TaskMode.ASYNC,
      });
    } catch (e) {
      console.error(e);
    }
  }

  // ── Voice input via Web Speech API ─────────────────────────────────────
  function toggleVoiceInput() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser doesn't support voice input. Use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      sendMessage(transcript);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  // ── Interrupt the avatar mid-speech ────────────────────────────────────
  async function interrupt() {
    await avatarRef.current?.interrupt();
  }

  // ── End session ────────────────────────────────────────────────────────
  async function endSession() {
    await avatarRef.current?.stopAvatar();
    avatarRef.current = null;
    setState("idle");
    setMessages([]);
  }

  function addMessage(role: "user" | "avatar", text: string) {
    setMessages((prev) => [...prev, { role, text }]);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { avatarRef.current?.stopAvatar(); };
  }, []);

  return (
    <main className="flex flex-col h-screen max-w-4xl mx-auto px-4 py-6 gap-4">
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
      <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video w-full">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Overlay when not started */}
        {state === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
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
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-red-400 font-semibold">{errorMsg}</p>
            {errorMsg.includes("onboarding") && (
              <a href="/onboarding" className="text-[#6C63FF] underline text-sm">
                Go to Onboarding
              </a>
            )}
          </div>
        )}

        {/* Speaking indicator */}
        {state === "speaking" && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-white">Speaking</span>
            <button onClick={interrupt} className="text-xs text-gray-300 hover:text-white ml-1">
              Interrupt
            </button>
          </div>
        )}
      </div>

      {/* ── Chat history ── */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-[#6C63FF] text-white"
                  : "bg-gray-800 text-gray-100"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      {/* ── Input area ── */}
      {(state === "ready" || state === "speaking") && (
        <div className="flex gap-2">
          <button
            onClick={toggleVoiceInput}
            className={`p-3 rounded-xl border transition ${
              isListening
                ? "border-red-500 text-red-400 animate-pulse"
                : "border-gray-600 text-gray-400 hover:border-gray-400"
            }`}
            title="Speak to avatar"
          >
            🎤
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage(inputText)}
            placeholder="Type a message or use the mic…"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#6C63FF] transition"
          />
          <button
            onClick={() => sendMessage(inputText)}
            disabled={!inputText.trim() || state === "speaking"}
            className="bg-[#6C63FF] hover:bg-[#5a52e0] disabled:opacity-40 text-white px-4 rounded-xl transition"
          >
            Send
          </button>
        </div>
      )}
    </main>
  );
}
