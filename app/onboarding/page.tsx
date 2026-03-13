"use client";

import { useState } from "react";
import PhotoCapture from "@/components/PhotoCapture";
import AvatarStyler from "@/components/AvatarStyler";
import VoiceRecorder from "@/components/VoiceRecorder";
import { useRouter } from "next/navigation";

type Step = "photo" | "stylize" | "voice" | "processing" | "done";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep]           = useState<Step>("photo");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  // VoiceRecorder passes null when recording resets, clearing the "Create My Avatar" button
  const [status, setStatus]       = useState("");
  const [error, setError]         = useState("");

  function handlePhotoReady(blob: Blob) {
    setPhotoBlob(blob);
    setStep("stylize");
  }

  async function handleSubmit() {
    if (!photoBlob || !voiceBlob) return;
    setStep("processing");
    setError("");

    try {
      // ── 1. Clone voice with ElevenLabs ──────────────────────────────────
      setStatus("Cloning your voice…");
      const voiceForm = new FormData();
      voiceForm.append("audio", voiceBlob, "voice.webm");
      const voiceRes = await fetch("/api/elevenlabs/clone", {
        method: "POST",
        body: voiceForm,
      });
      if (!voiceRes.ok) throw new Error("Voice cloning failed");
      const { voiceId } = await voiceRes.json();

      // ── 2. Save photo + voice_id to backend (for the Hedra agent) ───────
      setStatus("Setting up your avatar…");
      const saveForm = new FormData();
      saveForm.append("photo",   photoBlob, "photo.jpg");
      saveForm.append("voiceId", voiceId);
      const saveRes = await fetch("/api/hedra/save-photo", {
        method: "POST",
        body: saveForm,
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "Avatar setup failed");
      const { photoUrl } = saveData;

      // ── 3. Persist voice_id + photoUrl for the chat page ─────────────────
      localStorage.setItem("voiceId",  voiceId);
      localStorage.setItem("photoUrl", photoUrl);

      setStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep("voice");
    }
  }

  return (
    <main className="flex flex-col items-center min-h-screen px-4 pt-8 pb-4 gap-4">
      {/* Progress indicators — 3 visible steps: Photo/Style · Voice · Done */}
      <div className="flex gap-2 items-center">
        {([
          { key: "photo",      label: "1" },
          { key: "voice",      label: "2" },
          { key: "processing", label: "3" },
        ] as const).map(({ key, label }, i) => {
          const stepOrder = ["photo", "stylize", "voice", "processing", "done"];
          const currentIdx = stepOrder.indexOf(step);
          const thisIdx    = stepOrder.indexOf(key);
          const active     = key === "photo"
            ? step === "photo" || step === "stylize"
            : step === key;
          const done       = currentIdx > thisIdx;
          return (
            <div key={key} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  active
                    ? "bg-[#6C63FF] text-white"
                    : done
                    ? "bg-green-600 text-white"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {label}
              </div>
              {i < 2 && <div className="w-8 h-px bg-gray-600" />}
            </div>
          );
        })}
      </div>

      {/* ── Step 1: Photo ── */}
      {step === "photo" && (
        <div className="w-full max-w-md space-y-4 text-center">
          <h2 className="text-2xl font-bold">Your Avatar Face</h2>
          <p className="text-gray-400 text-sm">
            Take a picture or upload one so your avatar looks exactly like you!
            Make sure your face is clearly visible with good lighting.
          </p>
          <PhotoCapture onCapture={handlePhotoReady} />
        </div>
      )}

      {/* ── Step 1b: Stylize ── */}
      {step === "stylize" && photoBlob && (
        <div className="w-full max-w-md space-y-4 text-center">
          <h2 className="text-2xl font-bold">Your Avatar Style</h2>
          <p className="text-gray-400 text-sm">
            We're giving your avatar those iconic digital eyes and a vivid, animated look.
          </p>
          <AvatarStyler
            originalBlob={photoBlob}
            onAccept={(styledBlob) => {
              setPhotoBlob(styledBlob);
              setStep("voice");
            }}
            onRetake={() => {
              setPhotoBlob(null);
              setStep("photo");
            }}
          />
        </div>
      )}

      {/* ── Step 2: Voice ── */}
      {step === "voice" && (
        <div className="w-full max-w-md space-y-4 text-center">
          <h2 className="text-2xl font-bold">Teach Your Avatar Your Voice</h2>
          <p className="text-gray-400 text-sm">
            Your avatar wants to sound exactly like you! Speak freely for{" "}
            <span className="text-[#6C63FF] font-semibold">60 seconds</span>{" "}
            so it can learn your voice. Here are some topics to talk about —
            pick any that feel natural:
          </p>
          <div className="bg-gray-800 rounded-xl p-4 text-left text-sm text-gray-300 space-y-2">
            {[
              "My name, where I'm from, and a little about my life",
              "My hobbies and what I love to do in my free time",
              "My occupation and what my day-to-day looks like",
              "What I'm most passionate about right now",
              "Where in the world I'd travel if I could go anywhere",
              "My expectations and vision for my AI avatar",
              "The people, places, or things that inspire me most",
              "A goal or dream I'm working towards",
              "My favorite movies, music, books, or shows",
              "Something most people don't know about me",
            ].map((topic, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[#6C63FF] font-bold mt-0.5">·</span>
                <span>{topic}</span>
              </div>
            ))}
          </div>
          <VoiceRecorder onRecordingComplete={setVoiceBlob} />
          {voiceBlob && (
            <button
              onClick={handleSubmit}
              className="w-full bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 rounded-xl transition"
            >
              Create My Avatar
            </button>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
      )}

      {/* ── Step 3: Processing ── */}
      {step === "processing" && (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-[#6C63FF] border-t-transparent rounded-full animate-spin mx-auto" />
          <h2 className="text-xl font-semibold">{status}</h2>
          <p className="text-gray-500 text-sm">Just a moment…</p>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === "done" && (
        <div className="text-center space-y-6">
          <div className="text-6xl">🎉</div>
          <h2 className="text-2xl font-bold">Your Avatar is Ready!</h2>
          <p className="text-gray-400">
            Your avatar has your face and your voice. Go say hello.
          </p>
          <button
            onClick={() => router.push("/")}
            className="bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-10 rounded-xl transition"
          >
            Let's Go
          </button>
        </div>
      )}
    </main>
  );
}
