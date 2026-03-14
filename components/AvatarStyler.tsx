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
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { reject(new Error("No canvas context")); return; }

    // ── 1. Draw and extract pixels (lossless) ─────────────────────────────
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, W, H);
    const d = imageData.data;

    // ── 2. Per-pixel: saturate + posterize + contrast curve ───────────────
    //   Posterization = snapping lightness to N discrete bands = flat cel-shading
    const LEVELS = 7;
    const step = 1 / LEVELS;

    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);

      // Boost saturation
      const sNew = Math.min(1, s * 2.2);

      // Posterize lightness → discrete tonal bands
      const lPost = Math.round(l / step) * step;

      // S-curve: push lights up, darks down for harder transitions
      const lFinal = lPost < 0.5
        ? lPost * lPost * 2
        : 1 - Math.pow(1 - lPost, 2) * 2;

      const [r, g, b] = hslToRgb(h, sNew, Math.max(0, Math.min(1, lFinal)));
      d[i]     = r * 255;
      d[i + 1] = g * 255;
      d[i + 2] = b * 255;
    }

    ctx.putImageData(imageData, 0, 0);

    // ── 3. Soft bloom — adds the digital glow feel ────────────────────────
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.filter = "blur(14px) saturate(180%)";
    ctx.globalAlpha = 0.18;
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    ctx.filter = "none";

    // ── 4. Blue iris ──────────────────────────────────────────────────────
    if (iris) {
      for (const eye of [iris.left, iris.right]) {
        const { x, y, r } = eye;

        // Hue replacement — keeps texture, shifts color to blue
        ctx.save();
        ctx.globalCompositeOperation = "color";
        ctx.globalAlpha = 0.97;
        const gc = ctx.createRadialGradient(x, y, 0, x, y, r);
        gc.addColorStop(0,    "rgba(0, 145, 255, 1)");
        gc.addColorStop(0.55, "rgba(5, 115, 245, 1)");
        gc.addColorStop(1,    "rgba(15, 90, 225, 0)");
        ctx.fillStyle = gc;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.88, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Luminance pop — bright digital shine
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.55;
        const gs = ctx.createRadialGradient(x, y, 0, x, y, r * 0.65);
        gs.addColorStop(0,    "rgba(160, 225, 255, 0.90)");
        gs.addColorStop(0.45, "rgba(80, 180, 255, 0.50)");
        gs.addColorStop(1,    "rgba(30, 130, 245, 0)");
        ctx.fillStyle = gs;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.75, r * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Pupil depth
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.75;
        const gp = ctx.createRadialGradient(x, y, 0, x, y, r * 0.32);
        gp.addColorStop(0,   "rgba(0, 0, 10, 1)");
        gp.addColorStop(0.6, "rgba(0, 0, 20, 0.8)");
        gp.addColorStop(1,   "rgba(0, 0, 30, 0)");
        ctx.fillStyle = gp;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.32, r * 0.30, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ── 5. Vignette ───────────────────────────────────────────────────────
    const vg = ctx.createRadialGradient(
      W / 2, H / 2, H * 0.22,
      W / 2, H / 2, H * 0.82
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.40)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.95
    );
  });
}

// ── Color space helpers ───────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}
