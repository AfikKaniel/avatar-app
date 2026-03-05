"use client";

import { useRef, useState } from "react";

interface Props {
  onRecordingComplete: (blob: Blob) => void;
}

type State = "idle" | "recording" | "paused" | "done";

export default function VoiceRecorder({ onRecordingComplete }: Props) {
  const recorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef     = useRef<Blob[]>([]);
  const streamRef     = useRef<MediaStream | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const [state, setState]   = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);

  function startTimer() {
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      onRecordingComplete(blob);
      stream.getTracks().forEach((t) => t.stop());
    };

    recorderRef.current = recorder;
    recorder.start(100);
    setState("recording");
    setSeconds(0);
    startTimer();
  }

  function pauseRecording() {
    recorderRef.current?.pause();
    stopTimer();
    setState("paused");
  }

  function resumeRecording() {
    recorderRef.current?.resume();
    startTimer();
    setState("recording");
  }

  function stopRecording() {
    stopTimer();
    recorderRef.current?.stop();
    setState("done");
  }

  function restartRecording() {
    stopTimer();
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    chunksRef.current = [];
    setSeconds(0);
    setState("idle");
    // small delay so onstop fires cleanly before we re-init
    setTimeout(startRecording, 150);
  }

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  const isActive = state === "recording" || state === "paused";

  return (
    <div className="space-y-3">
      {/* Timer */}
      <div className={`text-4xl font-mono font-bold text-center transition-colors ${
        seconds >= 60 ? "text-green-400" : state === "paused" ? "text-yellow-400" : "text-gray-400"
      }`}>
        {formatTime(seconds)}
        {state === "paused" && <span className="text-sm font-sans ml-2 text-yellow-400">paused</span>}
      </div>

      {isActive && seconds < 60 && (
        <p className="text-xs text-yellow-500 text-center">
          Keep going — {60 - seconds}s more for a good clone
        </p>
      )}
      {isActive && seconds >= 60 && (
        <p className="text-xs text-green-500 text-center">
          Great! Stop when you're ready, or keep going for even better quality.
        </p>
      )}
      {state === "done" && (
        <p className="text-xs text-green-500 text-center">
          Recording saved — tap "Create My Avatar" below when ready.
        </p>
      )}

      {/* Controls */}
      {state === "idle" && (
        <button
          onClick={startRecording}
          className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
        >
          <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
          Start Recording
        </button>
      )}

      {state === "recording" && (
        <div className="flex gap-2">
          <button
            onClick={pauseRecording}
            className="flex-1 border border-yellow-500 text-yellow-400 hover:bg-yellow-900/20 font-semibold py-3 rounded-xl transition"
          >
            Pause
          </button>
          <button
            onClick={stopRecording}
            className="flex-1 border border-red-600 text-red-400 hover:bg-red-900/20 font-semibold py-3 rounded-xl transition"
          >
            Stop
          </button>
        </div>
      )}

      {state === "paused" && (
        <div className="flex gap-2">
          <button
            onClick={resumeRecording}
            className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
          >
            <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
            Resume
          </button>
          <button
            onClick={stopRecording}
            className="flex-1 border border-red-600 text-red-400 hover:bg-red-900/20 font-semibold py-3 rounded-xl transition"
          >
            Stop
          </button>
        </div>
      )}

      {state === "done" && (
        <button
          onClick={restartRecording}
          className="w-full border border-gray-600 hover:border-gray-400 text-gray-300 font-semibold py-2 rounded-xl transition text-sm"
        >
          Re-record
        </button>
      )}
    </div>
  );
}
