"use client";

import { useEffect, useRef, useState } from "react";

interface IrisPoints {
  left:  { x: number; y: number; r: number };
  right: { x: number; y: number; r: number };
}

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
  const styledBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    const objUrl = URL.createObjectURL(originalBlob);
    setOriginalUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [originalBlob]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const img = await blobToImage(originalBlob);
        if (cancelled) return;

        // ── Try MediaPipe iris detection ────────────────────────────────
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
          if (!cancelled) {
            const result = landmarker.detect(img);
            landmarker.close();
            const lms = result.faceLandmarks?.[0];
            if (lms) {
              const w = img.naturalWidth;
              const h = img.naturalHeight;
              if (lms.length >= 478) {
                // Full model — use precise iris landmarks 468-477
                const lc = lms[468], rc = lms[473];
                const lr = avgDist(lms, 469, 472, lc, w, h);
                const rr = avgDist(lms, 474, 477, rc, w, h);
                iris = {
                  left:  { x: lc.x * w, y: lc.y * h, r: lr * 1.15 },
                  right: { x: rc.x * w, y: rc.y * h, r: rr * 1.15 },
                };
              } else {
                // Fallback — estimate iris center from eye outline landmarks
                const leftPts  = [33, 133, 159, 145, 160, 144, 158, 153];
                const rightPts = [263, 362, 386, 374, 387, 373, 385, 380];
                const lCx = avg(lms, leftPts,  "x") * w;
                const lCy = avg(lms, leftPts,  "y") * h;
                const rCx = avg(lms, rightPts, "x") * w;
                const rCy = avg(lms, rightPts, "y") * h;
                const lr2 = Math.abs((lms[133].x - lms[33].x) * w) * 0.38;
                const rr2 = Math.abs((lms[362].x - lms[263].x) * w) * 0.38;
                iris = {
                  left:  { x: lCx, y: lCy, r: lr2 },
                  right: { x: rCx, y: rCy, r: rr2 },
                };
              }
            }
          }
        } catch {
          // MediaPipe unavailable — apply filter-only style
        }

        if (cancelled) return;

        const blob = await applyStyle(img, iris);
        if (!cancelled) {
          styledBlobRef.current = blob;
          setStyledUrl(URL.createObjectURL(blob));
          setStatus("done");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [originalBlob]);

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 w-full max-w-md mx-auto">
        <div className="w-16 h-16 border-4 border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
        <p className="text-white font-semibold text-lg">Enhancing your avatar…</p>
        <p className="text-gray-400 text-sm">Adding the digital spark ✨</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 w-full max-w-md mx-auto text-center">
        <p className="text-red-400">Enhancement failed — retake your photo and try again.</p>
        <button onClick={onRetake} className="text-[#6C63FF] underline text-sm">
          ← Retake photo
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-md mx-auto">
      {/* Preview */}
      <div className="relative w-full aspect-video bg-gray-900 rounded-xl overflow-hidden">
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
            <span className="bg-[#6C63FF]/80 text-white text-xs px-2 py-1 rounded-full">✨ Enhanced</span>
          )}
        </div>
      </div>

      {/* Before / After toggle */}
      <button
        onClick={() => setShowOriginal((v) => !v)}
        className="text-gray-400 hover:text-gray-200 text-sm transition text-center"
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
        className="w-full border border-gray-600 hover:border-gray-400 text-gray-300 font-semibold py-2 rounded-xl transition text-sm"
      >
        Retake Photo
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

type LM = { x: number; y: number };

function avgDist(
  lms: LM[],
  from: number,
  to: number,
  center: LM,
  w: number,
  h: number
): number {
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

function applyStyle(img: HTMLImageElement, iris: IrisPoints | null): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("No canvas context")); return; }

    // ── 1. Soft base: skin-smoothing blur at low opacity ─────────────────
    ctx.filter = "blur(1.5px) brightness(101%)";
    ctx.globalAlpha = 0.35;
    ctx.drawImage(img, 0, 0);
    ctx.globalAlpha = 1.0;
    ctx.filter = "none";

    // ── 2. Vivid animated pass: sharp + high saturation on top ───────────
    ctx.filter = "saturate(185%) contrast(118%) brightness(106%)";
    ctx.globalAlpha = 0.88;
    ctx.drawImage(img, 0, 0);
    ctx.globalAlpha = 1.0;
    ctx.filter = "none";

    // ── 3. Color bloom / digital halation glow ────────────────────────────
    ctx.save();
    ctx.filter = "blur(10px) saturate(160%)";
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.18;
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    ctx.filter = "none";

    // ── 4. Blue iris — two passes for realistic vivid color ───────────────
    if (iris) {
      for (const eye of [iris.left, iris.right]) {
        const { x, y, r } = eye;

        // Pass A: "color" blend — swaps hue to blue while keeping luminosity/texture
        ctx.save();
        ctx.globalCompositeOperation = "color";
        ctx.globalAlpha = 0.88;
        const gc = ctx.createRadialGradient(x, y, 0, x, y, r);
        gc.addColorStop(0,    "rgba(0, 140, 255, 1)");
        gc.addColorStop(0.60, "rgba(10, 110, 240, 1)");
        gc.addColorStop(1,    "rgba(20,  90, 220, 0)");
        ctx.fillStyle = gc;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.88, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Pass B: "screen" — adds bright-blue luminance pop / digital shine
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.40;
        const gs = ctx.createRadialGradient(x, y, 0, x, y, r * 0.65);
        gs.addColorStop(0,   "rgba(100, 200, 255, 0.75)");
        gs.addColorStop(0.5, "rgba( 60, 160, 255, 0.35)");
        gs.addColorStop(1,   "rgba( 20, 120, 240, 0)");
        ctx.fillStyle = gs;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.70, r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ── 5. Cinematic vignette ─────────────────────────────────────────────
    const vg = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.25,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.80
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.32)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.93
    );
  });
}
