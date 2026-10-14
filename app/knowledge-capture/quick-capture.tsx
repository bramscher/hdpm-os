"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Inbox as InboxIcon, RotateCcw, Search, Tag, Trash2, User, Zap } from "lucide-react";
import { toast } from "sonner";
import { requestError, showError } from "./sign-in";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSupabaseClient } from "@/lib/supabase";
import type { LinkedRosterOwner } from "@/lib/knowledge-capture/links";
import type { RosterProperty, SubjectType } from "@/lib/knowledge-capture/roster";
import { suggestSubjects } from "@/lib/knowledge-capture/suggest";
import type { Voice } from "@/lib/knowledge-capture/voices";
import { Recorder, formatClock } from "./recorder";
import { VoicePicker, useTalking } from "./voice-picker";

const BUCKET = "knowledge-capture";

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/knowledge-capture${path}`, init);
  } catch {
    throw new Error("No signal — try again when you're back online.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw requestError(res, body);
  return body as T;
}

/**
 * Quick capture: record before picking an owner or property. The take uploads
 * and transcribes untagged (offline, it waits on the device like any take),
 * then waits in the Inbox for someone to tag it.
 */
export function QuickCapture({ voices, me, onUploaded }: { voices: Voice[]; me: string; onUploaded: () => void }) {
  const { talking, toggle } = useTalking(voices, me);
  const [saving, setSaving] = useState(false);

  /** Only when the device can't keep the take: upload straight away (needs signal). */
  async function saveDirect(audio: Blob): Promise<boolean> {
    setSaving(true);
    try {
      const mimeType = audio.type || "audio/webm";
      const { id, path, token } = await api<{ id: string; path: string; token: string }>("/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectType: null, mimeType, sizeBytes: audio.size, voices: talking }),
      });
      const { error } = await getSupabaseClient().storage.from(BUCKET).uploadToSignedUrl(path, token, audio, { contentType: mimeType.split(";")[0] });
      if (error) {
        await fetch(`/api/knowledge-capture/recordings/${id}`, { method: "DELETE" }).catch(() => undefined);
        throw new Error(`Upload failed: ${error.message}`);
      }
      toast.info("Saved. Transcribing — tag it in the Inbox.");
      void api(`/recordings/${id}/transcribe`, { method: "POST" })
        .catch(() => undefined)
        .finally(onUploaded);
      onUploaded();
      return true;
    } catch (err) {
      showError(err, "Could not save the recording");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-terra-200 bg-white p-4">
      <h2 className="flex items-center gap-2 font-semibold text-charcoal-900">
        <Zap className="h-4 w-4 text-terra-500" />
        Quick capture
      </h2>
      <p className="mb-3 text-sm text-charcoal-500">
        Record now, pick the owner or property later. Say who or where it&apos;s about as you start — it makes tagging easy.
      </p>
      <VoicePicker voices={voices} talking={talking} onToggle={toggle} />
      <Recorder
        takeMeta={() => ({ subjectType: null, subjectId: null, subjectName: null, voices: talking })}
        onSaveDirect={saveDirect}
        busy={saving}
      />
    </section>
  );
}

interface InboxTake {
  id: string;
  speaker: string;
  voices: string[];
  mine: boolean;
  durationSec: number | null;
  status: "uploading" | "transcribing" | "ready" | "error";
  error: string | null;
  transcript: string | null;
  createdAt: string;
  audioUrl: string | null;
}

const STATUS: Record<InboxTake["status"], { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  uploading: { label: "Uploading…", tone: "info" },
  transcribing: { label: "Transcribing…", tone: "info" },
  ready: { label: "Ready to tag", tone: "warning" },
  error: { label: "Needs a look", tone: "danger" },
};

/**
 * Inbox: quick-capture takes waiting for an owner or property. Tagging files
 * the take under that subject and opens it there for transcript review and
 * Add to brain. Hidden when empty.
 */
export function Inbox({
  owners,
  properties,
  version,
  onTagged,
}: {
  owners: LinkedRosterOwner[];
  properties: RosterProperty[];
  /** Bumped when a take finishes uploading, to reload. */
  version: number;
  onTagged: (s: { type: SubjectType; id: string }) => void;
}) {
  const [takes, setTakes] = useState<InboxTake[] | null>(null);

  const load = useCallback(async () => {
    try {
      setTakes((await api<{ takes: InboxTake[] }>("/inbox")).takes);
    } catch {
      // Offline or not set up yet: keep what we had.
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, version]);

  const working = takes?.some((t) => t.status === "uploading" || t.status === "transcribing");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [working, load]);

  if (!takes?.length) return null;
  return (
    <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="flex items-center gap-2 font-semibold text-charcoal-900">
        <InboxIcon className="h-4 w-4" />
        Inbox — quick captures to tag ({takes.length})
      </h2>
      <p className="mb-3 text-sm text-charcoal-600">
        Pick the owner or property each one is about. It then waits on that page for you to check the transcript and add it to the brain.
      </p>
      <ul className="space-y-3">
        {takes.map((t) => (
          <InboxRow key={t.id} take={t} owners={owners} properties={properties} onChanged={load} onTagged={onTagged} />
        ))}
      </ul>
    </section>
  );
}

function InboxRow({
  take: t,
  owners,
  properties,
  onChanged,
  onTagged,
}: {
  take: InboxTake;
  owners: LinkedRosterOwner[];
  properties: RosterProperty[];
  onChanged: () => void;
  onTagged: (s: { type: SubjectType; id: string }) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fullText, setFullText] = useState(false);
  const status = STATUS[t.status];
  const suggestions = useMemo(
    () => (t.mine && t.status === "ready" ? suggestSubjects(t.transcript, owners, properties) : []),
    [t.mine, t.status, t.transcript, owners, properties]
  );
  const excerpt = t.transcript && !fullText && t.transcript.length > 280 ? `${t.transcript.slice(0, 280)}…` : t.transcript;

  async function tag(type: SubjectType, id: string, name: string) {
    setBusy(true);
    try {
      await api(`/recordings/${t.id}/tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectType: type, subjectId: id }),
      });
      toast.success(`Filed under ${name}. Check the transcript there, then Add to brain.`);
      onTagged({ type, id });
      onChanged();
    } catch (err) {
      showError(err, "Could not tag this take");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      await api(`/recordings/${t.id}/transcribe`, { method: "POST" });
      toast.success("Transcribed.");
    } catch (err) {
      showError(err, "Transcription failed");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  async function remove() {
    if (!window.confirm(`Delete this quick capture from ${formatWhen(t.createdAt)}? The audio and transcript are gone for good.`)) return;
    try {
      await api(`/recordings/${t.id}`, { method: "DELETE" });
      toast.success("Deleted.");
    } catch (err) {
      showError(err, "Delete failed");
    }
    onChanged();
  }

  return (
    <li className="rounded-md border border-sand-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium text-charcoal-900">{t.speaker}</span>
          <span className="text-charcoal-500">
            {" "}
            · {formatWhen(t.createdAt)}
            {t.durationSec != null && ` · ${formatClock(t.durationSec)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} variant="soft">
            {status.label}
          </Badge>
          {t.mine && t.status !== "uploading" && (
            <Button size="sm" onClick={() => setPicking((p) => !p)} disabled={busy}>
              <Tag className="mr-1.5 h-4 w-4" />
              Tag
            </Button>
          )}
          {t.mine && t.status === "error" && (
            <Button variant="outline" size="sm" onClick={retry} disabled={busy}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Retry
            </Button>
          )}
          {t.mine && t.status !== "transcribing" && (
            <Button variant="ghost" size="sm" onClick={remove} disabled={busy} aria-label="Delete quick capture">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {t.error && <p className="mt-1 text-sm text-red-700">{t.error}</p>}
      {t.audioUrl && <audio controls preload="none" src={t.audioUrl} className="mt-2 w-full" />}
      {excerpt && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-charcoal-700">
          {excerpt}
          {t.transcript!.length > 280 && (
            <button onClick={() => setFullText((f) => !f)} className="ml-1 text-xs font-medium text-terra-700">
              {fullText ? "Show less" : "Show all"}
            </button>
          )}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-charcoal-500">Sounds like:</span>
          {suggestions.map((m) => (
            <button
              key={`${m.type}:${m.id}`}
              disabled={busy}
              onClick={() => tag(m.type, m.id, m.name)}
              title={`Heard "${m.heard.join(" ")}". Tap to file it here.`}
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-terra-200 bg-terra-50 px-2.5 py-1 text-xs font-medium text-terra-800 hover:bg-terra-100 disabled:opacity-50"
            >
              {m.type === "owner" ? <User className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
              {m.name}
            </button>
          ))}
          {!picking && (
            <button onClick={() => setPicking(true)} className="text-xs font-medium text-charcoal-500 underline">
              Someone else
            </button>
          )}
        </div>
      )}
      {picking && <SubjectSearch owners={owners} properties={properties} disabled={busy} onPick={tag} />}
    </li>
  );
}

/** Search owners and properties together; pick one to file the take under. */
function SubjectSearch({
  owners,
  properties,
  disabled,
  onPick,
}: {
  owners: LinkedRosterOwner[];
  properties: RosterProperty[];
  disabled: boolean;
  onPick: (type: SubjectType, id: string, name: string) => void;
}) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const list = [
      ...owners.map((o) => ({ type: "owner" as const, id: o.id, name: o.name, sub: o.properties.map((p) => p.name).join(", ") })),
      ...properties.map((p) => ({ type: "property" as const, id: p.id, name: p.name, sub: p.address || p.owners.map((o) => o.name).join(" & ") })),
    ];
    return list.filter((r) => r.name.toLowerCase().includes(needle) || r.sub.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, owners, properties]);

  return (
    <div className="mt-3 rounded-md bg-sand-50 p-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-charcoal-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search owners or properties"
          className="w-full rounded-md border border-sand-300 py-2 pl-8 pr-3 text-base focus:border-terra-400 focus:outline-none sm:text-sm"
        />
      </div>
      {!owners.length && <p className="mt-2 text-xs text-charcoal-500">The owner and property list hasn&apos;t loaded — needs signal.</p>}
      {q.trim().length >= 2 && !matches.length && <p className="mt-2 text-xs text-charcoal-500">Nothing matches.</p>}
      <ul className="mt-1">
        {matches.map((m) => (
          <li key={`${m.type}:${m.id}`}>
            <button
              disabled={disabled}
              onClick={() => onPick(m.type, m.id, m.name)}
              className="flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-white disabled:opacity-50"
            >
              {m.type === "owner" ? <User className="mt-0.5 h-4 w-4 shrink-0 text-charcoal-400" /> : <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-charcoal-400" />}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-charcoal-900">{m.name}</span>
                {m.sub && <span className="block truncate text-xs text-charcoal-500">{m.sub}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
