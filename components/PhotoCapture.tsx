"use client";

import { useRef, useState, useCallback } from "react";

interface Props {
  onCapture: (blob: Blob) => void;
}

export default function PhotoCapture({ onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    onCapture(file);
  }

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      setStreaming(true);
    }
  }

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPreview(canvas.toDataURL("image/jpeg"));
        (video.srcObject as MediaStream)?.getTracks().forEach((t) => t.stop());
        setStreaming(false);
        onCapture(blob);
      },
      "image/jpeg",
      0.92
    );
  }, [onCapture]);

  function retake() {
    setPreview(null);
    setStreaming(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      {/* Live camera feed */}
      {!preview && (
        <div className="relative w-full aspect-video bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          {!streaming && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={startCamera}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold py-2 px-6 rounded-lg transition cursor-pointer shadow-sm"
              >
                Enable Camera
              </button>
            </div>
          )}
        </div>
      )}

      {/* Photo preview */}
      {preview && (
        <div className="relative w-full aspect-video bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your photo" className="w-full h-full object-cover" />
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {streaming && !preview && (
        <button
          onClick={capture}
          className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold py-3 rounded-xl transition cursor-pointer shadow-sm"
        >
          Take Photo
        </button>
      )}

      {!preview && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm text-gray-600 font-semibold py-3 rounded-xl transition cursor-pointer text-sm"
        >
          Upload Photo Instead
        </button>
      )}

      {preview && (
        <button
          onClick={retake}
          className="w-full border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm text-gray-600 font-semibold py-2 rounded-xl transition cursor-pointer text-sm"
        >
          Retake / Choose Different
        </button>
      )}
    </div>
  );
}
