"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { persistGet } from "@/lib/persist";

const GOAL_LABELS: Record<string, { icon: string; label: string }> = {
  quit_smoking: { icon: "🚭", label: "Quit Smoking" },
  drink_water:  { icon: "💧", label: "Drink More Water" },
  stand_more:   { icon: "🧍", label: "Stand More" },
};

const MODE_LABELS: Record<string, string> = {
  digital_twin: "Digital Twin",
  therapist:    "AI Therapist",
};

export default function Home() {
  const router = useRouter();
  const [setup, setSetup] = useState<{
    goal: string;
    mode: string;
    hasAvatar: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const goal     = persistGet("userGoal");
    const mode     = persistGet("userMode");
    const voiceId  = persistGet("voiceId");
    const photoUrl = persistGet("photoUrl");

    if (goal && mode) {
      setSetup({ goal, mode, hasAvatar: !!voiceId && !!photoUrl });
    }
    setReady(true);
  }, []);

  function handleNewAdventure() {
    router.push("/setup");
  }

  // Don't render until localStorage is read (avoids flash)
  if (!ready) return null;

  return (
    <main
      className="flex flex-col items-center justify-center min-h-screen gap-10 px-4 text-center"
      style={{ marginTop: "-10vh" }}
    >
      {/* Title */}
      <div className="space-y-4">
        <h1
          className="text-6xl font-black uppercase"
          style={{
            fontFamily: "'SF Pro Display', 'Inter', system-ui, sans-serif",
            letterSpacing: "0.06em",
            background: "linear-gradient(135deg, #00f0ff 0%, #7b5fff 45%, #ff3cac 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter: "drop-shadow(0 0 18px rgba(123,95,255,0.45))",
          }}
        >
          GAGING.AI
        </h1>
        <p className="text-gray-400 text-lg max-w-md">
          {setup
            ? "Welcome back. Ready to keep going?"
            : "Your AI companion for building better habits."}
        </p>
      </div>

      {/* ── Returning user ─────────────────────────────────────────────── */}
      {setup ? (
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          {/* Goal badge */}
          <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-[#6C63FF]/40 bg-[#6C63FF]/5">
            <span className="text-3xl">
              {GOAL_LABELS[setup.goal]?.icon ?? "🎯"}
            </span>
            <div className="text-left">
              <p className="text-xs text-gray-400 uppercase tracking-widest">
                Your goal
              </p>
              <p className="text-white font-semibold">
                {GOAL_LABELS[setup.goal]?.label ?? setup.goal}
              </p>
              <p className="text-xs text-gray-500">
                via {MODE_LABELS[setup.mode] ?? setup.mode}
              </p>
            </div>
          </div>

          {/* Continue — for digital_twin, only show if avatar exists */}
          {setup.mode === "therapist" ? (
            <Link
              href="/chat?mode=therapist"
              className="w-full text-center bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-6 rounded-xl transition"
            >
              Continue Your Journey
            </Link>
          ) : setup.hasAvatar ? (
            <Link
              href="/chat?mode=digital_twin"
              className="w-full text-center bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-6 rounded-xl transition"
            >
              Continue Your Journey
            </Link>
          ) : (
            <Link
              href="/onboarding"
              className="w-full text-center bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-6 rounded-xl transition"
            >
              Create My Avatar to Continue
            </Link>
          )}

          <button
            onClick={handleNewAdventure}
            className="w-full text-center border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white font-semibold py-3 px-6 rounded-xl transition text-sm"
          >
            Start New Adventure
          </button>
        </div>
      ) : (
        /* ── First-time user ──────────────────────────────────────────── */
        <Link
          href="/setup"
          className="bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-10 rounded-xl transition text-lg"
        >
          Get Started
        </Link>
      )}
    </main>
  );
}
