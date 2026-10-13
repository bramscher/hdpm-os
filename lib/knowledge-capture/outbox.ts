/**
 * The on-device outbox for Knowledge Capture takes (browser only).
 *
 * Every take lives on the device (IndexedDB) until the server has it, so
 * recording works with no signal and nothing is lost if the page is closed,
 * reloaded or killed by the phone:
 *   - while recording, each second of audio is journaled (`chunks`), so even a
 *     crash keeps everything up to the last second;
 *   - Stop moves the audio into `audio` and the take waits for review;
 *   - Save queues it; syncOutbox() uploads queued takes whenever there is
 *     signal (page open, back online, app brought forward, every 30s) and
 *     starts transcription. Only then does the take leave the device.
 *
 * The take's id is the server row id, so an upload retried after signal drops
 * reuses the same row (POST /api/knowledge-capture/recordings).
 */
import { getSupabaseClient } from "@/lib/supabase";
import { failureKind, type FailureKind } from "./offline";
import type { SubjectType } from "./roster";

const BUCKET = "knowledge-capture";
const DB_NAME = "kc-outbox";
const DB_VERSION = 1;

export interface TakeMeta {
  subjectType: SubjectType;
  subjectId: string;
  subjectName: string;
  voices: string[];
}

export interface Take extends TakeMeta {
  id: string;
  mimeType: string;
  /** When recording started (or the memo was attached). */
  recordedAt: string;
  durationSec: number | null;
  size: number;
  /**
   * recording — being recorded, or was when the page died (journal only)
   * review    — stopped, waiting for Save or Discard
   * queued    — saved; waiting to upload
   * uploaded  — the server has the audio; transcription not yet confirmed
   */
  state: "recording" | "review" | "queued" | "uploaded";
  /** Why the last upload try didn't finish. `stuck` waits for a person. */
  problem: { kind: FailureKind | "offline"; message: string } | null;
  updatedAt: string;
}

export type OutboxEvent =
  | { type: "uploaded"; take: Take }
  | { type: "transcribed"; take: Take }
  | { type: "transcribe-failed"; take: Take; error: string };

type StoreName = "takes" | "audio" | "chunks";

// ── IndexedDB ────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("This browser can't keep recordings on the device"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("takes", { keyPath: "id" });
        db.createObjectStore("audio"); // id → { data: ArrayBuffer }
        db.createObjectStore("chunks"); // `${id}:${seq}` → { data: ArrayBuffer }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("Could not open on-device storage"));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/**
 * One transaction over `names`; resolves with `body`'s request result once it
 * commits. Retries once on a fresh connection: iPhone drops IndexedDB
 * connections when the app is backgrounded.
 */
async function withStores<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  body: (stores: Record<StoreName, IDBObjectStore>) => IDBRequest<T> | void,
  retry = true
): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(names, mode);
      const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)])) as Record<StoreName, IDBObjectStore>;
      const req = body(stores);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error ?? new Error("On-device storage failed"));
      t.onabort = () => reject(t.error ?? new Error("On-device storage write was cancelled"));
    });
  } catch (err) {
    if (!retry) throw err;
    dbPromise = null;
    return withStores(names, mode, body, false);
  }
}

const chunkRange = (id: string) => IDBKeyRange.bound(`${id}:`, `${id}:￿`);
const chunkKey = (id: string, seq: number) => `${id}:${String(seq).padStart(6, "0")}`;

// ── Change notifications (this tab + other open tabs) ─────────────────────

const listeners = new Set<() => void>();
const eventListeners = new Set<(e: OutboxEvent) => void>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(DB_NAME);
    channel.onmessage = () => listeners.forEach((fn) => fn());
  }
  return channel;
}

function changed() {
  listeners.forEach((fn) => fn());
  getChannel()?.postMessage("changed");
}

