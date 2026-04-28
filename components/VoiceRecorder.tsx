"use client";

import { useRef, useState } from "react";

interface Props {
  onRecordingComplete: (blob: Blob | null) => void;
}

type State = "idle" | "recording" | "paused";

export default function VoiceRecorder({ onRecordingComplete }: Props) {
  const recorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const streamRef    = useRef<MediaStream | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef   = useRef(false);
  const [state, setState]     = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);

  function startTimer() {
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }
  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function startRecording() {
    onRecordingComplete(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    discardRef.current = false;

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      if (!discardRef.current && chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        onRecordingComplete(blob);
      }
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
    if (seconds < 60) {
      discardRef.current = true;
      onRecordingComplete(null);
    }
    recorderRef.current?.stop();
    setSeconds(0);
    setState("idle");
  }

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  const isActive = state === "recording" || state === "paused";

  return (
    <div className="space-y-2">
      <div className={`text-3xl font-mono font-bold text-center transition-colors ${
        seconds >= 60 ? "text-emerald-500" : state === "paused" ? "text-amber-500" : "text-gray-400"
      }`}>
        {formatTime(seconds)}
        {state === "paused" && <span className="text-xs font-sans ml-2 text-amber-500">paused</span>}
      </div>

      {isActive && seconds < 60 && (
        <p className="text-xs text-amber-600 text-center font-medium">
          Keep going — {60 - seconds}s more for a good clone
        </p>
      )}
      {isActive && seconds >= 60 && (
        <p className="text-xs text-emerald-600 text-center font-medium">
          Great! Stop when ready, or keep going for better quality.
        </p>
      )}

      {state === "idle" && (
        <button
          onClick={startRecording}
          className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold py-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
        >
          <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
          Start Recording
        </button>
      )}

      {state === "recording" && (
        <div className="flex gap-2">
          <button
            onClick={pauseRecording}
            className="flex-1 border border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100 font-semibold py-3 rounded-xl transition cursor-pointer"
          >
            Pause
          </button>
          <button
            onClick={stopRecording}
            className="flex-1 border border-rose-300 text-rose-500 bg-rose-50 hover:bg-rose-100 font-semibold py-3 rounded-xl transition cursor-pointer"
          >
            Stop
          </button>
        </div>
      )}

      {state === "paused" && (
        <div className="flex gap-2">
          <button
            onClick={resumeRecording}
            className="flex-1 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold py-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
          >
            <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
            Resume
          </button>
          <button
            onClick={stopRecording}
            className="flex-1 border border-gray-200 text-gray-500 bg-white hover:bg-gray-50 font-semibold py-3 rounded-xl transition cursor-pointer"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
