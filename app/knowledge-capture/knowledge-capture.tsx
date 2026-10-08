"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, ExternalLink, Pencil, RefreshCw, RotateCcw, Search, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import MarkdownLite from "@/components/eos/MarkdownLite";
import { getSupabaseClient } from "@/lib/supabase";
import { INTERVIEW_PROMPTS } from "@/lib/knowledge-capture/prompts";
import { coverageKey, type Coverage, type RosterProperty, type SubjectType } from "@/lib/knowledge-capture/roster";
import type { LinkSuggestion, LinkedRosterOwner } from "@/lib/knowledge-capture/links";
import { Recorder, formatClock } from "./recorder";
import { OwnerLinks } from "./owner-links";

const BUCKET = "knowledge-capture";

interface Overview {
  owners: LinkedRosterOwner[];
  properties: RosterProperty[];
  coverage: Record<string, Coverage>;
  suggestions: LinkSuggestion[];
  capturedAt: string;
  me: { email: string; name: string | null };
}

interface Recording {
  id: string;
  speaker: string;
  mine: boolean;
  durationSec: number | null;
  status: "uploaded" | "processing" | "done" | "error";
  error: string | null;
  transcript: string | null;
  originalTranscript: string | null;
  editedAt: string | null;
  editedBy: string | null;
  notes: string | null;
  chunkCount: number;
  createdAt: string;
  audioUrl: string | null;
}

interface Detail {
  profile: { markdown: string; recordingCount: number; generatedAt: string } | null;
  recordings: Recording[];
  canDeleteAny: boolean;
}