/** Called whenever the outbox (or upload activity) changes. */
export function subscribe(fn: () => void): () => void {
  getChannel();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Upload/transcription milestones, for toasts and refreshing the page. */
export function onOutboxEvent(fn: (e: OutboxEvent) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
const emit = (e: OutboxEvent) => eventListeners.forEach((fn) => fn(e));

/** Takes this page is recording or reviewing right now (shown by the recorder, not the outbox). */
const live = new Set<string>();
export const isLive = (id: string) => live.has(id);
export function releaseLive(id: string) {
  live.delete(id);
  changed();
}

/** Takes with an upload or transcription request in flight from this tab. */
const working = new Set<string>();
export const isWorking = (id: string) => working.has(id);

// ── Takes ─────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

export async function listTakes(): Promise<Take[]> {
  const all = (await withStores<Take[]>(["takes"], "readonly", (s) => s.takes.getAll())) ?? [];
  return all.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

async function getTake(id: string): Promise<Take | undefined> {
  return withStores<Take>(["takes"], "readonly", (s) => s.takes.get(id));
}

async function patchTake(id: string, patch: Partial<Take>): Promise<Take | undefined> {
  const take = await getTake(id);
  if (!take) return undefined;
  const next = { ...take, ...patch, updatedAt: now() };
  await withStores(["takes"], "readwrite", (s) => s.takes.put(next));
  changed();
  return next;
}

/** Ask the browser not to clear our storage under pressure (best effort). */
function persistStorage() {
  void navigator.storage?.persist?.().catch(() => undefined);
}

/** Start journaling a new recording. Returns its id. */
export async function beginTake(meta: TakeMeta, mimeType: string): Promise<string> {
  persistStorage();
  const id = crypto.randomUUID();
  const take: Take = {
    ...meta,
    id,
    mimeType,
    recordedAt: now(),
    durationSec: null,
    size: 0,
    state: "recording",
    problem: null,
    updatedAt: now(),
  };
  await withStores(["takes"], "readwrite", (s) => s.takes.put(take));
  live.add(id);
  changed();
  return id;
}

/** Journal one slice of audio while recording. */
export async function appendChunk(id: string, seq: number, blob: Blob): Promise<void> {
  const data = await blob.arrayBuffer();
  await withStores(["chunks"], "readwrite", (s) => s.chunks.put({ data }, chunkKey(id, seq)));
}

/** Recording stopped: keep the whole take as one file, ready for review. */
export async function finishTake(id: string, audio: Blob, durationSec: number): Promise<void> {
  const data = await audio.arrayBuffer();
  const take = await getTake(id);
  if (!take) throw new Error("This take is no longer on the device");
  const next: Take = { ...take, state: "review", durationSec, size: audio.size, mimeType: audio.type || take.mimeType, updatedAt: now() };
  await withStores(["takes", "audio", "chunks"], "readwrite", (s) => {
    s.audio.put({ data }, id);
    s.chunks.delete(chunkRange(id));
    s.takes.put(next);
  });
  changed();
}

/** An attached voice memo, kept on the device for review like a recording. */
export async function addFile(meta: TakeMeta, audio: Blob): Promise<string> {
  persistStorage();
  const id = crypto.randomUUID();
  const data = await audio.arrayBuffer();
  const take: Take = {
    ...meta,
    id,
    mimeType: audio.type || "audio/mp4",
    recordedAt: now(),
    durationSec: null,
    size: audio.size,
    state: "review",
    problem: null,
    updatedAt: now(),
  };
  await withStores(["takes", "audio"], "readwrite", (s) => {
    s.audio.put({ data }, id);
    s.takes.put(take);
  });
  live.add(id);
  changed();
  return id;
}

/** The take's audio: the saved file, or the journal if recording was cut off. */
export async function loadAudio(id: string): Promise<Blob | null> {
  const take = await getTake(id);
  if (!take) return null;
  const saved = await withStores<{ data: ArrayBuffer }>(["audio"], "readonly", (s) => s.audio.get(id));
  if (saved) return new Blob([saved.data], { type: take.mimeType });
  const parts = (await withStores<{ data: ArrayBuffer }[]>(["chunks"], "readonly", (s) => s.chunks.getAll(chunkRange(id)))) ?? [];
  if (!parts.length) return null;
  return new Blob(
    parts.map((p) => p.data),
    { type: take.mimeType }
  );
}

/**
 * Save: queue the take to upload with who was talking. A take cut off
 * mid-recording is first rebuilt from its journal.
 */
export async function queueTake(id: string, voices?: string[]): Promise<Take> {
  const take = await getTake(id);
  if (!take) throw new Error("This take is no longer on the device");
  if (take.state === "recording") {
    const audio = await loadAudio(id);
    if (!audio) throw new Error("Nothing was recorded in this take");
    const data = await audio.arrayBuffer();
    await withStores(["audio", "chunks"], "readwrite", (s) => {
      s.audio.put({ data }, id);
      s.chunks.delete(chunkRange(id));
    });
    take.size = audio.size;
  }
  const next = { ...take, state: "queued" as const, problem: null, ...(voices ? { voices } : {}), updatedAt: now() };
  await withStores(["takes"], "readwrite", (s) => s.takes.put(next));
  live.delete(id);
  changed();
  void syncOutbox();
  return next;
}

/** Throw a take away for good. */
export async function discardTake(id: string): Promise<void> {
  await withStores(["takes", "audio", "chunks"], "readwrite", (s) => {
    s.takes.delete(id);
    s.audio.delete(id);
    s.chunks.delete(chunkRange(id));
  });
  live.delete(id);
  changed();
}

/** Retry a take a person was asked to look at (clears its problem). */
export async function retryTake(id: string): Promise<void> {
  await patchTake(id, { problem: null });
  void syncOutbox();
}

// ── Upload ────────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;

/** Upload everything queued. Safe to call any time; concurrent calls share one run. */
export function syncOutbox(): Promise<void> {
  if (!running) {
    running = withLock(runSync)
      .catch((err) => console.error("[knowledge-capture] outbox sync failed:", err))
      .finally(() => {
        running = null;
      });
  }
  return running;
}

/** Only one tab uploads at a time (Web Locks where available). */
async function withLock(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  await locks.request("kc-outbox", { ifAvailable: true }, async (lock) => {
    if (lock) await fn();
  });
}

async function runSync() {
  const pending = (await listTakes()).filter(
    (t) => (t.state === "queued" || t.state === "uploaded") && t.problem?.kind !== "stuck" && !working.has(t.id)
  );
  const transcribing: Promise<void>[] = [];
  for (const take of pending) {
    const result = take.state === "queued" ? await upload(take) : take;
    if (result === "stop") break; // no signal or signed out: the rest would fail too
    if (result === "next") continue;
    transcribing.push(transcribe(result));
  }
  await Promise.all(transcribing);
}

type ProblemKind = NonNullable<Take["problem"]>["kind"];

async function setProblem(take: Take, kind: ProblemKind, message: string) {
  await patchTake(take.id, { problem: { kind, message } });
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || `Request failed (${res.status})`;
}

/** Send one take's audio. Returns the uploaded take, or what the loop should do next. */
async function upload(take: Take): Promise<Take | "stop" | "next"> {
  working.add(take.id);
  changed();
  try {
    let res: Response;
    try {
      res = await fetch("/api/knowledge-capture/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: take.id,
          subjectType: take.subjectType,
          subjectId: take.subjectId,
          mimeType: take.mimeType,
          sizeBytes: take.size,
          voices: take.voices,
          recordedAt: take.recordedAt,
        }),
      });
    } catch {
      await setProblem(take, "offline", "Waiting for signal");
      return "stop";
    }
    if (!res.ok) {
      const kind = failureKind(res.status);
      await setProblem(take, kind, kind === "signin" ? "Sign in again to upload" : await readError(res));
      return kind === "stuck" ? "next" : "stop";
    }
    const target = (await res.json()) as { path?: string; token?: string; uploaded?: boolean };
    if (!target.uploaded) {
      const audio = await loadAudio(take.id);
      if (!audio) {
        await setProblem(take, "stuck", "The audio for this take is missing on this device");
        return "next";
      }
      const { error } = await getSupabaseClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(target.path!, target.token!, audio, { contentType: take.mimeType.split(";")[0], upsert: true });
      if (error) {
        await setProblem(take, "retry", `Upload interrupted — trying again shortly (${error.message})`);
        return "stop";
      }
    }
    const next = await patchTake(take.id, { state: "uploaded", problem: null });
    if (!next) return "next";
    emit({ type: "uploaded", take: next });
    return next;
  } finally {
    working.delete(take.id);
    changed();
  }
}

/**
 * Start transcription. Any answer from the server means it has the take (a
 * failure shows there with Retry), so the device copy can go; no answer means
 * try again later.
 */
async function transcribe(take: Take): Promise<void> {
  working.add(take.id);
  changed();
  try {
    let res: Response;
    try {
      res = await fetch(`/api/knowledge-capture/recordings/${take.id}/transcribe`, { method: "POST" });
    } catch {
      await setProblem(take, "offline", "Uploaded — waiting for signal to transcribe");
      return;
    }
    if (res.status === 401) {
      await setProblem(take, "signin", "Uploaded — sign in again to transcribe");
      return;
    }
    if (!res.ok && res.status !== 409 && res.status < 500) {
      await setProblem(take, "stuck", await readError(res));
      return;
    }
    const error = res.ok || res.status === 409 ? null : await readError(res);
    await discardTake(take.id);
    emit(error ? { type: "transcribe-failed", take, error } : { type: "transcribed", take });
  } finally {
    working.delete(take.id);
    changed();
  }
}
