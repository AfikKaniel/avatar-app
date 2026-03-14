"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  originalBlob: Blob;
  onAccept: (blob: Blob) => void;
  onRetake: () => void;
}

export default function AvatarStyler({ originalBlob, onAccept, onRetake }: Props) {
  const [status, setStatus]           = useState<"loading" | "done" | "error">("loading");
  const [styledUrl, setStyledUrl]     = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [errorMsg, setErrorMsg]       = useState("");
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
        // ── 1. AI holistic transformation (or passthrough if no key) ──────
        const form = new FormData();
        form.append("photo", originalBlob, "photo.jpg");
        const res = await fetch("/api/stylize-avatar", { method: "POST", body: form });
        if (!res.ok) throw new Error("Enhancement unavailable.");
        const aiBlob = await res.blob();

        // ── 2. Canvas: paint light-blue iris on top (always applied) ──────
        const finalBlob = await applyBlueEyes(aiBlob);

        if (!cancelled) {
          styledBlobRef.current = finalBlob;
          setStyledUrl(URL.createObjectURL(finalBlob));
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

// ── Blue-eye canvas pass ──────────────────────────────────────────────────────
// Runs on the AI-transformed (or original) blob. Detects iris positions with
// MediaPipe, then paints light-blue via canvas composite operations.

async function applyBlueEyes(sourceBlob: Blob): Promise<Blob> {
  const img = await blobToImage(sourceBlob);

  // Try MediaPipe iris detection; fall back to no-op if unavailable
  let iris: IrisPoints | null = null;
  try {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
    );
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    const result = landmarker.detect(img);
    landmarker.close();
    const lms = result.faceLandmarks?.[0];
    if (lms) {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (lms.length >= 478) {
        const lc = lms[468], rc = lms[473];
        const lr = avgDist(lms, 469, 472, lc, w, h);
        const rr = avgDist(lms, 474, 477, rc, w, h);
        iris = {
          left:  { x: lc.x * w, y: lc.y * h, r: lr * 1.2 },
          right: { x: rc.x * w, y: rc.y * h, r: rr * 1.2 },
        };
      } else {
        const lPts = [33, 133, 159, 145, 160, 144, 158, 153];
        const rPts = [263, 362, 386, 374, 387, 373, 385, 380];
        const lCx = avg(lms, lPts, "x") * w, lCy = avg(lms, lPts, "y") * h;
        const rCx = avg(lms, rPts, "x") * w, rCy = avg(lms, rPts, "y") * h;
        iris = {
          left:  { x: lCx, y: lCy, r: Math.abs((lms[133].x - lms[33].x) * w) * 0.38 },
          right: { x: rCx, y: rCy, r: Math.abs((lms[362].x - lms[263].x) * w) * 0.38 },
        };
      }
    }
  } catch {
    // MediaPipe unavailable — skip iris coloring, return source as-is
  }

  if (!iris) return sourceBlob; // Nothing to paint — return unchanged

  return paintIris(img, iris);
}

function paintIris(img: HTMLImageElement, iris: IrisPoints): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("No canvas context")); return; }

    ctx.drawImage(img, 0, 0);

    for (const { x, y, r } of [iris.left, iris.right]) {
      // Pass A: replace hue with light blue while keeping texture
      ctx.save();
      ctx.globalCompositeOperation = "color";
      ctx.globalAlpha = 0.90;
      const gc = ctx.createRadialGradient(x, y, 0, x, y, r);
      gc.addColorStop(0,    "rgba(100, 190, 255, 1)");
      gc.addColorStop(0.6,  "rgba(70,  160, 255, 1)");
      gc.addColorStop(1,    "rgba(40,  120, 240, 0)");
      ctx.fillStyle = gc;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.88, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Pass B: luminance glow — makes eyes appear bright/digital
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.50;
      const gs = ctx.createRadialGradient(x, y, 0, x, y, r * 0.65);
      gs.addColorStop(0,    "rgba(200, 235, 255, 0.85)");
      gs.addColorStop(0.5,  "rgba(120, 200, 255, 0.40)");
      gs.addColorStop(1,    "rgba(60,  160, 255, 0)");
      ctx.fillStyle = gs;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.72, r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Pass C: darken pupil for depth
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.72;
      const gp = ctx.createRadialGradient(x, y, 0, x, y, r * 0.30);
      gp.addColorStop(0,   "rgba(0, 0, 8, 1)");
      gp.addColorStop(0.7, "rgba(0, 0, 15, 0.7)");
      gp.addColorStop(1,   "rgba(0, 0, 20, 0)");
      ctx.fillStyle = gp;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.30, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.95
    );
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface IrisPoints {
  left:  { x: number; y: number; r: number };
  right: { x: number; y: number; r: number };
}

type LM = { x: number; y: number };

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

function avgDist(lms: LM[], from: number, to: number, center: LM, w: number, h: number): number {
  let total = 0, count = 0;
  for (let i = from; i <= to; i++) {
    const dx = (lms[i].x - center.x) * w;
    const dy = (lms[i].y - center.y) * h;
    total += Math.sqrt(dx * dx + dy * dy);
    count++;
  }
  return count > 0 ? total / count : 10;
}

function avg(lms: LM[], indices: number[], axis: "x" | "y"): number {
  return indices.reduce((s, i) => s + lms[i][axis], 0) / indices.length;
}
