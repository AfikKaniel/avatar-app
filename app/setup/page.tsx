"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Goal = "quit_smoking" | "drink_water" | "stand_more";
type Mode = "digital_twin" | "therapist";
type Step = "goal" | "mode" | "avatar";

const GOALS: { id: Goal; icon: string; label: string; description: string }[] = [
  {
    id: "quit_smoking",
    icon: "🚭",
    label: "Quit Smoking",
    description: "Break free from cigarettes and breathe easier every day.",
  },
  {
    id: "drink_water",
    icon: "💧",
    label: "Drink More Water",
    description: "Build the habit of staying hydrated throughout your day.",
  },
  {
    id: "stand_more",
    icon: "🧍",
    label: "Stand More",
    description: "Break up sitting time and keep your body moving during the day.",
  },
];

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("goal");
  const [pendingGoal, setPendingGoal] = useState<Goal | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);

  useEffect(() => {
    const voiceId  = localStorage.getItem("voiceId");
    const photoUrl = localStorage.getItem("photoUrl");
    setHasAvatar(!!voiceId && !!photoUrl);
  }, []);

  function confirmGoal() {
    if (!pendingGoal) return;
    setSelectedGoal(pendingGoal);
    setStep("mode");
  }

  function saveAndClearMemory(goal: Goal, mode: Mode) {
    localStorage.setItem("userGoal", goal);
    localStorage.setItem("userMode", mode);
    localStorage.removeItem("sessionMemory_digital_twin");
    localStorage.removeItem("sessionMemory_therapist");
  }

  function handleModeSelect(mode: Mode) {
    if (mode === "therapist") {
      saveAndClearMemory(selectedGoal!, mode);
      router.push("/");
    } else {
      if (hasAvatar) {
        setStep("avatar");
      } else {
        saveAndClearMemory(selectedGoal!, mode);
        router.push("/onboarding");
      }
    }
  }

  function handleKeepAvatar() {
    saveAndClearMemory(selectedGoal!, "digital_twin");
    router.push("/");
  }

  function handleNewAvatar() {
    saveAndClearMemory(selectedGoal!, "digital_twin");
    router.push("/onboarding");
  }

  return (
    <main
      className="flex flex-col items-center justify-center min-h-screen gap-8 px-4 text-center"
      style={{ marginTop: "-8vh" }}
    >
      {/* ── Goal selection ─────────────────────────────────────────────── */}
      {step === "goal" && (
        <>
          <div className="space-y-3">
            <h1 className="text-3xl font-black text-white">What's your goal?</h1>
            <p className="text-gray-400 text-sm max-w-sm">
              Choose the habit you want to build. Your AI companion will motivate
              and support you every session.
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-sm">
            {GOALS.map((goal) => {
              const isSelected = pendingGoal === goal.id;
              return (
                <button
                  key={goal.id}
                  onClick={() => setPendingGoal(goal.id)}
                  className={`flex items-center gap-4 text-left w-full rounded-2xl border p-5 transition ${
                    isSelected
                      ? "border-[#6C63FF] bg-[#6C63FF]/15 ring-1 ring-[#6C63FF]/50"
                      : "border-gray-600 bg-white/3"
                  }`}
                >
                  <span className="text-4xl">{goal.icon}</span>
                  <div>
                    <p className={`font-semibold transition ${isSelected ? "text-[#a09cf0]" : "text-white"}`}>
                      {goal.label}
                    </p>
                    <p className="text-gray-400 text-xs mt-0.5">{goal.description}</p>
                  </div>
                  {isSelected && (
                    <span className="ml-auto text-[#6C63FF] text-lg">✓</span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={confirmGoal}
            disabled={!pendingGoal}
            className={`w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white transition ${
              pendingGoal
                ? "bg-[#6C63FF] hover:bg-[#5a52e0]"
                : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
          >
            Confirm
          </button>
        </>
      )}

      {/* ── Mode selection ─────────────────────────────────────────────── */}
      {step === "mode" && selectedGoal && (
        <>
          <div className="space-y-3">
            <div className="text-4xl">
              {GOALS.find((g) => g.id === selectedGoal)?.icon}
            </div>
            <h1 className="text-3xl font-black text-white">
              {GOALS.find((g) => g.id === selectedGoal)?.label}
            </h1>
            <p className="text-gray-400 text-sm max-w-sm">
              Who would you like to talk to?
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xl">
            <button
              onClick={() => handleModeSelect("digital_twin")}
              className="flex-1 flex flex-col gap-3 text-left rounded-2xl border border-[#6C63FF]/40 bg-[#6C63FF]/5 active:bg-[#6C63FF]/15 p-6 transition group"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-[#a09cf0]">
                Digital Twin
              </p>
              <h2 className="text-lg font-bold text-white">Talk to yourself</h2>
              <p className="text-gray-400 text-sm">
                Speak with an AI version of you — your face, your voice, your perspective.
              </p>
              <span className="mt-auto text-[#6C63FF] text-sm font-semibold">
                {hasAvatar ? "Use my avatar →" : "Set up my avatar →"}
              </span>
            </button>

            <button
              onClick={() => handleModeSelect("therapist")}
              className="flex-1 flex flex-col gap-3 text-left rounded-2xl border border-gray-600 bg-white/3 active:bg-white/5 p-6 transition"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                AI Therapist
              </p>
              <h2 className="text-lg font-bold text-white">Talk to a therapist</h2>
              <p className="text-gray-400 text-sm">
                A warm, professional AI therapist — no setup needed, start immediately.
              </p>
              <span className="mt-auto text-gray-300 text-sm font-semibold">
                Start now →
              </span>
            </button>
          </div>

          <button
            onClick={() => setStep("goal")}
            className="text-gray-500 text-sm transition"
          >
            ← Back
          </button>
        </>
      )}

      {/* ── Avatar choice (keep vs recreate) ───────────────────────────── */}
      {step === "avatar" && selectedGoal && (
        <>
          <div className="space-y-3">
            <div className="text-4xl">🪞</div>
            <h1 className="text-3xl font-black text-white">Your Avatar</h1>
            <p className="text-gray-400 text-sm max-w-sm">
              You already have an avatar. Keep it or create a new one?
            </p>
          </div>

          <div className="flex flex-col gap-4 w-full max-w-sm">
            <button
              onClick={handleKeepAvatar}
              className="w-full text-center bg-[#6C63FF] active:bg-[#5a52e0] text-white font-semibold py-3 px-6 rounded-xl transition"
            >
              Keep My Avatar
            </button>
            <button
              onClick={handleNewAvatar}
              className="w-full text-center border border-gray-600 text-gray-300 font-semibold py-3 px-6 rounded-xl transition"
            >
              Create a New Avatar
            </button>
          </div>

          <button
            onClick={() => setStep("mode")}
            className="text-gray-500 text-sm transition"
          >
            ← Back
          </button>
        </>
      )}
    </main>
  );
}
