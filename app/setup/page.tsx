"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Goal = "quit_smoking" | "drink_water" | "stand_more";
type Mode = "digital_twin" | "therapist";
type Step = "goal" | "goal_target" | "goal_current" | "mode" | "avatar";

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

const GOAL_QUESTIONS: Record<Goal, {
  targetQ: string;
  targetOptions: string[];
  currentQ: string;
  currentOptions: string[];
}> = {
  quit_smoking: {
    targetQ: "What does quitting smoking mean to you?",
    targetOptions: [
      "🚭 Quit permanently",
      "📉 Reduce the amount gradually",
      "⏸️ Take a break for now",
      "🔄 Quit and restart when ready",
    ],
    currentQ: "How many cigarettes do you smoke per day?",
    currentOptions: [
      "1 or fewer",
      "2–4 a day",
      "4–10 a day",
      "10–20 a day",
      "More than 20",
    ],
  },
  drink_water: {
    targetQ: "How many glasses of water per day do you want to reach?",
    targetOptions: [
      "4 glasses",
      "6 glasses",
      "8 glasses (recommended)",
      "10+ glasses",
    ],
    currentQ: "How many glasses are you drinking on average right now?",
    currentOptions: [
      "1–2 glasses",
      "3–4 glasses",
      "5–6 glasses",
      "7+ glasses",
    ],
  },
  stand_more: {
    targetQ: "How many standing breaks per day is your goal?",
    targetOptions: [
      "2–3 breaks",
      "4–6 breaks",
      "Every hour (6–8 breaks)",
      "Every 30 minutes",
    ],
    currentQ: "How often do you currently stand up and move?",
    currentOptions: [
      "Almost never",
      "1–2 times a day",
      "3–5 times a day",
      "Fairly often (6+)",
    ],
  },
};

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep]           = useState<Step>("goal");
  const [pendingGoal, setPendingGoal] = useState<Goal | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [goalTarget, setGoalTarget]   = useState("");
  const [goalCurrent, setGoalCurrent] = useState("");
  const [hasAvatar, setHasAvatar]     = useState(false);

  useEffect(() => {
    const voiceId  = localStorage.getItem("voiceId");
    const photoUrl = localStorage.getItem("photoUrl");
    setHasAvatar(!!voiceId && !!photoUrl);
  }, []);

  function confirmGoal() {
    if (!pendingGoal) return;
    setSelectedGoal(pendingGoal);
    setGoalTarget("");
    setGoalCurrent("");
    setStep("goal_target");
  }

  function saveAndClearMemory(goal: Goal, mode: Mode) {
    localStorage.setItem("userGoal", goal);
    localStorage.setItem("userMode", mode);
    localStorage.setItem("goalTarget", goalTarget.trim());
    localStorage.setItem("goalCurrent", goalCurrent.trim());
    localStorage.removeItem("sessionMemory_digital_twin");
    localStorage.removeItem("sessionMemory_therapist");
  }

  function handleModeSelect(mode: Mode) {
    if (mode === "therapist") {
      saveAndClearMemory(selectedGoal!, mode);
      router.push("/chat?mode=therapist");
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
    router.push("/chat?mode=digital_twin");
  }

  function handleNewAvatar() {
    saveAndClearMemory(selectedGoal!, "digital_twin");
    router.push("/onboarding");
  }

  const goalInfo = selectedGoal ? GOALS.find((g) => g.id === selectedGoal) : null;
  const questions = selectedGoal ? GOAL_QUESTIONS[selectedGoal] : null;

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

      {/* ── Goal target question ────────────────────────────────────────── */}
      {step === "goal_target" && goalInfo && questions && (
        <>
          <div className="space-y-2 text-center">
            <div className="text-5xl">{goalInfo.icon}</div>
            <h1 className="text-2xl font-black text-white">{questions.targetQ}</h1>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-sm">
            {questions.targetOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setGoalTarget(opt)}
                className={`w-full text-left px-5 py-4 rounded-2xl border font-medium text-sm transition ${
                  goalTarget === opt
                    ? "border-[#6C63FF] bg-[#6C63FF]/15 text-[#a09cf0] ring-1 ring-[#6C63FF]/50"
                    : "border-gray-600 bg-white/3 text-white"
                }`}
              >
                <span className="flex items-center justify-between">
                  {opt}
                  {goalTarget === opt && <span className="text-[#6C63FF]">✓</span>}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep("goal_current")}
            disabled={!goalTarget}
            className={`w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white transition ${
              goalTarget ? "bg-[#6C63FF] hover:bg-[#5a52e0]" : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
          >
            Next →
          </button>

          <button onClick={() => setStep("goal")} className="text-gray-500 text-sm">
            ← Back
          </button>
        </>
      )}

      {/* ── Goal current question ───────────────────────────────────────── */}
      {step === "goal_current" && goalInfo && questions && (
        <>
          <div className="space-y-2 text-center">
            <div className="text-5xl">{goalInfo.icon}</div>
            <h1 className="text-2xl font-black text-white">{questions.currentQ}</h1>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-sm">
            {questions.currentOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setGoalCurrent(opt)}
                className={`w-full text-left px-5 py-4 rounded-2xl border font-medium text-sm transition ${
                  goalCurrent === opt
                    ? "border-[#6C63FF] bg-[#6C63FF]/15 text-[#a09cf0] ring-1 ring-[#6C63FF]/50"
                    : "border-gray-600 bg-white/3 text-white"
                }`}
              >
                <span className="flex items-center justify-between">
                  {opt}
                  {goalCurrent === opt && <span className="text-[#6C63FF]">✓</span>}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep("mode")}
            disabled={!goalCurrent}
            className={`w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white transition ${
              goalCurrent ? "bg-[#6C63FF] hover:bg-[#5a52e0]" : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
          >
            Next →
          </button>

          <button onClick={() => setStep("goal_target")} className="text-gray-500 text-sm">
            ← Back
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
              className="flex-1 flex flex-col gap-3 text-left rounded-2xl border border-[#6C63FF]/40 bg-[#6C63FF]/5 active:bg-[#6C63FF]/15 p-6 transition"
            >
              <h2 className="text-lg font-bold text-white">Talk to your Avatar</h2>
              <p className="text-gray-400 text-sm">
                Your face, your voice — an AI version of you.
              </p>
              <span className="mt-auto text-[#6C63FF] text-sm font-semibold">
                Start now →
              </span>
            </button>

            <button
              onClick={() => handleModeSelect("therapist")}
              className="flex-1 flex flex-col gap-3 text-left rounded-2xl border border-[#6C63FF]/40 bg-[#6C63FF]/5 active:bg-[#6C63FF]/15 p-6 transition"
            >
              <h2 className="text-lg font-bold text-white">Talk to a Therapist</h2>
              <p className="text-gray-400 text-sm">
                A professional AI coach — no setup needed.
              </p>
              <span className="mt-auto text-[#6C63FF] text-sm font-semibold">
                Start now →
              </span>
            </button>
          </div>

          <button
            onClick={() => setStep("goal_current")}
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
