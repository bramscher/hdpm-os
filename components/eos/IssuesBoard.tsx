'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronUp, ChevronDown, Bot, User, Plus, CheckCircle2 } from 'lucide-react';
import { parseSourceRef } from '@/lib/eos/escalation';
import type { Issue, Todo, ScorecardMetric, ScorecardEntry } from '@/lib/eos/types';
import { cn } from '@/lib/utils';

export interface EvidenceMap {
  metrics: Record<string, { metric: ScorecardMetric; entries: ScorecardEntry[] }>;
  workOrders: Record<
    string,
    {
      id: string;
      wo_number: string | null;
      property_name: string;
      unit_name: string | null;
      stage: string;
      vendor_name: string | null;
      appfolio_link: string | null;
    }
  >;
  todoChains: Record<string, Todo[]>;
}

interface Props {
  issues: Issue[];
  todos: Todo[];
  missedTodos: Todo[];
  staff: string[];
  evidence: EvidenceMap;
  today: string;
}

function ageDays(createdAt: string, today: string): number {
  const created = new Date(`${createdAt.slice(0, 10)}T12:00:00Z`);
  const now = new Date(`${today}T12:00:00Z`);
  return Math.max(0, Math.round((now.getTime() - created.getTime()) / 86_400_000));
}

function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function PriorityBadge({ priority }: { priority: number }) {
  const tone =
    priority <= 2
      ? 'bg-red-50 text-red-700 border-red-200'
      : priority === 3
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-gray-50 text-gray-500 border-gray-200';
  return (
    <span className={cn('inline-block w-6 rounded border text-center text-xs font-semibold', tone)}>
      {priority}
    </span>
  );
}

function RaisedByChip({ raisedBy }: { raisedBy: string }) {
  const isSystem = /^(agent|tripwire|system):/.test(raisedBy);
  const label = raisedBy.replace(/^(agent|system):/, '').replace(/^tripwire:/, 'tripwire #');
  const Icon = isSystem ? Bot : User;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
      <Icon size={12} aria-hidden />
      {label}
    </span>
  );
}

function Evidence({ issue, evidence }: { issue: Issue; evidence: EvidenceMap }) {
  const ref = parseSourceRef(issue.source_ref);
  if (ref.kind === 'scorecard_metric') {
    const ev = evidence.metrics[ref.id];
    if (!ev) return <p className="text-sm text-gray-400">Metric no longer active.</p>;
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-gray-900">{ev.metric.name}</p>
        <p className="text-gray-500">
          Goal {ev.metric.goal_op === 'gte' ? '≥' : '≤'} {ev.metric.goal_value}{' '}
          {ev.metric.unit ?? ''} · Owner: {ev.metric.owner_person ?? '—'}
        </p>
        <div className="flex gap-2">
          {ev.entries.map((e) => (
            <span
              key={e.week_start}
              className={cn(
                'rounded px-2 py-1 text-xs',
                e.on_track === true
                  ? 'bg-green-50 text-green-800'
                  : e.on_track === false
                    ? 'bg-red-50 text-red-700'
                    : 'bg-gray-50 text-gray-500'
              )}
            >
              {fmtDate(e.week_start)}: {e.value ?? '—'}
            </span>
          ))}
        </div>
        <Link href="/company/scorecard" className="text-xs text-blue-600 hover:underline">
          Open Scorecard →
        </Link>
      </div>
    );
  }
  if (ref.kind === 'wo_tripwire' || ref.kind === 'wo_escalation') {
    const wo = evidence.workOrders[ref.id];
    if (!wo) return <p className="text-sm text-gray-400">Work order not found.</p>;
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-gray-900">
          WO {wo.wo_number ?? '—'} · {wo.property_name}
          {wo.unit_name ? ` ${wo.unit_name}` : ''}
        </p>
        <p className="text-gray-500">
          Stage: {wo.stage}
          {wo.vendor_name ? ` · Vendor: ${wo.vendor_name}` : ''}
          {ref.kind === 'wo_tripwire' ? ` · Tripwire #${ref.tripwire}` : ' · Estimate escalation'}
        </p>
        <div className="flex gap-3 text-xs">
          <Link href={`/maintenance/board/wo/${wo.id}`} className="text-blue-600 hover:underline">
            Open on the board →
          </Link>
          {wo.appfolio_link ? (
            <a
              href={wo.appfolio_link}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              AppFolio →
            </a>
          ) : null}
        </div>
      </div>
    );
  }
  if (ref.kind === 'todo') {
    const chain = evidence.todoChains[ref.id];
    if (!chain?.length) return <p className="text-sm text-gray-400">To-do not found.</p>;
    return (
      <div className="space-y-1 text-sm">
        {chain.map((t) => (
          <p key={t.id} className="text-gray-600">
            <span className="font-medium text-gray-900">{t.title}</span> — {t.owner_person ?? '—'},
            due {fmtDate(t.due_on)},{' '}
            <span className={t.status === 'done' ? 'text-green-700' : 'text-red-600'}>{t.status}</span>
          </p>
        ))}
      </div>
    );
  }
  return (
    <p className="text-sm text-gray-400">
      {issue.source_ref ? `Ref: ${issue.source_ref}` : 'Filed manually — no linked evidence.'}
    </p>
  );
}

