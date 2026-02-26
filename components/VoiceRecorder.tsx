"use client";

import { useRef, useState } from "react";

interface Props {
  onRecordingComplete: (blob: Blob) => void;
}

export default function VoiceRecorder({ onRecordingComplete }: Props) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      onRecordingComplete(blob);
      stream.getTracks().forEach((t) => t.stop());
    };

    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setSeconds(0);

    timerRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  return (
    <div className="space-y-3">
      {/* Timer */}
      <div
        className={`text-4xl font-mono font-bold text-center transition-colors ${
          seconds >= 60 ? "text-green-400" : "text-gray-400"
        }`}
      >
        {formatTime(seconds)}
      </div>

      {seconds > 0 && seconds < 60 && (
        <p className="text-xs text-yellow-500 text-center">
          Keep going — {60 - seconds}s more needed for a good clone
        </p>
      )}
      {seconds >= 60 && (
        <p className="text-xs text-green-500 text-center">
          Great! You can stop now or keep going for better quality.
        </p>
      )}

      {/* Record / Stop button */}
      {!recording ? (
        <button
          onClick={startRecording}
          className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
        >
          <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
          Start Recording
        </button>
      ) : (
        <button
          onClick={stopRecording}
          className="w-full border border-red-600 text-red-400 hover:bg-red-900/20 font-semibold py-3 rounded-xl transition"
        >
          Stop Recording
        </button>
      )}

      {/* Playback */}
      {audioUrl && !recording && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 text-center">Preview your recording:</p>
          <audio controls src={audioUrl} className="w-full" />
        </div>
      )}
    </div>
  );
}
