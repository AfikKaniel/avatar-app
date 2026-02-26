"use client";

import { useRef, useState, useCallback } from "react";

interface Props {
  onCapture: (blob: Blob) => void;
}

export default function PhotoCapture({ onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Start the webcam
  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      setStreaming(true);
    }
  }

  // Capture a frame from the video
  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPreview(canvas.toDataURL("image/jpeg"));
        // Stop camera stream
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
    startCamera();
  }

  return (
    <div className="space-y-3">
      {/* Live camera feed */}
      {!preview && (
        <div className="relative w-full aspect-video bg-gray-900 rounded-xl overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!streaming && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={startCamera}
                className="bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-2 px-6 rounded-lg transition"
              >
                Enable Camera
              </button>
            </div>
          )}
        </div>
      )}

      {/* Photo preview */}
      {preview && (
        <div className="relative w-full aspect-video bg-gray-900 rounded-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your photo" className="w-full h-full object-cover" />
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {streaming && !preview && (
        <button
          onClick={capture}
          className="w-full bg-[#6C63FF] hover:bg-[#5a52e0] text-white font-semibold py-3 rounded-xl transition"
        >
          Take Photo
        </button>
      )}

      {preview && (
        <button
          onClick={retake}
          className="w-full border border-gray-600 hover:border-gray-400 text-gray-300 font-semibold py-2 rounded-xl transition text-sm"
        >
          Retake
        </button>
      )}
    </div>
  );
}
