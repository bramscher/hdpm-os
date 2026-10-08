"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Keeps a take under the 25 MB transcription limit at any browser's default bitrate.
const MAX_SECONDS = 45 * 60;
const MAX_BYTES = 25 * 1024 * 1024;
// iPhone Safari may ignore the requested bitrate, so also stop on size.
const STOP_AT_BYTES = 24 * 1024 * 1024;

// iPhone Files/Voice Memos exports sometimes arrive with an empty MIME type.
const AUDIO_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
};

/** The file as audio with a usable type, or null if it isn't audio we can transcribe. */
function asAudio(file: File): Blob | null {
  if (file.type.startsWith("audio/") || file.type === "video/mp4") {
    return file.type === "video/mp4" ? new Blob([file], { type: "audio/mp4" }) : file;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXT[ext] ? new Blob([file], { type: AUDIO_EXT[ext] }) : null;
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) =>
    MediaRecorder.isTypeSupported(m)
  );
}

export const formatClock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

type State = "idle" | "recording" | "paused" | "review";

/**
 * Record in the browser (or attach a phone voice memo), review, then hand the
 * blob to `onSave`. Owns the microphone for the duration of a take only.
 */
export function Recorder({
  onSave,
  busy,
  extraActions,
  onTakeChange,
}: {
  onSave: (audio: Blob) => Promise<boolean>;
  busy: boolean;
  /** True while a take is being recorded or waiting to be saved (unsaved work). */
  onTakeChange?: (inProgress: boolean) => void;
  /** More ways to add knowledge, shown beside the idle buttons (e.g. Type or paste). */
  extraActions?: React.ReactNode;
}) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const parts = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bytes = useRef(0);
  const starting = useRef(false);
  const urls = useRef<string[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    onTakeChange?.(state !== "idle");
  }, [state, onTakeChange]);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const startTimer = () => {
    stopTimer();
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  // Release the mic, timer and preview URLs if the page unmounts mid-take.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopTimer();
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      onTakeChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  };

  // Warn before leaving with an unsaved take.
  useEffect(() => {
    if (state === "idle") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) {
      toast.info("Reached 45 minutes — stopping this take. Save it, then start another.");
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, state]);

  async function start() {
    if (starting.current) return; // a double tap would open two microphones
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("This browser can't record audio. Attach a voice memo instead.");
      return;
    }
    starting.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      starting.current = false;
      toast.error("Microphone access was blocked. Allow it in the browser's site settings.");
      return;
    }
    const mimeType = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48000 });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      starting.current = false;
      toast.error("This browser can't record here. Attach a voice memo instead.");
      return;
    }
    parts.current = [];
    bytes.current = 0;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      parts.current.push(e.data);
      bytes.current += e.data.size;
      if (bytes.current >= STOP_AT_BYTES && rec.state === "recording") {
        toast.info("This take is nearly 25 MB — stopping it. Save it, then start another.");
        stop();
      }
    };
    rec.onerror = () => {
      toast.error("Recording stopped unexpectedly. Whatever was captured is ready to review.");
      stop();
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!mounted.current) return;
      const blob = new Blob(parts.current, { type: rec.mimeType || mimeType || "audio/webm" });
      setTake({ blob, url: preview(blob) });
      setState("review");
    };
    starting.current = false;
    rec.start(1000);
    recorder.current = rec;
    setSeconds(0);
    setState("recording");
    startTimer();
  }

  function pause() {
    recorder.current?.pause();
    stopTimer();
    setState("paused");
  }
  function resume() {
    recorder.current?.resume();
    startTimer();
    setState("recording");
  }
  function stop() {
    stopTimer();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }
  function discard() {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setSeconds(0);
    setState("idle");
  }

  function attach(file: File | undefined) {
    if (!file) return;
    const audio = asAudio(file);
    if (!audio) {
      toast.error("That file isn't audio we can transcribe (m4a, mp3, wav, aac, webm).");
      return;
    }
    if (audio.size > MAX_BYTES) {
      toast.error("That file is over 25 MB — split it into shorter recordings.");
      return;
    }
    setSeconds(0);
    setTake({ blob: audio, url: preview(audio) });
    setState("review");
  }

  async function save() {
    if (!take) return;
    if (take.blob.size > MAX_BYTES) {
      toast.error("This take is over 25 MB — record shorter takes.");
      return;
    }
    if (await onSave(take.blob)) discard();
  }

  if (state === "review" && take) {
    return (
      <div className="space-y-3">
        <audio controls src={take.url} className="w-full" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Saving…" : "Save & add to brain"}
          </Button>
          <Button variant="outline" onClick={discard} disabled={busy}>
            <Trash2 className="mr-2 h-4 w-4" />
            Discard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "idle" ? (
        <>
          <Button onClick={start} disabled={busy} className="bg-terra-500 text-white hover:bg-terra-600">
            <Mic className="mr-2 h-4 w-4" />
            Start recording
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            Attach voice memo
          </Button>
          {extraActions}
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.aac,.mp4,.webm"
            className="hidden"
            onChange={(e) => {
              attach(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      ) : (
        <>
          <span className="flex items-center gap-2 font-mono text-lg tabular-nums text-charcoal-900">
            <span
              className={`h-2.5 w-2.5 rounded-full ${state === "recording" ? "animate-pulse bg-red-500" : "bg-charcoal-300"}`}
            />
            {formatClock(seconds)}
          </span>
          {state === "recording" ? (
            <Button variant="outline" onClick={pause}>
              <Pause className="mr-2 h-4 w-4" />
              Pause
            </Button>
          ) : (
            <Button variant="outline" onClick={resume}>
              <Play className="mr-2 h-4 w-4" />
              Resume
            </Button>
          )}
          <Button onClick={stop}>
            <Square className="mr-2 h-4 w-4" />
            Stop
          </Button>
          <p className="w-full text-xs text-charcoal-500">
            Keep this screen open while recording — on iPhone, locking the phone or switching apps pauses the microphone.
          </p>
        </>
      )}
    </div>
  );
}
