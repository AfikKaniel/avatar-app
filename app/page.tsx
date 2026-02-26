import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-8 px-4 text-center">
      <div className="space-y-3">
        <h1 className="text-5xl font-bold tracking-tight">Meet Your Avatar</h1>
        <p className="text-gray-400 text-lg max-w-md">
          Take a photo, record your voice, and get a personal AI avatar that
          looks and sounds exactly like you.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          href="/onboarding"
          className="bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 px-8 rounded-xl transition"
        >
          Create My Avatar
        </Link>
        <Link
          href="/chat"
          className="border border-gray-600 hover:border-gray-400 text-gray-300 font-semibold py-3 px-8 rounded-xl transition"
        >
          Talk to My Avatar
        </Link>
      </div>

      <p className="text-xs text-gray-600 max-w-sm">
        Powered by HeyGen · ElevenLabs · Claude
      </p>
    </main>
  );
}
