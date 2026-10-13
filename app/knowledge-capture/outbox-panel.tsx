"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudOff, Download, Play, RotateCcw, Smartphone, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  discardTake,
  isLive,
  isWorking,
  listTakes,
  loadAudio,
  queueTake,
  retryTake,
  subscribe,
  syncOutbox,
  type Take,
} from "@/lib/knowledge-capture/outbox";
import { formatClock } from "./recorder";
import { useOnline } from "./use-online";

// ── Offline app (service worker) ─────────────────────────────────────────

/**
 * Register the offline worker (public/kc-sw.js) so this page opens with no
 * signal. Production only: in dev it would serve stale code over hot reload.
 */
export function useOfflineApp() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/kc-sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Files this page loaded before the worker took control.
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.includes("/_next/static/"));
        reg.active?.postMessage({ type: "kc-cache", urls });
      })
      .catch((err) => console.error("[knowledge-capture] offline app setup failed:", err));
  }, []);
}

// ── The outbox ────────────────────────────────────────────────────────────

/** Takes kept on this device, refreshed whenever the outbox changes. */
function useTakes(): Take[] {
  const [takes, setTakes] = useState<Take[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listTakes()
        .then((t) => alive && setTakes(t))
        .catch(() => undefined);
    refresh();
    const off = subscribe(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return takes;
}

/** Upload whenever there may be signal: now, back online, app brought forward, every 30s. */
function useAutoSync(pending: boolean) {
  useEffect(() => {
    const kick = () => {
      if (document.visibilityState === "visible") void syncOutbox();
    };
    kick();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void syncOutbox();
    }, 30_000);
    return () => clearInterval(t);
  }, [pending]);
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function statusOf(t: Take, online: boolean): { label: string; tone: "success" | "warning" | "danger" | "info" } {
  if (t.state === "recording" || t.state === "review") return { label: "Not saved", tone: "warning" };
  if (isWorking(t.id)) return { label: t.state === "uploaded" ? "Transcribing…" : "Uploading…", tone: "info" };
  if (!online || t.problem?.kind === "offline") return { label: "Waiting for signal", tone: "info" };
  if (t.problem?.kind === "signin") return { label: "Sign in to upload", tone: "warning" };
  if (t.problem?.kind === "stuck") return { label: "Needs a look", tone: "danger" };
  if (t.problem?.kind === "retry") return { label: "Will retry", tone: "warning" };
  return { label: t.state === "uploaded" ? "Uploaded" : "Queued", tone: "info" };
}

/**
 * "On this device": takes recorded here that the server doesn't have yet —
 * waiting for signal, mid-upload, or never saved (the page closed mid-take).
 * Hidden when there's nothing waiting.
 */
export function OutboxPanel() {
  const online = useOnline();
  const all = useTakes();
  const takes = all.filter((t) => !isLive(t.id));
  const pending = takes.some((t) => t.state === "queued" || t.state === "uploaded");
  useAutoSync(pending);

  if (!takes.length) return null;
  const signin = takes.some((t) => t.problem?.kind === "signin");

  return (
    <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-charcoal-900">
            On this device ({takes.length})
          </h2>
          <p className="text-sm text-charcoal-600">
            {online
              ? "These upload by themselves. Keep the app open for a moment while they go."
              : "No signal. These are safe here and upload by themselves when you're back online."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {signin && (
            <Button size="sm" asChild>
              <a href="/login?callbackUrl=%2Fknowledge-capture">Sign in to upload</a>
            </Button>
          )}
          {pending && online && (
            <Button size="sm" variant="outline" onClick={() => void syncOutbox()}>
              <Upload className="mr-2 h-4 w-4" />
              Upload now
            </Button>
          )}
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {takes.map((t) => (
          <OutboxRow key={t.id} take={t} online={online} />
        ))}
      </ul>
    </section>
  );
}

function OutboxRow({ take: t, online }: { take: Take; online: boolean }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const status = statusOf(t, online);
  const unsaved = t.state === "recording" || t.state === "review";

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const play = useCallback(async () => {
    const blob = await loadAudio(t.id).catch(() => null);
    if (!blob) {
      toast.error("No audio was captured in this take.");
      return;
    }
    setAudioUrl(URL.createObjectURL(blob));
  }, [t.id]);

  async function save() {
    try {
      await queueTake(t.id);
      toast.info(online ? "Saved. Uploading…" : "Saved. It uploads when you're back online.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this take");
    }
  }

  async function discard() {
    if (!window.confirm(`Discard this take${t.subjectName ? ` about ${t.subjectName}` : ""}? It hasn't been uploaded, so it will be gone for good.`)) return;
    await discardTake(t.id).catch(() => toast.error("Could not discard this take"));
  }

  return (
    <li className="rounded-md border border-sand-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium text-charcoal-900">{t.subjectName ?? "Quick capture"}</span>
          <span className="text-charcoal-500">
            {" "}
            · {t.subjectType === "owner" ? "Owner" : t.subjectType === "property" ? "Property" : "Tag it once uploaded"} · {formatWhen(t.recordedAt)}
            {t.durationSec ? ` · ${formatClock(t.durationSec)}` : t.size ? ` · ${formatSize(t.size)}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} variant="soft">
            {status.label}
          </Badge>
          {!audioUrl && (
            <Button variant="ghost" size="sm" onClick={play} aria-label="Play">
              <Play className="h-4 w-4" />
            </Button>
          )}
          {unsaved && (
            <Button size="sm" onClick={save}>
              <Upload className="mr-1.5 h-4 w-4" />
              Save
            </Button>
          )}
          {t.problem?.kind === "stuck" && (
            <Button variant="outline" size="sm" onClick={() => void retryTake(t.id)}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Retry
            </Button>
          )}
          {(unsaved || t.problem?.kind === "stuck") && (
            <Button variant="ghost" size="sm" onClick={discard} aria-label="Discard take">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {unsaved && (
        <p className="mt-1 text-xs text-charcoal-500">
          The page closed before this take was saved. Play it to check, then Save or discard it.
        </p>
      )}
      {t.problem && t.problem.kind !== "offline" && online && <p className="mt-1 text-xs text-charcoal-600">{t.problem.message}</p>}
      {audioUrl && <audio controls autoPlay src={audioUrl} className="mt-2 w-full" />}
    </li>
  );
}

// ── Banners ───────────────────────────────────────────────────────────────

/** Shown with no signal: recording still works. */
export function OfflineBanner({ savedAt }: { savedAt: string | null }) {
  const online = useOnline();
  if (online && !savedAt) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md bg-sand-100 px-3 py-2 text-sm text-charcoal-700">
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {online ? "Can't reach the server." : "No signal."} You can still record — takes stay on this device and upload
        when you're back online.
        {savedAt && ` Owner and property list saved ${formatWhen(savedAt)}.`}
      </span>
    </div>
  );
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const HINT_KEY = "kc-install-hint-dismissed";

/**
 * On a phone browser, suggest adding Capture to the Home Screen: it then opens
 * without signal, and iPhone keeps its saved takes (Safari may clear a
 * website's storage after a week unused; Home Screen apps are exempt).
 */
export function InstallHint() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(HINT_KEY) === "1";
    } catch {
      // storage blocked: show the hint
    }
    const mobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent));
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent)));
    setShow(mobile && !standalone && !dismissed);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // fine: it shows again next time
    }
    setShow(false);
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-sand-200 bg-white px-3 py-2.5 text-sm text-charcoal-700">
      <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-terra-500" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-charcoal-900">Put Capture on your Home Screen</p>
        <p>
          It then opens and records with no signal, and uploads when you're back online.{" "}
          {ios ? (
            <>
              Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open it from there once while you have
              signal and sign in.
            </>
          ) : prompt ? null : (
            <>Use the browser menu → <strong>Install app</strong> or <strong>Add to Home screen</strong>.</>
          )}
        </p>
        {prompt && (
          <Button
            size="sm"
            className="mt-2"
            onClick={async () => {
              await prompt.prompt().catch(() => undefined);
              dismiss();
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Install
          </Button>
        )}
      </div>
      <button onClick={dismiss} aria-label="Dismiss" className="text-charcoal-400 hover:text-charcoal-700">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
