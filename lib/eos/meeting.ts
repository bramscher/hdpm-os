/**
 * Meetings — pure logic (Phase 2, Brief 2D — doc 06 §4). Standing agendas,
 * prep-packet markdown, solve-outcome validation. DB-free; orchestration
 * lives in meeting-prep-run.ts and the API routes.
 */

import type { Meeting } from './types';

export type AgendaStepKind =
  | 'segue'
  | 'scorecard'
  | 'rock_review'
  | 'headline'
  | 'todo_review'
  | 'ids'
  | 'conclude';

export interface AgendaStep {
  kind: AgendaStepKind;
  title: string;
  minutes: number;
  hint: string;
}

/** The L10 standing agenda (doc 06 §4) — 90 minutes, same order every week. */
export const L10_AGENDA: AgendaStep[] = [
  { kind: 'segue', title: 'Segue', minutes: 5, hint: 'Personal & professional good news — around the room.' },
  { kind: 'scorecard', title: 'Scorecard', minutes: 5, hint: 'Numbers only, no discussion. Off-track → Drop to Issues.' },
  { kind: 'rock_review', title: 'Rock review', minutes: 5, hint: 'Each Rock on/off track. Off-track → Drop to Issues.' },
  { kind: 'headline', title: 'Headlines', minutes: 5, hint: 'Customer & employee headlines — one line each.' },
  { kind: 'todo_review', title: 'To-do review', minutes: 5, hint: "Last week's to-dos: done or not done. Done rate is itself a metric." },
  { kind: 'ids', title: 'IDS', minutes: 60, hint: 'Identify, Discuss, Solve — top priority first. No outcome, no "solved."' },
  { kind: 'conclude', title: 'Conclude', minutes: 5, hint: 'Recap to-dos, cascade messages, rate the meeting.' },
];

/** Lighter huddle variant — same tables, shorter list (doc 06 §10 assumption). */
export const HUDDLE_AGENDA: AgendaStep[] = [
  { kind: 'scorecard', title: 'Scorecard', minutes: 5, hint: 'Numbers only, no discussion.' },
  { kind: 'todo_review', title: 'To-do review', minutes: 5, hint: "Last week's to-dos: done or not done." },
  { kind: 'ids', title: 'IDS', minutes: 15, hint: 'Top issues only. No outcome, no "solved."' },
  { kind: 'conclude', title: 'Conclude', minutes: 5, hint: 'Recap to-dos, rate the meeting.' },
];

export function buildAgenda(kind: Meeting['kind']): AgendaStep[] {
  return kind === 'huddle' ? HUDDLE_AGENDA : L10_AGENDA;
}

/** Default L10 start: Monday of `weekStart` at 17:00 UTC (9/10 AM Pacific). */
export function defaultL10StartsAt(weekStart: string): string {
  return `${weekStart}T17:00:00Z`;
}

/** A meeting is concluded once minutes or a rating have been recorded. */
export function isConcluded(meeting: Pick<Meeting, 'minutes_md' | 'rating'>): boolean {
  return meeting.rating !== null || meeting.minutes_md !== null;
}

// ── IDS solve outcome (doc 06 §4 step 6) ────────────────────────────────

export interface SolveOutcome {
  decision?: { title: string; statementMd: string; contextMd?: string };
  todos?: { title: string; ownerPerson?: string | null; dueOn?: string | null }[];
}

/** No outcome, no "solved": at least a decision or one to-do, with content. */
export function validateSolveOutcome(outcome: SolveOutcome): string | null {
  const hasDecision =
    !!outcome.decision && !!outcome.decision.title.trim() && !!outcome.decision.statementMd.trim();
  const todos = (outcome.todos ?? []).filter((t) => t.title.trim());
  if (outcome.decision && !hasDecision) {
    return 'A decision needs both a title and a statement.';
  }
  if (!hasDecision && todos.length === 0) {
    return 'Solving requires an outcome: a decision, one or more to-dos, or both.';
  }
  return null;
}

// ── brain source keys ───────────────────────────────────────────────────

export function decisionSourceKey(decisionId: string): string {
  return `decision:${decisionId}`;
}

export function minutesSourceKey(meetingId: string, chunkIndex: number): string {
  return `meeting:${meetingId}#${chunkIndex}`;
}

// ── prep packet (Meeting Prep agent, Monday) ────────────────────────────

export interface PrepMetricLine {
  name: string;
  unit: string | null;
  goalOp: 'gte' | 'lte';
  goalValue: number | null;
  ownerPerson: string | null;
  current: number | null;
  prior: number | null;
  onTrack: boolean | null;
  offTrackStreak: number;
}

export interface PrepIssueLine {
  title: string;
  priority: number;
  ageDays: number;
  raisedBy: string;
}

export interface PrepPacketInput {
  weekStart: string;
  metrics: PrepMetricLine[];
  issues: PrepIssueLine[];
  openIssueCount: number;
  todoStats: { due: number; done: number };
  recentDecisions: { title: string; effectiveOn: string }[];
  memory: { answer: string; links: { title: string; url: string }[] } | null;
}

function fmtNum(v: number | null): string {
  if (v === null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function metricLineMd(m: PrepMetricLine): string {
  const arrow =
    m.current === null || m.prior === null || m.current === m.prior
      ? '→'
      : m.current > m.prior
        ? '↑'
        : '↓';
  const flag = m.onTrack === false ? ' ⚠️' : '';
  const streak = m.offTrackStreak >= 2 ? ` (${m.offTrackStreak} wks off)` : '';
  const goal = m.goalValue === null ? '' : ` · goal ${m.goalOp === 'gte' ? '≥' : '≤'} ${m.goalValue}`;
  return `- **${m.name}**: ${fmtNum(m.current)} ${m.unit ?? ''} (${arrow} from ${fmtNum(m.prior)})${goal}${flag}${streak}`;
}

/** The Monday packet — pure markdown; stored in meeting.prep_packet_md. */
export function buildPrepPacket(input: PrepPacketInput): string {
  const lines: string[] = [];
  lines.push(`## Meeting prep — week of ${input.weekStart}`);
  lines.push('');
  lines.push('### Scorecard');
  if (input.metrics.length === 0) lines.push('_No weekly metrics yet._');
  for (const m of input.metrics) lines.push(metricLineMd(m));
  lines.push('');
  lines.push(`### Issues queue (${input.openIssueCount} open)`);
  if (input.issues.length === 0) lines.push('_The list is clear._');
  for (const i of input.issues) {
    lines.push(`- [P${i.priority}] ${i.title} — ${i.ageDays}d old, raised by ${i.raisedBy}`);
  }
  lines.push('');
  const rate =
    input.todoStats.due === 0
      ? '—'
      : `${Math.round((input.todoStats.done / input.todoStats.due) * 100)}%`;
  lines.push('### To-dos');
  lines.push(
    `- Last week: ${input.todoStats.done}/${input.todoStats.due} done (${rate} — target ≥90%)`
  );
  lines.push('');
  if (input.recentDecisions.length > 0) {
    lines.push('### Recent decisions');
    for (const d of input.recentDecisions) lines.push(`- ${d.title} (${d.effectiveOn})`);
    lines.push('');
  }
  if (input.memory) {
    lines.push('### From the company brain');
    lines.push(input.memory.answer.trim());
    if (input.memory.links.length > 0) {
      lines.push('');
      for (const l of input.memory.links) lines.push(`- [${l.title}](${l.url})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
