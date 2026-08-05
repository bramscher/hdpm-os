'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { isConcluded, type AgendaStep } from '@/lib/eos/meeting';
import MarkdownLite from './MarkdownLite';
import SolveOutcomeForm from './SolveOutcomeForm';
import type { Meeting, ScorecardMetric, ScorecardEntry, Issue, Todo, Decision, Rock } from '@/lib/eos/types';
import { cn } from '@/lib/utils';

interface Props {
  meeting: Meeting;
  agenda: AgendaStep[];
  metrics: ScorecardMetric[];
  entries: ScorecardEntry[];
  currentWeek: string;
  prevWeek: string;
  issues: Issue[];
  lastWeekTodos: Todo[];
  meetingTodos: Todo[];
  decisions: Decision[];
  rocks: Rock[];
  idsItemCount: number;
  staff: string[];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

function fmtClock(totalSeconds: number): string {
  const over = totalSeconds < 0;
  const s = Math.abs(totalSeconds);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${over ? '-' : ''}${mm}:${ss}`;
}

function entryTone(onTrack: boolean | null): string {
  return onTrack === true
    ? 'bg-green-50 text-green-800'
    : onTrack === false
      ? 'bg-red-50 text-red-700 font-semibold'
      : 'text-charcoal-400';
}

export default function MeetingRunner(props: Props) {
  const { meeting, agenda, staff } = props;
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [stepStartedAt, setStepStartedAt] = useState<number>(() => Date.now());
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [solvingId, setSolvingId] = useState<string | null>(null);
  const [headlines, setHeadlines] = useState('');
  const [minutesDraft, setMinutesDraft] = useState('');
  const [rating, setRating] = useState(8);
  const [unconfirmed, setUnconfirmed] = useState<Set<string>>(new Set());

  const step = agenda[stepIndex];
  const concluded = isConcluded(meeting);

  useEffect(() => {
    if (concluded) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [concluded]);

  const secondsLeft = useMemo(
    () => (step ? step.minutes * 60 - Math.floor((nowTick - stepStartedAt) / 1000) : 0),
    [step, nowTick, stepStartedAt]
  );

  function goTo(i: number) {
    if (i < 0 || i >= agenda.length) return;
    // Entering Conclude: pre-draft minutes from what the meeting produced.
    if (agenda[i].kind === 'conclude' && !minutesDraft.trim()) {
      const lines: string[] = [`## ${meeting.kind} — ${fmtDate(meeting.starts_at)}`, ''];
      if (headlines.trim()) {
        lines.push('## Headlines', headlines.trim(), '');
      }
      if (props.decisions.length > 0) {
        lines.push('## Decisions');
        for (const d of props.decisions) lines.push(`- **${d.title}** — ${d.statement_md}`);
        lines.push('');
      }
      if (props.meetingTodos.length > 0) {
        lines.push('## To-dos handed out');
        for (const t of props.meetingTodos) {
          lines.push(`- ${t.title} (${t.owner_person ?? 'unassigned'}, due ${t.due_on})`);
        }
        lines.push('');
      }
      setMinutesDraft(lines.join('\n'));
    }
    setStepIndex(i);
    setStepStartedAt(Date.now());
  }

  async function api(path: string, method: string, body: unknown, busyKey: string): Promise<boolean> {
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

  async function conclude() {
    const todoIds = props.meetingTodos.map((t) => t.id).filter((id) => !unconfirmed.has(id));
    const ok = await api(
      `/api/eos/meetings/${meeting.id}/conclude`,
      'POST',
      { minutesMd: minutesDraft, rating, todoIds },
      'conclude'
    );
    if (ok) setNote('Meeting concluded — to-do cards sent, minutes filed to the brain.');
  }

  // ── Archive view ──────────────────────────────────────────────────────
  if (concluded) {
    return (
      <div>
        <Header meeting={meeting} />
        {meeting.prep_packet_md ? (
          <details className="mb-4 rounded-xl border border-sand-200 bg-white shadow-card p-4">
            <summary className="cursor-pointer text-sm font-semibold text-charcoal-700">
              Prep packet
            </summary>
            <MarkdownLite md={meeting.prep_packet_md} className="mt-2 text-sm text-charcoal-600" />
          </details>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-sand-200 bg-white shadow-card p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-500">
              Minutes {meeting.rating ? `· rated ${meeting.rating}/10` : ''}
            </h2>
            {meeting.minutes_md ? (
              <MarkdownLite md={meeting.minutes_md} />
            ) : (
              <p className="text-sm text-charcoal-400">No minutes recorded.</p>
            )}
          </div>
          <div className="rounded-xl border border-sand-200 bg-white shadow-card p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-500">
              Outcomes
            </h2>
            <p className="mb-2 text-xs text-charcoal-500">
              {props.idsItemCount} issue{props.idsItemCount === 1 ? '' : 's'} solved in IDS ·{' '}
              {props.decisions.length} decision{props.decisions.length === 1 ? '' : 's'}
            </p>
            {props.decisions.map((d) => (
              <div key={d.id} className="mb-2 border-l-2 border-green-200 pl-2">
                <p className="text-sm font-medium text-charcoal-900">{d.title}</p>
                <p className="text-xs text-charcoal-600">{d.statement_md}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Runner ────────────────────────────────────────────────────────────
  return (
    <div>
      <Header meeting={meeting} />
      {note ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {note}
        </div>
      ) : null}
      {meeting.prep_packet_md ? (
        <details className="mb-4 rounded-xl border border-sand-200 bg-white shadow-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-charcoal-700">
            Prep packet
          </summary>
          <MarkdownLite md={meeting.prep_packet_md} className="mt-2 text-sm text-charcoal-600" />
        </details>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Step rail */}
        <div>
          <ol className="rounded-xl border border-sand-200 bg-white shadow-card">
            {agenda.map((s, i) => (
              <li key={s.kind}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  className={cn(
                    'flex w-full items-center gap-2 border-b border-sand-100 px-3 py-2 text-left text-sm last:border-b-0',
                    i === stepIndex ? 'bg-blue-50/60 font-medium text-charcoal-900' : 'text-charcoal-600 hover:bg-sand-50'
                  )}
                >
                  {i < stepIndex ? (
                    <CheckCircle2 size={14} className="text-green-600" aria-hidden />
                  ) : (
                    <Circle size={14} className="text-charcoal-300" aria-hidden />
                  )}
                  <span className="flex-1">{s.title}</span>
                  <span className="text-xs text-charcoal-400">{s.minutes}m</span>
                </button>
              </li>
            ))}
          </ol>
          <div
            className={cn(
              'mt-3 flex items-center justify-center gap-2 rounded-lg border p-3 text-2xl font-semibold tabular-nums',
              secondsLeft < 0
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-sand-200 bg-white text-charcoal-900'
            )}
          >
            <Clock size={20} aria-hidden />
            {fmtClock(secondsLeft)}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => goTo(stepIndex - 1)}
              disabled={stepIndex === 0}
              className="flex-1 rounded border border-sand-300 px-2 py-1.5 text-sm text-charcoal-600 disabled:opacity-40"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => goTo(stepIndex + 1)}
              disabled={stepIndex === agenda.length - 1}
              className="flex-1 rounded-lg bg-terra-500 hover:bg-terra-600 transition-colors px-2 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>

        {/* Step content */}
        <div className="lg:col-span-3">
          <div className="rounded-xl border border-sand-200 bg-white shadow-card p-4">
            <h2 className="mb-1 text-lg font-semibold text-charcoal-900">{step.title}</h2>
            <p className="mb-4 text-sm text-charcoal-500">{step.hint}</p>

            {step.kind === 'scorecard' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-charcoal-500">
                    <tr>
                      <th className="py-1.5 pr-3">Metric</th>
                      <th className="py-1.5 pr-3">Goal</th>
                      <th className="py-1.5 pr-3 text-center">Last wk</th>
                      <th className="py-1.5 text-center">This wk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-100">
                    {props.metrics.map((m) => {
                      const cur = props.entries.find(
                        (e) => e.metric_id === m.id && e.week_start === props.currentWeek
                      );
                      const prev = props.entries.find(
                        (e) => e.metric_id === m.id && e.week_start === props.prevWeek
                      );
                      return (
                        <tr key={m.id}>
                          <td className="py-1.5 pr-3 font-medium text-charcoal-900">{m.name}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-charcoal-500">
                            {m.goal_op === 'gte' ? '≥' : '≤'} {m.goal_value} {m.unit ?? ''}
                          </td>
                          <td className={cn('py-1.5 pr-3 text-center', entryTone(prev?.on_track ?? null))}>
                            {prev?.value ?? '—'}
                          </td>
                          <td className={cn('py-1.5 text-center', entryTone(cur?.on_track ?? null))}>
                            {cur?.value ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-charcoal-400">
                  Off-track and worth discussing? Drop it to Issues from the{' '}
                  <Link href="/company/scorecard" className="text-blue-600 hover:underline">
                    Scorecard
                  </Link>{' '}
                  — then solve it in IDS, not here.
                </p>
              </div>
            ) : null}

            {step.kind === 'rock_review' ? (
              <div>
                {props.rocks.length === 0 ? (
                  <p className="text-sm text-charcoal-400">
                    No active Rocks this quarter —{' '}
                    <Link href="/company/rocks" className="text-blue-600 hover:underline">
                      set some
                    </Link>{' '}
                    (3–7 for the company, 1–3 per seat).
                  </p>
                ) : (
                  props.rocks.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 border-b border-sand-100 py-2 last:border-b-0"
                    >
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          r.status === 'on' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
                        )}
                      >
                        {r.status === 'on' ? 'on track' : 'off track'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-charcoal-900">{r.title}</span>
                      <span className="text-xs text-charcoal-500">{r.owner_person ?? '—'}</span>
                      {r.due_on ? <span className="text-xs text-charcoal-400">{r.due_on}</span> : null}
                    </div>
                  ))
                )}
                <p className="mt-3 text-xs text-charcoal-400">
                  On/off only — off-track Rocks worth an hour go to IDS via{' '}
                  <Link href="/company/issues" className="text-blue-600 hover:underline">
                    + Issue
                  </Link>
                  . Statuses update on the{' '}
                  <Link href="/company/rocks" className="text-blue-600 hover:underline">
                    Rocks board
                  </Link>{' '}
                  or the Friday Slack tap.
                </p>
              </div>
            ) : null}

            {step.kind === 'headline' ? (
              <textarea
                className="w-full rounded border border-sand-300 px-2 py-1.5 text-sm"
                placeholder={'One line each, e.g.\n- Firkus cleared 12 WOs this week\n- New owner signed: 4-plex on Purcell'}
                rows={6}
                value={headlines}
                onChange={(e) => setHeadlines(e.target.value)}
              />
            ) : null}

            {step.kind === 'todo_review' ? (
              <div>
                {props.lastWeekTodos.length === 0 ? (
                  <p className="text-sm text-charcoal-400">No to-dos were due last week.</p>
                ) : (
                  props.lastWeekTodos.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 border-b border-sand-100 py-2 last:border-b-0"
                    >
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          t.status === 'done'
                            ? 'bg-green-50 text-green-800'
                            : 'bg-red-50 text-red-700'
                        )}
                      >
                        {t.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-charcoal-900">{t.title}</span>
                      <span className="text-xs text-charcoal-500">{t.owner_person ?? '—'}</span>
                      {t.status === 'open' ? (
                        <button
                          type="button"
                          onClick={() => void api(`/api/eos/todos/${t.id}`, 'PATCH', { status: 'done' }, t.id)}
                          disabled={busy === t.id}
                          className="rounded border border-sand-300 px-2 py-0.5 text-xs text-charcoal-600 hover:border-green-500 hover:text-green-700"
                        >
                          Done
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
                <p className="mt-3 text-xs text-charcoal-400">
                  Done rate:{' '}
                  {props.lastWeekTodos.length === 0
                    ? '—'
                    : `${props.lastWeekTodos.filter((t) => t.status === 'done').length}/${props.lastWeekTodos.length}`}{' '}
                  (target ≥90%). Not-done to-dos roll and escalate on their own.
                </p>
              </div>
            ) : null}

            {step.kind === 'ids' ? (
              <div>
                {props.issues.length === 0 ? (
                  <p className="text-sm text-charcoal-400">The list is clear. Enjoy the extra hour.</p>
                ) : (
                  props.issues.map((issue) => (
                    <div key={issue.id} className="border-b border-sand-100 py-2 last:border-b-0">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'inline-block w-6 rounded border text-center text-xs font-semibold',
                            issue.priority <= 2
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : issue.priority === 3
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-sand-200 bg-sand-50 text-charcoal-500'
                          )}
                        >
                          {issue.priority}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-charcoal-900">
                          {issue.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => void api(`/api/eos/issues/${issue.id}`, 'PATCH', { status: 'parked' }, issue.id)}
                          disabled={busy === issue.id}
                          className="rounded border border-sand-300 px-2 py-0.5 text-xs text-charcoal-600 hover:border-sand-400"
                        >
                          Park
                        </button>
                        <button
                          type="button"
                          onClick={() => setSolvingId(solvingId === issue.id ? null : issue.id)}
                          className="rounded border border-green-600 px-2 py-0.5 text-xs text-green-700 hover:bg-green-50"
                        >
                          Solve…
                        </button>
                      </div>
                      {issue.detail && solvingId === issue.id ? (
                        <p className="mt-1 whitespace-pre-line pl-9 text-xs text-charcoal-500">{issue.detail}</p>
                      ) : null}
                      {solvingId === issue.id ? (
                        <div className="mt-2 pl-9">
                          <SolveOutcomeForm
                            issueId={issue.id}
                            issueTitle={issue.title}
                            staff={staff}
                            meetingId={meeting.id}
                            onSolved={() => {
                              setSolvingId(null);
                              router.refresh();
                            }}
                            onCancel={() => setSolvingId(null)}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
                <p className="mt-3 text-xs text-charcoal-400">
                  Full queue with evidence lives in{' '}
                  <Link href="/company/issues" className="text-blue-600 hover:underline">
                    Issues & To-Dos
                  </Link>
                  .
                </p>
              </div>
            ) : null}

            {step.kind === 'conclude' ? (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-xs font-medium text-charcoal-700">
                    To-dos to send as Slack cards ({props.meetingTodos.length - unconfirmed.size} confirmed)
                  </p>
                  {props.meetingTodos.length === 0 ? (
                    <p className="text-sm text-charcoal-400">No to-dos were handed out this meeting.</p>
                  ) : (
                    props.meetingTodos.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 py-1 text-sm text-charcoal-900">
                        <input
                          type="checkbox"
                          checked={!unconfirmed.has(t.id)}
                          onChange={(e) =>
                            setUnconfirmed((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        <span className="text-xs text-charcoal-500">
                          {t.owner_person ?? '—'} · {t.due_on}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-charcoal-700">Minutes</p>
                  <textarea
                    className="w-full rounded border border-sand-300 px-2 py-1.5 font-mono text-xs"
                    rows={10}
                    value={minutesDraft}
                    onChange={(e) => setMinutesDraft(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-charcoal-700">
                    Rate the meeting{' '}
                    <select
                      className="rounded border border-sand-300 px-1 py-0.5 text-sm"
                      value={rating}
                      onChange={(e) => setRating(Number(e.target.value))}
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void conclude()}
                    disabled={busy === 'conclude'}
                    className="rounded-lg bg-terra-500 hover:bg-terra-600 transition-colors px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Conclude meeting
                  </button>
                </div>
                <p className="text-xs text-charcoal-400">
                  Concluding sends the checked to-dos to their owners on Slack and files the minutes
                  and decisions into the company brain.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ meeting }: { meeting: Meeting }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold text-charcoal-900">
          {meeting.kind} — {fmtDate(meeting.starts_at)}
        </h1>
        <p className="text-sm text-charcoal-500">
          {meeting.facilitator_person ? `Facilitator: ${meeting.facilitator_person} · ` : ''}
          Same agenda every week — that&rsquo;s the point.
        </p>
      </div>
      <Link href="/company/meetings" className="text-sm text-blue-600 hover:underline">
        ← All meetings
      </Link>
    </div>
  );
}
