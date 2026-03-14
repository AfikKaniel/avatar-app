"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  originalBlob: Blob;
  onAccept: (blob: Blob) => void;
  onRetake: () => void;
}

export default function AvatarStyler({ originalBlob, onAccept, onRetake }: Props) {
  const [status, setStatus]         = useState<"loading" | "done" | "error">("loading");
  const [styledUrl, setStyledUrl]   = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [errorMsg, setErrorMsg]     = useState("");
  const styledBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(originalBlob);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [originalBlob]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const form = new FormData();
        form.append("photo", originalBlob, "photo.jpg");

        const res = await fetch("/api/stylize-avatar", { method: "POST", body: form });
        if (!res.ok) throw new Error("Stylization failed — try retaking your photo.");

        const blob = await res.blob();
        if (!cancelled) {
          styledBlobRef.current = blob;
          setStyledUrl(URL.createObjectURL(blob));
          setStatus("done");
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : "Enhancement failed");
          setStatus("error");
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [originalBlob]);

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center gap-5 py-10 w-full max-w-md mx-auto text-center">
        <span className="text-5xl select-none">✨</span>
        <div className="w-12 h-12 border-[3px] border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
        <p className="text-white font-black text-xl">Transforming your avatar…</p>
        <p className="text-gray-400 text-sm">AI is building your digital look. Takes ~20 seconds.</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 w-full max-w-md mx-auto text-center">
        <p className="text-red-400">{errorMsg}</p>
        <button onClick={onRetake} className="text-[#6C63FF] underline text-sm">
          ← Retake photo
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-md mx-auto">
      <div className="relative w-full aspect-square bg-gray-900 rounded-xl overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={showOriginal ? originalUrl : styledUrl}
          alt="Avatar preview"
          className="w-full h-full object-cover transition-opacity duration-200"
        />
        <div className="absolute top-2 left-2">
          {showOriginal ? (
            <span className="bg-black/60 text-gray-300 text-xs px-2 py-1 rounded-full">Original</span>
          ) : (
            <span className="bg-[#6C63FF]/80 text-white text-xs px-2 py-1 rounded-full">✨ AI Enhanced</span>
          )}
        </div>
      </div>

      <button
        onClick={() => setShowOriginal((v) => !v)}
        className="text-gray-400 text-sm transition text-center"
      >
        {showOriginal ? "Show enhanced →" : "Compare with original"}
      </button>

      <button
        onClick={() => styledBlobRef.current && onAccept(styledBlobRef.current)}
        className="w-full bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 rounded-xl transition"
      >
        Love it! Use this avatar
      </button>
      <button
        onClick={onRetake}
        className="w-full border border-gray-600 text-gray-300 font-semibold py-2 rounded-xl transition text-sm"
      >
        Retake Photo
      </button>
    </div>
  );
}