export default function IssuesBoard({ issues, todos, missedTodos, staff, evidence, today }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmSolve, setConfirmSolve] = useState<string | null>(null);
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [showParked, setShowParked] = useState(false);
  const [issueDraft, setIssueDraft] = useState({ title: '', detail: '', priority: 3 });
  const [todoDraft, setTodoDraft] = useState({ title: '', owner: '', dueOn: '' });

  const queue = issues.filter((i) => i.status === 'open' || i.status === 'discussed');
  const parked = issues.filter((i) => i.status === 'parked');
  const selected = issues.find((i) => i.id === selectedId) ?? null;

  async function api(path: string, method: string, body: unknown, busyKey: string) {
    setBusy(busyKey);
    setNote(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNote(data.error ?? `Request failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function patchIssue(id: string, patch: Record<string, unknown>) {
    return api(`/api/eos/issues/${id}`, 'PATCH', patch, id);
  }

  async function createIssue() {
    if (!issueDraft.title.trim()) return;
    const ok = await api(
      '/api/eos/issues',
      'POST',
      { title: issueDraft.title, detail: issueDraft.detail || undefined, priority: issueDraft.priority },
      'new-issue'
    );
    if (ok) {
      setIssueDraft({ title: '', detail: '', priority: 3 });
      setShowNewIssue(false);
    }
  }

  async function createTodo() {
    if (!todoDraft.title.trim()) return;
    const ok = await api(
      '/api/eos/todos',
      'POST',
      {
        title: todoDraft.title,
        ownerPerson: todoDraft.owner || undefined,
        dueOn: todoDraft.dueOn || undefined,
      },
      'new-todo'
    );
    if (ok) setTodoDraft({ title: '', owner: '', dueOn: '' });
  }

  function IssueRow({ issue }: { issue: Issue }) {
    const isSelected = issue.id === selectedId;
    return (
      <button
        type="button"
        onClick={() => {
          setSelectedId(isSelected ? null : issue.id);
          setConfirmSolve(null);
        }}
        className={cn(
          'flex w-full items-center gap-3 border-b border-gray-100 px-3 py-2.5 text-left transition-colors last:border-b-0',
          isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50'
        )}
      >
        <PriorityBadge priority={issue.priority} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
          {issue.title}
        </span>
        <RaisedByChip raisedBy={issue.raised_by} />
        <span className="whitespace-nowrap text-xs text-gray-400">
          {ageDays(issue.created_at, today)}d
        </span>
        {issue.status !== 'open' ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {issue.status}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div>
      {note ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {note}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── IDS queue ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Issues ({queue.length})
            </h2>
            <button
              type="button"
              onClick={() => setShowNewIssue((v) => !v)}
              className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 transition-colors hover:border-amber-400 hover:text-amber-700"
            >
              <Plus size={14} aria-hidden /> Issue
            </button>
          </div>

          {showNewIssue ? (
            <div className="mb-3 space-y-2 rounded-lg border border-gray-200 bg-white p-3">
              <input
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="What's the issue?"
                value={issueDraft.title}
                onChange={(e) => setIssueDraft((d) => ({ ...d, title: e.target.value }))}
              />
              <textarea
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="Detail / evidence (optional)"
                rows={2}
                value={issueDraft.detail}
                onChange={(e) => setIssueDraft((d) => ({ ...d, detail: e.target.value }))}
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">
                  Priority{' '}
                  <select
                    className="rounded border border-gray-300 px-1 py-0.5 text-sm"
                    value={issueDraft.priority}
                    onChange={(e) =>
                      setIssueDraft((d) => ({ ...d, priority: Number(e.target.value) }))
                    }
                  >
                    {[1, 2, 3, 4, 5].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void createIssue()}
                  disabled={busy === 'new-issue' || !issueDraft.title.trim()}
                  className="rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  File issue
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-white">
            {queue.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
            {queue.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-gray-400">
                Nothing on the list. Issues file themselves from tripwires, escalations and the
                scorecard — or use + Issue.
              </p>
            ) : null}
          </div>

          {parked.length > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowParked((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                {showParked ? '▾' : '▸'} Parked ({parked.length})
              </button>
              {showParked ? (
                <div className="mt-2 rounded-lg border border-gray-200 bg-white opacity-70">
                  {parked.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── To-dos ──────────────────────────────────────────────── */}
          <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">
            To-dos — next 7 days ({todos.length})
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white">
            {todos.map((t) => {
              const overdue = t.due_on < today;
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => void api(`/api/eos/todos/${t.id}`, 'PATCH', { status: 'done' }, t.id)}
                    disabled={busy === t.id}
                    title="Mark done"
                    className="text-gray-300 transition-colors hover:text-green-600 disabled:opacity-50"
                  >
                    <CheckCircle2 size={18} aria-hidden />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{t.title}</span>
                  <span className="text-xs text-gray-500">{t.owner_person ?? '—'}</span>
                  <span className={cn('text-xs', overdue ? 'font-semibold text-red-600' : 'text-gray-400')}>
                    {fmtDate(t.due_on)}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {t.source}
                  </span>
                </div>
              );
            })}
            {todos.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">No open to-dos this week.</p>
            ) : null}
            <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2">
              <input
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                placeholder="Add a to-do…"
                value={todoDraft.title}
                onChange={(e) => setTodoDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createTodo();
                }}
              />
              <select
                className="rounded border border-gray-300 px-1 py-1 text-xs text-gray-600"
                value={todoDraft.owner}
                onChange={(e) => setTodoDraft((d) => ({ ...d, owner: e.target.value }))}
              >
                <option value="">Me</option>
                {staff.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="rounded border border-gray-300 px-1 py-1 text-xs text-gray-600"
                value={todoDraft.dueOn}
                onChange={(e) => setTodoDraft((d) => ({ ...d, dueOn: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => void createTodo()}
                disabled={busy === 'new-todo' || !todoDraft.title.trim()}
                className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
          {missedTodos.length > 0 ? (
            <div className="mt-2 space-y-1">
              {missedTodos.map((t) => (
                <p key={t.id} className="text-xs text-gray-400 line-through">
                  {t.title} — {t.owner_person ?? '—'}, missed {fmtDate(t.due_on)}
                </p>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-xs text-gray-400">
            Missed to-dos roll forward once (owner gets one nudge), then file as issues.
          </p>
        </div>

        {/* ── Evidence / actions side panel ─────────────────────────── */}
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {selected ? 'Issue' : 'Evidence'}
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            {!selected ? (
              <p className="text-sm text-gray-400">Select an issue to see its evidence and actions.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">{selected.title}</p>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        title="Raise priority"
                        disabled={busy === selected.id || selected.priority <= 1}
                        onClick={() => void patchIssue(selected.id, { priority: selected.priority - 1 })}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      >
                        <ChevronUp size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Lower priority"
                        disabled={busy === selected.id || selected.priority >= 5}
                        onClick={() => void patchIssue(selected.id, { priority: selected.priority + 1 })}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      >
                        <ChevronDown size={16} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    <RaisedByChip raisedBy={selected.raised_by} /> · filed{' '}
                    {fmtDate(selected.created_at.slice(0, 10))} · priority {selected.priority} ·{' '}
                    {selected.status}
                  </p>
                </div>
                {selected.detail ? (
                  <p className="whitespace-pre-line text-sm text-gray-600">{selected.detail}</p>
                ) : null}
                <div className="border-t border-gray-100 pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Evidence
                  </p>
                  <Evidence issue={selected} evidence={evidence} />
                </div>
                <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                  {selected.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => void patchIssue(selected.id, { status: 'discussed' })}
                      disabled={busy === selected.id}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-gray-400"
                    >
                      Mark discussed
                    </button>
                  ) : null}
                  {selected.status !== 'parked' ? (
                    <button
                      type="button"
                      onClick={() => void patchIssue(selected.id, { status: 'parked' })}
                      disabled={busy === selected.id}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-gray-400"
                    >
                      Park
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void patchIssue(selected.id, { status: 'open' })}
                      disabled={busy === selected.id}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-gray-400"
                    >
                      Reopen
                    </button>
                  )}
                  {confirmSolve === selected.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        void patchIssue(selected.id, { status: 'solved', confirm: true }).then((ok) => {
                          if (ok) {
                            setSelectedId(null);
                            setConfirmSolve(null);
                          }
                        });
                      }}
                      disabled={busy === selected.id}
                      className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white"
                    >
                      Confirm solved
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmSolve(selected.id)}
                      disabled={busy === selected.id}
                      className="rounded border border-green-600 px-2 py-1 text-xs text-green-700 hover:bg-green-50"
                    >
                      Solve…
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
