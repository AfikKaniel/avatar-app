"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { persistSet, persistGet, persistRemove } from "@/lib/persist";

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
    const voiceId  = persistGet("voiceId");
    const photoUrl = persistGet("photoUrl");
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
    persistSet("userGoal", goal);
    persistSet("userMode", mode);
    persistSet("goalTarget", goalTarget.trim());
    persistSet("goalCurrent", goalCurrent.trim());
    persistRemove("sessionMemory_digital_twin");
    persistRemove("sessionMemory_therapist");
    persistRemove("sessionCount_digital_twin");
    persistRemove("sessionCount_therapist");
    persistRemove("lastSessionTime_digital_twin");
    persistRemove("lastSessionTime_therapist");
  }

  function handleModeSelect(mode: Mode) {
    saveAndClearMemory(selectedGoal!, mode);
    if (mode === "therapist") {
      router.push("/chat?mode=therapist");
    } else if (hasAvatar) {
      router.push("/chat?mode=digital_twin");
    } else {
      router.push("/onboarding");
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
            <h1 className="text-3xl font-black text-gray-900">What&apos;s your goal?</h1>
            <p className="text-gray-500 text-sm max-w-sm">
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
                  className={`flex items-center gap-4 text-left w-full rounded-2xl border p-5 transition cursor-pointer ${
                    isSelected
                      ? "border-[#8B5CF6] bg-[#8B5CF6]/8 ring-1 ring-[#8B5CF6]/30 shadow-sm"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                  }`}
                >
                  <span className="text-4xl">{goal.icon}</span>
                  <div>
                    <p className={`font-semibold transition ${isSelected ? "text-[#8B5CF6]" : "text-gray-800"}`}>
                      {goal.label}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">{goal.description}</p>
                  </div>
                  {isSelected && (
                    <span className="ml-auto text-[#8B5CF6] text-lg font-bold">✓</span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={confirmGoal}
            disabled={!pendingGoal}
            className={`w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white transition cursor-pointer ${
              pendingGoal
                ? "bg-[#8B5CF6] hover:bg-[#7C3AED] shadow-sm hover:shadow-md"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
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
            <h1 className="text-2xl font-black text-gray-900">{questions.targetQ}</h1>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-sm">
            {questions.targetOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setGoalTarget(opt)}
                className={`w-full text-left px-5 py-4 rounded-2xl border font-medium text-sm transition cursor-pointer ${
                  goalTarget === opt
                    ? "border-[#8B5CF6] bg-[#8B5CF6]/8 text-[#8B5CF6] ring-1 ring-[#8B5CF6]/30 shadow-sm"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                <span className="flex items-center justify-between">
                  {opt}
                  {goalTarget === opt && <span className="text-[#8B5CF6] font-bold">✓</span>}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep("goal_current")}
            disabled={!goalTarget}
            className={`w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white transition cursor-pointer ${
              goalTarget ? "bg-[#8B5CF6] hover:bg-[#7C3AED] shadow-sm hover:shadow-md" : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            Next →
          </button>

          <button onClick={() => setStep("goal")} className="text-gray-400 text-sm hover:text-gray-600 transition cursor-pointer">
            ← Back
          </button>
        </>
      )}

      {/* ── Goal current question ───────────────────────────────────────── */}
      {step === "goal_current" && goalInfo && questions && (
        <>
          <div className="space-y-2 text-center">
            <div className="text-5xl">{goalInfo.icon}</div>
            <h1 className="text-2xl font-black text-gray-900">{questions.currentQ}</h1>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-sm">
            {questions.currentOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setGoalCurrent(opt)}
                className={`w-full text-left px-5 py-4 rounded-2xl border font-medium text-sm transition cursor-pointer ${
                  goalCurrent === opt
                    ? "border-[#8B5CF6] bg-[#8B5CF6]/8 text-[#8B5CF6] ring-1 ring-[#8B5CF6]/30 shadow-sm"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                <span className="flex items-center justify-between">
                  {opt}
                  {goalCurrent === opt && <span className="text-[#8B5CF6] font-bold">✓</span>}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep("mode")}
            disabled={!goalCurrent}
            className={`w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white transition cursor-pointer ${
              goalCurrent ? "bg-[#8B5CF6] hover:bg-[#7C3AED] shadow-sm hover:shadow-md" : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            Next →
          </button>

          <button onClick={() => setStep("goal_target")} className="text-gray-400 text-sm hover:text-gray-600 transition cursor-pointer">
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
            <h1 className="text-3xl font-black text-gray-900">
              {GOALS.find((g) => g.id === selectedGoal)?.label}
            </h1>
            <p className="text-gray-500 text-sm max-w-sm">
              Who would you like to talk to?
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xl">
            <button
              onClick={() => handleModeSelect("digital_twin")}
              className="flex-1 flex flex-col gap-3 text-left rounded-2xl border border-gray-200 bg-white hover:border-[#8B5CF6]/50 hover:shadow-md p-6 transition cursor-pointer shadow-sm"
            >
              <h2 className="text-lg font-bold text-gray-900">Talk to your Avatar</h2>
              <p className="text-gray-500 text-sm">
                Your face, your voice — an AI version of you.
              </p>
              <span className="mt-auto text-[#8B5CF6] text-sm font-semibold">
                Start now →
              </span>
            </button>

            <button
              onClick={() => handleModeSelect("therapist")}
              className="flex-1 flex flex-col gap-3 text-left rounded-2xl border border-gray-200 bg-white hover:border-[#8B5CF6]/50 hover:shadow-md p-6 transition cursor-pointer shadow-sm"
            >
              <h2 className="text-lg font-bold text-gray-900">Talk to a Therapist</h2>
              <p className="text-gray-500 text-sm">
                A professional AI coach — no setup needed.
              </p>
              <span className="mt-auto text-[#8B5CF6] text-sm font-semibold">
                Start now →
              </span>
            </button>
          </div>

          <button
            onClick={() => setStep("goal_current")}
            className="text-gray-400 text-sm hover:text-gray-600 transition cursor-pointer"
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
            <h1 className="text-3xl font-black text-gray-900">Your Avatar</h1>
            <p className="text-gray-500 text-sm max-w-sm">
              You already have an avatar. Keep it or create a new one?
            </p>
          </div>

          <div className="flex flex-col gap-4 w-full max-w-sm">
            <button
              onClick={handleKeepAvatar}
              className="w-full text-center bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold py-3 px-6 rounded-xl transition cursor-pointer shadow-sm hover:shadow-md"
            >
              Keep My Avatar
            </button>
            <button
              onClick={handleNewAvatar}
              className="w-full text-center border border-gray-200 bg-white text-gray-600 font-semibold py-3 px-6 rounded-xl hover:border-gray-300 hover:shadow-sm transition cursor-pointer"
            >
              Create a New Avatar
            </button>
          </div>

          <button
            onClick={() => setStep("mode")}
            className="text-gray-400 text-sm hover:text-gray-600 transition cursor-pointer"
          >
            ← Back
          </button>
        </>
      )}
    </main>
  );
}
