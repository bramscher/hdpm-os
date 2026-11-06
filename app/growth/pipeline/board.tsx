"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { BarChart3, CalendarClock, ExternalLink, Home, User, X } from "lucide-react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/growth/config";
import { SOURCE_LABELS, type BoardLead, type BoardResponse, type LeadDetailResponse, type LeadPatch, type LeadPatchResponse, type Person } from "@/lib/growth/lead-api";
import { buildColumns, canMove, daysInStage, detailProperty, filterLeads, filterOptions, replaceLead, sourceLabel, type BoardColumn, type BoardFilters } from "@/lib/growth/board";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/growth/leads/${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const patchLead = (id: number, body: LeadPatch) =>
  call<LeadPatchResponse>(String(id), { method: "PATCH", body: JSON.stringify(body) });

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
const isOverdue = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const SELECT = "h-9 rounded-md border border-sand-300 bg-white px-2 text-sm";

export function PipelineBoard({ websiteUrl }: { websiteUrl: string }) {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<BoardLead | null>(null);
  const [moving, setMoving] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call<BoardResponse>("board"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the pipeline");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const options = useMemo(() => filterOptions(leads), [leads]);
  const columns = useMemo(() => buildColumns(filterLeads(leads, filters)), [leads, filters]);

  const putLead = (lead: BoardLead) => setData((d) => (d ? { ...d, leads: replaceLead(d.leads, lead) } : d));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  function onDragStart(e: DragStartEvent) {
    setDragging(leads.find((l) => l.id === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const lead = leads.find((l) => l.id === e.active.id);
    const to = e.over?.id ? String(e.over.id) : null;
    if (!lead || !to || to === lead.status) return;
    if (!canMove(lead, to)) {
      toast.error(`Can't move a lead from ${STAGE_LABELS[lead.status] ?? lead.status} to ${STAGE_LABELS[to] ?? to}.`);
      return;
    }
    // Move the card right away; put it back if the website refuses.
    putLead({ ...lead, status: to, statusEnteredAt: new Date().toISOString(), allowedStatuses: [] });
    setMoving(lead.id);
    try {
      const res = await patchLead(lead.id, { status: to });
      putLead(res.lead);
      toast.success(`${res.lead.name} moved to ${STAGE_LABELS[to] ?? to}`);
    } catch (err) {
      putLead(lead);
      toast.error(err instanceof Error ? err.message : "Could not move the lead");
    } finally {
      setMoving(null);
    }
  }

  const totalDoors = columns.filter((c) => c.key !== "lost").reduce((s, c) => s + c.doors, 0);

  return (
    <PageContainer width="full" className="max-w-[1800px] mx-auto">
      <PageHeader
        title="Owner pipeline"
        description="Owner leads from the website CRM. Drag a card to change its stage; the website checks every move."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/growth"><BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Growth dashboard</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`${websiteUrl}/admin/crm`} target="_blank" rel="noreferrer">
                Website CRM <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select aria-label="Source" className={SELECT} value={filters.source ?? ""} onChange={(e) => setFilters({ ...filters, source: e.target.value || undefined })}>
          <option value="">All sources</option>
          {options.sources.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
        </select>
        <select aria-label="Assignee" className={SELECT} value={filters.assignee ?? ""} onChange={(e) => setFilters({ ...filters, assignee: e.target.value || undefined })}>
          <option value="">Everyone</option>
          <option value="unassigned">Unassigned</option>
          {options.assignees.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
        </select>
        <select aria-label="Town" className={SELECT} value={filters.town ?? ""} onChange={(e) => setFilters({ ...filters, town: e.target.value || undefined })}>
          <option value="">All towns</option>
          {options.towns.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {data && (
          <span className="ml-auto text-sm text-charcoal-500">
            {columns.reduce((s, c) => s + c.count, 0)} leads · {totalDoors} expected doors open or signed
          </span>
        )}
      </div>
      {data?.truncated && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Showing the newest {data.leads.length} of {data.totalDocs} owner leads.
        </p>
      )}

      {error ? (
        <p role="alert" className="rounded-lg bg-sand-100 p-4 text-sm text-charcoal-700">
          {error} <button className="underline" onClick={load}>Try again</button>
        </p>
      ) : !data ? (
        <p className="text-sm text-charcoal-500">Loading…</p>
      ) : (
        <div className={`grid gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="flex gap-3 overflow-x-auto pb-3">
              {columns.map((col) => (
                <Column key={col.key} col={col} dragging={dragging} selected={selected} moving={moving} onOpen={setSelected} />
              ))}
            </div>
            <DragOverlay>{dragging ? <Card lead={dragging} overlay /> : null}</DragOverlay>
          </DndContext>
          {selected && (
            <LeadPanel
              key={selected}
              id={selected}
              users={data.users}
              websiteUrl={websiteUrl}
              onClose={() => setSelected(null)}
              onSaved={putLead}
            />
          )}
        </div>
      )}
    </PageContainer>
  );
}

function Column({ col, dragging, selected, moving, onOpen }: { col: BoardColumn; dragging: BoardLead | null; selected: number | null; moving: number | null; onOpen: (id: number) => void }) {
  const allowed = !dragging || dragging.status === col.key || canMove(dragging, col.key);
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <section
      ref={setNodeRef}
      aria-label={col.label}
      className={`flex min-w-[13rem] flex-1 flex-col rounded-xl border bg-sand-50 transition-colors ${
        isOver && allowed ? "border-terra-400 bg-terra-50" : dragging && !allowed ? "border-sand-200 opacity-50" : "border-sand-200"
      }`}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-sand-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-charcoal-800">{col.label}</h2>
        <span className="text-xs text-charcoal-500" title="Leads · expected doors">
          {col.count} · {col.doors} doors
        </span>
      </header>
      <div className="flex min-h-[8rem] flex-col gap-2 p-2">
        {col.leads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} selected={selected === lead.id} busy={moving === lead.id} onOpen={() => onOpen(lead.id)} />
        ))}
      </div>
    </section>
  );
}

function DraggableCard({ lead, selected, busy, onOpen }: { lead: BoardLead; selected: boolean; busy: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={onOpen} className={isDragging ? "opacity-30" : busy ? "opacity-60" : ""}>
      <Card lead={lead} selected={selected} />
    </div>
  );
}

function Card({ lead, selected, overlay }: { lead: BoardLead; selected?: boolean; overlay?: boolean }) {
  const days = daysInStage(lead);
  const closed = lead.status === "signed" || lead.status === "lost";
  return (
    <article
      className={`cursor-grab rounded-lg border bg-white p-2.5 text-left text-xs shadow-card ${selected ? "border-terra-400 ring-1 ring-terra-300" : "border-sand-200"} ${overlay ? "rotate-1 shadow-lg" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight text-charcoal-900">{lead.name}</span>
        <span className="shrink-0 rounded-full bg-sand-100 px-2 py-0.5 font-semibold text-charcoal-700" title="Expected doors">
          {lead.expectedDoors ?? "?"} <Home className="inline h-3 w-3 -mt-0.5" />
        </span>
      </div>
      {(lead.propertyAddress || lead.town) && (
        <p className="mt-1 truncate text-charcoal-600">{[lead.propertyAddress, lead.town].filter(Boolean).join(", ")}</p>
      )}
      <p className="mt-1 truncate text-charcoal-500">{sourceLabel(lead)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-charcoal-500">
        <span className={!closed && days >= 14 ? "font-medium text-amber-700" : ""}>{days}d in stage</span>
        {lead.nextFollowUpAt && (
          <span className={!closed && isOverdue(lead.nextFollowUpAt) ? "font-medium text-red-700" : ""}>
            <CalendarClock className="mr-0.5 inline h-3 w-3 -mt-0.5" />
            {shortDate(lead.nextFollowUpAt)}
          </span>
        )}
        <span className="ml-auto">
          <User className="mr-0.5 inline h-3 w-3 -mt-0.5" />
          {lead.assignedTo?.name ?? "Unassigned"}
        </span>
      </div>
    </article>
  );
}

function LeadPanel({ id, users, websiteUrl, onClose, onSaved }: { id: number; users: Person[]; websiteUrl: string; onClose: () => void; onSaved: (lead: BoardLead) => void }) {
  const [detail, setDetail] = useState<LeadDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [doors, setDoors] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await call<LeadDetailResponse>(String(id));
      setDetail(res);
      setDoors(res.lead.expectedDoors == null ? "" : String(res.lead.expectedDoors));
      setFollowUp(toLocalInput(res.lead.nextFollowUpAt));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load lead");
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function save(body: LeadPatch, message: string) {
    setSaving(true);
    try {
      const res = await patchLead(id, body);
      onSaved(res.lead);
      toast.success(message);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update lead");
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    setSaving(true);
    try {
      await call(`${id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) });
      setNote("");
      toast.success("Note added");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setSaving(false);
    }
  }

  const lead = detail?.lead;
  return (
    <aside className="rounded-xl border border-sand-200 bg-white p-5 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-heading text-charcoal-900">{lead?.name ?? "Lead"}</h2>
          {lead && (
            <p className="mt-0.5 text-sm text-charcoal-500">
              {STAGE_LABELS[lead.status] ?? lead.status} for {daysInStage(lead)}d · {sourceLabel(lead)}
            </p>
          )}
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-charcoal-400 hover:bg-sand-100 hover:text-charcoal-700"><X className="h-4 w-4" /></button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-charcoal-700">{error}</p>
      ) : !lead ? (
        <p className="text-sm text-charcoal-500">Loading…</p>
      ) : (
        <div className="space-y-5 text-sm">
          {detailProperty(lead) && <p className="text-charcoal-700">{detailProperty(lead)}</p>}

          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-charcoal-500">Expected doors</span>
              <div className="flex gap-2">
                <input type="number" min={0} step={1} className="h-9 w-28 rounded-md border border-sand-300 px-2" value={doors} onChange={(e) => setDoors(e.target.value)} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving || doors === (lead.expectedDoors == null ? "" : String(lead.expectedDoors))}
                  onClick={() => save({ expectedDoors: doors.trim() === "" ? null : Number(doors) }, "Expected doors saved")}
                >
                  Save
                </Button>
              </div>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-charcoal-500">Assignee</span>
              <select
                className={SELECT}
                disabled={saving}
                value={lead.assignedTo?.id ?? ""}
                onChange={(e) => save({ assignedTo: e.target.value ? Number(e.target.value) : null }, "Assignee updated")}
              >
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-charcoal-500">Next follow-up</span>
              <div className="flex gap-2">
                <input type="datetime-local" className="h-9 rounded-md border border-sand-300 px-2" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving || followUp === toLocalInput(lead.nextFollowUpAt)}
                  onClick={() => save({ nextFollowUpAt: followUp ? new Date(followUp).toISOString() : null }, "Follow-up saved")}
                >
                  Save
                </Button>
              </div>
            </label>
          </div>

          {lead.notesSummary && <p className="whitespace-pre-wrap rounded-md bg-sand-50 p-3 text-charcoal-700">{lead.notesSummary}</p>}

          <div className="grid gap-2">
            <textarea className="min-h-[4.5rem] rounded-md border border-sand-300 p-2" placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" disabled={saving || !note.trim()} onClick={addNote} className="justify-self-start">Add note</Button>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">History</h3>
            {detail.activities.length ? (
              <ol className="space-y-2">
                {detail.activities.map((a) => (
                  <li key={a.id} className="border-l-2 border-sand-200 pl-3">
                    <p className="whitespace-pre-wrap text-charcoal-800">{a.body}</p>
                    <p className="text-xs text-charcoal-500">
                      {new Date(a.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {a.performedBy ? ` · ${a.performedBy}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-charcoal-500">No history yet.</p>
            )}
          </div>

          <a className="inline-flex items-center text-xs text-charcoal-500 underline" href={`${websiteUrl}/admin/collections/leads/${lead.id}`} target="_blank" rel="noreferrer">
            Open in the website CRM <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </div>
      )}
    </aside>
  );
}
