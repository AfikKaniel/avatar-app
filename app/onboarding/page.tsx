"use client";

import { useState } from "react";
import PhotoCapture from "@/components/PhotoCapture";
import VoiceRecorder from "@/components/VoiceRecorder";
import { useRouter } from "next/navigation";

type Step = "photo" | "voice" | "processing" | "done";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("photo");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // Called when the user captures their photo
  function handlePhotoReady(blob: Blob) {
    setPhotoBlob(blob);
    setStep("voice");
  }

  // Called when the user finishes recording their voice
  function handleVoiceReady(blob: Blob) {
    setVoiceBlob(blob);
  }

  // Submit everything to the backend APIs
  async function handleSubmit() {
    if (!photoBlob || !voiceBlob) return;
    setStep("processing");
    setError("");

    try {
      // ── 1. Clone voice with ElevenLabs ─────────────────────────────────
      setStatus("Cloning your voice with ElevenLabs…");
      const voiceForm = new FormData();
      voiceForm.append("audio", voiceBlob, "voice.webm");
      const voiceRes = await fetch("/api/elevenlabs/clone", {
        method: "POST",
        body: voiceForm,
      });
      if (!voiceRes.ok) throw new Error("Voice cloning failed");
      const { voiceId } = await voiceRes.json();

      // ── 2. Upload photo + create HeyGen avatar ──────────────────────────
      setStatus("Creating your HeyGen photo avatar…");
      const avatarForm = new FormData();
      avatarForm.append("photo", photoBlob, "photo.jpg");
      const avatarRes = await fetch("/api/heygen/avatar", {
        method: "POST",
        body: avatarForm,
      });
      if (!avatarRes.ok) throw new Error("Avatar creation failed");
      const { avatarId, groupId } = await avatarRes.json();

      // ── 3. Train the avatar ─────────────────────────────────────────────
      setStatus("Training your avatar (this takes ~2 minutes)…");
      const trainRes = await fetch("/api/heygen/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      if (!trainRes.ok) throw new Error("Avatar training failed");

      // ── 4. Save IDs to localStorage so the chat page can use them ───────
      localStorage.setItem("avatarId", avatarId);
      localStorage.setItem("voiceId", voiceId);

      setStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep("voice");
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 py-12 gap-8">
      {/* Progress bar */}
      <div className="flex gap-2 items-center">
        {(["photo", "voice", "processing"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                step === s
                  ? "bg-[#6C63FF] text-white"
                  : ["processing", "done"].includes(step) ||
                    (step === "voice" && i === 0)
                  ? "bg-green-600 text-white"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              {i + 1}
            </div>
            {i < 2 && <div className="w-8 h-px bg-gray-600" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Photo ── */}
      {step === "photo" && (
        <div className="w-full max-w-md space-y-4 text-center">
          <h2 className="text-2xl font-bold">Take Your Photo</h2>
          <p className="text-gray-400 text-sm">
            Look straight at the camera with good lighting. This will be used
            to create your avatar face.
          </p>
          <PhotoCapture onCapture={handlePhotoReady} />
        </div>
      )}

      {/* ── Step 2: Voice ── */}
      {step === "voice" && (
        <div className="w-full max-w-md space-y-4 text-center">
          <h2 className="text-2xl font-bold">Record Your Voice</h2>
          <p className="text-gray-400 text-sm">
            Read the text below naturally. Aim for at least{" "}
            <span className="text-[#6C63FF] font-semibold">60 seconds</span>.
            Speak clearly in a quiet room.
          </p>
          <div className="bg-gray-800 rounded-xl p-4 text-left text-sm text-gray-300 leading-relaxed">
            <p>
              "Hello! My name is… and I live in… I enjoy spending my time on
              things like… One thing most people don't know about me is… If I
              could travel anywhere in the world right now, I'd go to… because…
              The best piece of advice I've ever received was… I think the most
              important quality in a person is… In the next few years, I hope
              to… My favorite thing about technology is… and the thing I find
              most exciting about AI is…"
            </p>
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
          <p className="text-gray-500 text-sm">
            Please keep this tab open. Avatar training takes about 2 minutes.
          </p>
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
            onClick={() => router.push("/chat")}
            className="bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-10 rounded-xl transition"
          >
            Talk to My Avatar
          </button>
        </div>
      )}
    </main>
  );
}