type Filter = "all" | "todo" | "done" | "dupes";
type Selected = { type: SubjectType; id: string } | null;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/knowledge-capture${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS: Record<Recording["status"], { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  uploaded: { label: "Uploaded", tone: "info" },
  processing: { label: "Processing…", tone: "warning" },
  done: { label: "In the brain", tone: "success" },
  error: { label: "Failed", tone: "danger" },
};

function readSelection(): Selected {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const owner = q.get("owner");
  const property = q.get("property");
  return owner ? { type: "owner", id: owner } : property ? { type: "property", id: property } : null;
}

export function KnowledgeCapture() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SubjectType>("owner");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      setData(await call<Overview>(refresh ? "?refresh=1" : ""));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load owners and properties");
    }
  }, []);

  useEffect(() => {
    const initial = readSelection();
    if (initial) {
      setSelected(initial);
      setTab(initial.type);
    }
    load();
  }, [load]);

  const select = useCallback((s: Selected) => {
    setSelected(s);
    if (s) setTab(s.type);
    const url = s ? `?${s.type}=${encodeURIComponent(s.id)}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, []);

  // Owners with an undecided duplicate/related suggestion.
  const flagged = useMemo(
    () => new Set((data?.suggestions ?? []).flatMap((s) => [s.a.id, s.b.id])),
    [data]
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const list: { id: string; name: string; sub: string }[] =
      tab === "owner"
        ? data.owners.map((o) => ({
            id: o.id,
            name: o.name,
            sub: `${o.properties.length} ${o.properties.length === 1 ? "property" : "properties"} · ${o.doors} doors`,
          }))
        : data.properties.map((p) => ({ id: p.id, name: p.name, sub: p.owners.map((o) => o.name).join(" & ") || "No owner on file" }));
    const q = query.trim().toLowerCase();
    return list.filter((r) => {
      if (filter === "dupes" && (tab !== "owner" || !flagged.has(r.id))) return false;
      const c = data.coverage[coverageKey(tab, r.id)];
      if (filter === "todo" && c?.recordings) return false;
      if (filter === "done" && !c?.recordings) return false;
      return !q || r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q);
    });
  }, [data, tab, filter, query, flagged]);

  const progress = (type: SubjectType) => {
    if (!data) return { done: 0, total: 0 };
    const ids = type === "owner" ? data.owners.map((o) => o.id) : data.properties.map((p) => p.id);
    return { done: ids.filter((id) => data.coverage[coverageKey(type, id)]?.recordings).length, total: ids.length };
  };

  return (
    <PageContainer width="full" className="mx-auto max-w-7xl">
      <PageHeader
        title="Knowledge Capture"
        description="Talk through what you know about each owner and property. Recordings are transcribed, added to the brain, and rolled up into a profile the team keeps."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await load(true);
              setRefreshing(false);
            }}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh from AppFolio
          </Button>
        }
      />

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {(["owner", "property"] as const).map((t) => {
          const p = progress(t);
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          return (
            <div key={t} className="rounded-lg border border-sand-200 bg-white p-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-charcoal-900">{t === "owner" ? "Owners" : "Properties"} captured</span>
                <span className="tabular-nums text-charcoal-600">
                  {p.done} of {p.total}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand-100">
                <div className="h-full rounded-full bg-terra-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="rounded-lg border border-sand-200 bg-white">
          <div className="flex border-b border-sand-200">
            {(["owner", "property"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2.5 text-sm font-medium ${tab === t ? "border-b-2 border-terra-500 text-charcoal-900" : "text-charcoal-500 hover:text-charcoal-800"}`}
              >
                {t === "owner" ? `Owners (${data?.owners.length ?? "…"})` : `Properties (${data?.properties.length ?? "…"})`}
              </button>
            ))}
          </div>
          <div className="space-y-2 border-b border-sand-200 p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-charcoal-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "owner" ? "Search owners or properties" : "Search properties or owners"}
                className="w-full rounded-md border border-sand-300 py-2 pl-8 pr-3 text-sm focus:border-terra-400 focus:outline-none"
              />
            </div>
            <div className="flex gap-1 text-xs">
              {(
                [
                  ["all", "All"],
                  ["todo", "Not captured yet"],
                  ["done", "Captured"],
                  ...(tab === "owner" && flagged.size ? ([["dupes", `Possible duplicates (${flagged.size})`]] as const) : []),
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded-full px-2.5 py-1 ${filter === k ? "bg-charcoal-800 text-white" : "bg-sand-100 text-charcoal-600 hover:bg-sand-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-[65vh] overflow-y-auto">
            {!data && !error && <li className="p-4 text-sm text-charcoal-500">Loading AppFolio owners and properties…</li>}
            {data && rows.length === 0 && <li className="p-4 text-sm text-charcoal-500">Nothing matches.</li>}
            {rows.map((r) => {
              const c = data?.coverage[coverageKey(tab, r.id)];
              const active = selected?.type === tab && selected.id === r.id;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => select({ type: tab, id: r.id })}
                    className={`flex w-full items-start justify-between gap-2 border-b border-sand-100 px-3 py-2.5 text-left ${active ? "bg-terra-50" : "hover:bg-sand-50"}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-charcoal-900">{r.name}</span>
                      <span className="block truncate text-xs text-charcoal-500">{r.sub}</span>
                    </span>
                    {tab === "owner" && flagged.has(r.id) && (
                      <Badge tone="warning" variant="soft" className="shrink-0">
                        Check
                      </Badge>
                    )}
                    {c?.recordings ? (
                      <Badge tone="success" variant="soft" className="shrink-0">
                        {c.recordings} {c.recordings === 1 ? "take" : "takes"}
                      </Badge>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="min-w-0">
          {selected && data ? (
            <SubjectPanel
              key={`${selected.type}:${selected.id}`}
              selected={selected}
              data={data}
              onSelect={select}
              onChanged={() => load()}
            />
          ) : (
            <EmptyState
              icon={tab === "owner" ? User : Building2}
              title={`Pick ${tab === "owner" ? "an owner" : "a property"}`}
              hint="Choose someone or somewhere from the list, then record what you know. Start with the ones only you know about."
            />
          )}
        </main>
      </div>
    </PageContainer>
  );
}

function SubjectPanel({
  selected,
  data,
  onSelect,
  onChanged,
}: {
  selected: { type: SubjectType; id: string };
  data: Overview;
  onSelect: (s: Selected) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [showPrompts, setShowPrompts] = useState(true);

  const owner = selected.type === "owner" ? data.owners.find((o) => o.id === selected.id) : undefined;
  // A link to a record that has since merged lands on the profile it merged into.
  const mergedInto =
    selected.type === "owner" && !owner ? data.owners.find((o) => o.aliases.some((a) => a.id === selected.id)) : undefined;
  useEffect(() => {
    if (mergedInto) onSelect({ type: "owner", id: mergedInto.id });
  }, [mergedInto, onSelect]);
  const property = selected.type === "property" ? data.properties.find((p) => p.id === selected.id) : undefined;
  const name = owner?.name ?? property?.name ?? "Unknown";
  const path = `/subjects/${selected.type}/${encodeURIComponent(selected.id)}`;

  const loadDetail = useCallback(async () => {
    try {
      setDetail(await call<Detail>(path));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load this profile");
    }
  }, [path]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  async function process(id: string) {
    setDetail((d) => d && { ...d, recordings: d.recordings.map((r) => (r.id === id ? { ...r, status: "processing" } : r)) });
    try {
      await call(`/recordings/${id}/process`, { method: "POST" });
      toast.success(`Transcribed and added to ${name}'s profile.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
    }
    await loadDetail();
    onChanged();
  }

  async function save(audio: Blob): Promise<boolean> {
    setSaving(true);
    try {
      const mimeType = audio.type || "audio/webm";
      const { id, path: storagePath, token } = await call<{ id: string; path: string; token: string }>("/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectType: selected.type, subjectId: selected.id, mimeType, sizeBytes: audio.size }),
      });
      const { error } = await getSupabaseClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(storagePath, token, audio, { contentType: mimeType.split(";")[0] });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      toast.info("Saved. Transcribing — this takes a minute or two for a long take.");
      setSaving(false);
      // Processing runs on; the take is safely stored, so the recorder can reset.
      void process(id);
      await loadDetail();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the recording");
      setSaving(false);
      return false;
    }
  }

  async function remove(r: Recording) {
    if (!window.confirm(`Delete this recording from ${formatDate(r.createdAt)}? Its transcript also leaves the brain.`)) return;
    try {
      const res = await call<{ warning?: string }>(`/recordings/${r.id}`, { method: "DELETE" });
      if (res.warning) toast.warning(res.warning);
      else toast.success("Recording deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
    await loadDetail();
    onChanged();
  }

  async function saveTranscript(r: Recording, transcript: string): Promise<boolean> {
    setDetail((d) => d && { ...d, recordings: d.recordings.map((x) => (x.id === r.id ? { ...x, transcript, status: "processing" } : x)) });
    let ok = true;
    try {
      const res = await call<{ unchanged?: boolean }>(`/recordings/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      toast.success(res.unchanged ? "No changes to save." : "Transcript saved — notes, brain and profile rebuilt.");
    } catch (err) {
      ok = false;
      toast.error(err instanceof Error ? err.message : "Could not save the transcript");
    }
    await loadDetail();
    onChanged();
    return ok;
  }

  async function rebuild() {
    setRebuilding(true);
    try {
      await call(path, { method: "POST" });
      toast.success("Profile rebuilt.");
      await loadDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rebuild failed");
    }
    setRebuilding(false);
  }

  const processing = detail?.recordings.some((r) => r.status === "processing");

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-sand-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
              {selected.type === "owner" ? "Owner" : "Property"}
            </p>
            <h2 className="text-xl font-semibold text-charcoal-900">{name}</h2>
            {property?.address && <p className="text-sm text-charcoal-500">{property.address} · {property.doors} doors</p>}
            {owner && (owner.email || owner.phone) && (
              <p className="text-sm text-charcoal-500">{[owner.email, owner.phone].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          {property?.appfolioWebId && (
            <a
              href={`https://highdesertpm.appfolio.com/properties/${property.appfolioWebId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              AppFolio <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(owner?.properties ?? []).map((p) => (
            <button key={p.id} onClick={() => onSelect({ type: "property", id: p.id })} className="rounded-full bg-sand-100 px-2.5 py-1 text-xs text-charcoal-700 hover:bg-sand-200">
              <Building2 className="mr-1 inline h-3 w-3" />
              {p.name}
            </button>
          ))}
          {(property?.owners ?? []).map((o) => (
            <button key={o.id} onClick={() => onSelect({ type: "owner", id: o.id })} className="rounded-full bg-sand-100 px-2.5 py-1 text-xs text-charcoal-700 hover:bg-sand-200">
              <User className="mr-1 inline h-3 w-3" />
              {o.name}
            </button>
          ))}
        </div>
      </section>

      {owner && (
        <OwnerLinks
          owner={owner}
          owners={data.owners}
          suggestions={data.suggestions}
          onSelect={(id) => onSelect({ type: "owner", id })}
          onChanged={async () => {
            await onChanged();
            await loadDetail();
          }}
        />
      )}

      <section className="rounded-lg border border-sand-200 bg-white p-5">
        <h3 className="mb-1 font-semibold text-charcoal-900">Record what you know</h3>
        <p className="mb-4 text-sm text-charcoal-500">
          Talk naturally — stories, quirks, names, numbers. Several short takes are fine. Use the prompts below if you get stuck.
        </p>
        <Recorder onSave={save} busy={saving} />
        <button onClick={() => setShowPrompts((s) => !s)} className="mt-4 flex items-center gap-1 text-sm font-medium text-charcoal-700">
          {showPrompts ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Prompts
        </button>
        {showPrompts && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {INTERVIEW_PROMPTS[selected.type].map((g) => (
              <div key={g.topic} className="rounded-md bg-sand-50 p-3">
                <p className="text-sm font-medium text-charcoal-800">{g.topic}</p>
                <ul className="mt-1 space-y-1">
                  {g.questions.map((q) => (
                    <li key={q} className="text-sm leading-snug text-charcoal-600">
                      • {q}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-sand-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-charcoal-900">Profile</h3>
            {detail?.profile && (
              <p className="text-xs text-charcoal-500">
                Built from {detail.profile.recordingCount} {detail.profile.recordingCount === 1 ? "recording" : "recordings"} · updated{" "}
                {formatDate(detail.profile.generatedAt)}
              </p>
            )}
          </div>
          {detail?.profile && (
            <Button variant="outline" size="sm" onClick={rebuild} disabled={rebuilding || processing}>
              <RotateCcw className={`mr-2 h-4 w-4 ${rebuilding ? "animate-spin" : ""}`} />
              {rebuilding ? "Rebuilding…" : "Rebuild profile"}
            </Button>
          )}
        </div>
        {!detail ? (
          <p className="text-sm text-charcoal-500">Loading…</p>
        ) : detail.profile ? (
          <MarkdownLite md={detail.profile.markdown} className="text-sm text-charcoal-700" />
        ) : (
          <p className="text-sm text-charcoal-500">
            {processing ? "Building the first profile from your recording…" : "No profile yet — it builds itself from the first recording."}
          </p>
        )}
      </section>

      {detail && detail.recordings.length > 0 && (
        <section className="rounded-lg border border-sand-200 bg-white p-5">
          <h3 className="mb-3 font-semibold text-charcoal-900">Recordings</h3>
          <ul className="space-y-4">
            {detail.recordings.map((r) => (
              <RecordingRow
                key={r.id}
                r={r}
                canDelete={r.mine || detail.canDeleteAny}
                onRetry={() => process(r.id)}
                onSaveTranscript={(t) => saveTranscript(r, t)}
                onDelete={() => remove(r)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RecordingRow({
  r,
  canDelete,
  onRetry,
  onDelete,
  onSaveTranscript,
}: {
  r: Recording;
  canDelete: boolean;
  onRetry: () => void;
  onDelete: () => void;
  onSaveTranscript: (transcript: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState<"notes" | "transcript" | "original" | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const status = STATUS[r.status];
  const editing = draft !== null;
  // Edits share the delete permission: your own takes, or any take as an admin.
  const canEdit = canDelete && !!r.transcript && r.status !== "processing";

  async function save() {
    if (draft === null) return;
    setSaving(true);
    if (await onSaveTranscript(draft)) setDraft(null);
    setSaving(false);
  }

  return (
    <li className="rounded-md border border-sand-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium text-charcoal-900">{r.speaker}</span>
          <span className="text-charcoal-500">
            {" "}
            · {formatDate(r.createdAt)}
            {r.durationSec != null && ` · ${formatClock(r.durationSec)}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone} variant="soft">
            {status.label}
          </Badge>
          {(r.status === "error" || r.status === "uploaded") && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
          {canEdit && !editing && (
            <Button variant="ghost" size="sm" onClick={() => setDraft(r.transcript ?? "")} aria-label="Edit transcript">
              <Pencil className="mr-1.5 h-4 w-4" />
              Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete recording">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {r.error && <p className="mt-2 text-sm text-red-700">{r.error}</p>}
      {r.audioUrl && <audio controls preload="none" src={r.audioUrl} className="mt-2 w-full" />}

      {editing ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-charcoal-500">
            Fix misheard names, numbers and places, or add something you forgot. Saving rebuilds this take&apos;s notes, its
            brain entries and the profile. The original transcript is kept.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            autoFocus
            className="w-full rounded-md border border-sand-300 p-3 text-sm leading-relaxed text-charcoal-800 focus:border-terra-400 focus:outline-none"
          />
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !draft.trim()}>
              {saving ? "Saving & rebuilding…" : "Save & rebuild"}
            </Button>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {r.notes && (
              <button onClick={() => setOpen(open === "notes" ? null : "notes")} className="font-medium text-blue-600 hover:underline">
                {open === "notes" ? "Hide notes" : "Notes"}
              </button>
            )}
            {r.transcript && (
              <button onClick={() => setOpen(open === "transcript" ? null : "transcript")} className="font-medium text-blue-600 hover:underline">
                {open === "transcript" ? "Hide transcript" : "Transcript"}
              </button>
            )}
            {r.editedAt && (
              <span className="text-charcoal-500">
                Edited by {r.editedBy ?? "someone"} · {formatDate(r.editedAt)}
                {r.originalTranscript && (
                  <>
                    {" · "}
                    <button onClick={() => setOpen(open === "original" ? null : "original")} className="text-blue-600 hover:underline">
                      {open === "original" ? "Hide original" : "Show original"}
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
          {open === "notes" && r.notes && <MarkdownLite md={r.notes} className="mt-2 text-sm text-charcoal-700" />}
          {open === "transcript" && r.transcript && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-charcoal-600">{r.transcript}</p>
          )}
          {open === "original" && r.originalTranscript && (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-sand-50 p-3 text-sm leading-relaxed text-charcoal-500">
              {r.originalTranscript}
            </p>
          )}
        </>
      )}
    </li>
  );
}
