"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Home() {
  const [hasAvatar, setHasAvatar] = useState(false);

  useEffect(() => {
    const voiceId  = localStorage.getItem("voiceId");
    const photoUrl = localStorage.getItem("photoUrl");
    setHasAvatar(!!voiceId && !!photoUrl);
  }, []);

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
          Choose how you want to begin your session today.
        </p>
      </div>

      {/* Mode cards */}
      <div className="flex flex-col sm:flex-row gap-5 w-full max-w-xl">

        {/* Digital Twin card */}
        <div className="flex-1 flex flex-col gap-4 rounded-2xl border border-[#6C63FF]/40 bg-[#6C63FF]/5 p-6 text-left">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#a09cf0] mb-1">
              Digital Twin
            </p>
            <h2 className="text-lg font-bold text-white leading-snug">
              Talk to yourself
            </h2>
            <p className="text-gray-400 text-sm mt-2">
              Speak with an AI version of you — your face, your voice, your perspective.
            </p>
          </div>

          {hasAvatar ? (
            <div className="flex flex-col gap-2 mt-auto">
              <Link
                href="/chat?mode=digital_twin"
                className="text-center bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-2.5 px-6 rounded-xl transition text-sm"
              >
                Talk to My Twin
              </Link>
              <Link
                href="/onboarding"
                className="text-center border border-gray-600 hover:border-gray-400 text-gray-300 font-semibold py-2.5 px-6 rounded-xl transition text-sm"
              >
                Recreate My Avatar
              </Link>
            </div>
          ) : (
            <Link
              href="/onboarding"
              className="mt-auto text-center bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-2.5 px-6 rounded-xl transition text-sm"
            >
              Create My Avatar
            </Link>
          )}
        </div>

        {/* Therapist card */}
        <div className="flex-1 flex flex-col gap-4 rounded-2xl border border-gray-600 bg-white/3 p-6 text-left">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
              Professional Therapist
            </p>
            <h2 className="text-lg font-bold text-white leading-snug">
              Talk to a therapist
            </h2>
            <p className="text-gray-400 text-sm mt-2">
              Speak with a professional AI therapist — no setup needed, start immediately.
            </p>
          </div>

          <Link
            href="/chat?mode=therapist"
            className="mt-auto text-center border border-gray-500 hover:border-gray-300 text-gray-200 hover:text-white font-semibold py-2.5 px-6 rounded-xl transition text-sm"
          >
            Talk to a Therapist
          </Link>
        </div>

      </div>
    </main>
  );
}
