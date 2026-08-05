/**
 * Escalation ladder — pure logic (Phase 2, Brief 2C — doc 06 §5).
 * How operational events become Issues: tripwire exceptions (aged or
 * recurring), agent escalations, twice-missed to-dos. DB-free; the cron
 * orchestration lives in escalation-run.ts.
 *
 * Agents and crons FILE issues only — they never solve, never pressure.
 * Dedupe is the database's job: one open issue per source_ref
 * (idx_issue_open_source_ref).
 */

import type { TripwireException } from '@/lib/maintenance/types';
import type { Todo } from './types';

export const ESCALATION_ACTOR = 'system:escalation';

/**
 * Tripwire rung thresholds. `ageDays` is "days stuck as the rule measures
 * it" (business days for some rules, calendar for others). Recurrence is
 * counted in EPISODES — flagged, cleared, flagged again — not distinct
 * days: the tripwire cron logs exceptions every weekday, so a persistent
 * exception racks up distinct days without ever "recurring" (measured
 * 2026-08-04: 39/50 sampled WOs had a wo_event on 10/10 weekdays).
 * Persistence is what the aged rung measures.
 */
export const TRIPWIRE_AGED_DAYS = 21;
export const TRIPWIRE_RECUR_EPISODES = 3;
export const TRIPWIRE_RECUR_WINDOW_DAYS = 28;
/** Consecutive-run break: a gap over this many calendar days starts a new episode (3 spans a weekend). */
export const TRIPWIRE_EPISODE_GAP_DAYS = 3;
/**
 * Tripwires whose escalation path is an agent, not this rung — the
 * estimate chaser works the #11 pool and its escalations arrive via the
 * agent-escalation rung; filing them here too would double-list every
 * stuck estimate.
 */
export const TRIPWIRES_ESCALATED_BY_AGENT = new Set([11]);
/**
 * Per-rung, per-run cap on auto-filed issues — the ladder escalates
 * visibility, and a 100-row day-one queue is the opposite of visible.
 * The backlog drips in worst-first; deferred counts are reported, never
 * silently dropped (measured 2026-08-04: ~130 candidates existed).
 */
export const MAX_ISSUES_PER_RUNG_PER_RUN = 10;

/** agent_proposal scan window for the escalation rung (dedupe makes re-scans safe). */
export const ESCALATION_LOOKBACK_DAYS = 7;

/** A missed to-do rolls once, to today + this many days. */
export const TODO_ROLL_EXTENSION_DAYS = 7;

export const PRIORITY_TRIPWIRE_RECURRING = 2;
export const PRIORITY_TRIPWIRE_AGED = 3;
export const PRIORITY_AGENT_ESCALATION = 2;
export const PRIORITY_TODO_TWICE_MISSED = 3;

/** Today (YYYY-MM-DD) in Pacific time — same approach as weekStartPacific. */
export function todayPacific(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ── source_ref grammar ──────────────────────────────────────────────────
// One open issue per ref (partial unique index). Existing precedent:
// 'scorecard_metric:<id>' (scorecard-run). New refs:
//   'wo:<workOrderId>:tw<n>'      tripwire aged/recurring
//   'wo:<workOrderId>:escalation' estimate-chaser escalation
//   'todo:<rootTodoId>'           twice-missed to-do (root = first of the roll chain)

export function tripwireSourceRef(workOrderId: string, tripwire: number): string {
  return `wo:${workOrderId}:tw${tripwire}`;
}

export function escalationSourceRef(workOrderId: string): string {
  return `wo:${workOrderId}:escalation`;
}

export function todoSourceRef(rootTodoId: string): string {
  return `todo:${rootTodoId}`;
}

export type ParsedSourceRef =
  | { kind: 'scorecard_metric'; id: string }
  | { kind: 'wo_tripwire'; id: string; tripwire: number }
  | { kind: 'wo_escalation'; id: string }
  | { kind: 'todo'; id: string }
  | { kind: 'unknown'; raw: string };

export function parseSourceRef(ref: string | null): ParsedSourceRef {
  if (!ref) return { kind: 'unknown', raw: '' };
  const metric = ref.match(/^scorecard_metric:(.+)$/);
  if (metric) return { kind: 'scorecard_metric', id: metric[1] };
  const tw = ref.match(/^wo:(.+):tw(\d+)$/);
  if (tw) return { kind: 'wo_tripwire', id: tw[1], tripwire: Number(tw[2]) };
  const esc = ref.match(/^wo:(.+):escalation$/);
  if (esc) return { kind: 'wo_escalation', id: esc[1] };
  const todo = ref.match(/^todo:(.+)$/);
  if (todo) return { kind: 'todo', id: todo[1] };
  return { kind: 'unknown', raw: ref };
}

// ── issue drafts ────────────────────────────────────────────────────────

export interface IssueDraft {
  title: string;
  detail: string;
  raised_by: string;
  source_ref: string;
  priority: number;
}

/**
 * Episodes in a set of exception dates: runs of near-consecutive days
 * (gap ≤ TRIPWIRE_EPISODE_GAP_DAYS, so weekends don't split a run). A
 * persistent daily exception is ONE episode; flag → clear → flag is two.
 */
export function countEpisodes(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let episodes = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      (new Date(`${sorted[i]}T12:00:00Z`).getTime() -
        new Date(`${sorted[i - 1]}T12:00:00Z`).getTime()) /
      86_400_000;
    if (gap > TRIPWIRE_EPISODE_GAP_DAYS) episodes++;
  }
  return episodes;
}

/**
 * Tripwire rung: aged past threshold OR recurring (≥3 episodes in the
 * window). One draft per (WO, tripwire); recurring wins when both fire.
 * Skipped: exceptions without a workOrderId (no stable ref) and tripwires
 * owned by an agent (the chaser's #11 arrives via the escalation rung).
 * `episodes` keys are `${workOrderId}:${tripwire}`. Returned worst-first
 * (recurring, then oldest) so the caller can cap a run honestly.
 */
export function decideTripwireIssues(
  exceptions: TripwireException[],
  episodes: Map<string, number>
): IssueDraft[] {
  const drafts = new Map<string, IssueDraft & { _recurring: boolean; _age: number }>();
  for (const ex of exceptions) {
    if (!ex.workOrderId) continue;
    if (TRIPWIRES_ESCALATED_BY_AGENT.has(ex.tripwire)) continue;
    const ref = tripwireSourceRef(ex.workOrderId, ex.tripwire);
    if (drafts.has(ref)) continue;
    const episodeCount = episodes.get(`${ex.workOrderId}:${ex.tripwire}`) ?? 0;
    const recurring = episodeCount >= TRIPWIRE_RECUR_EPISODES;
    const aged = (ex.ageDays ?? 0) >= TRIPWIRE_AGED_DAYS;
    if (!recurring && !aged) continue;
    const reason = recurring
      ? `recurring — ${episodeCount}× in the last ${TRIPWIRE_RECUR_WINDOW_DAYS} days`
      : `aged ${ex.ageDays}d`;
    drafts.set(ref, {
      title: `${ex.label} (${reason}): ${ex.item}`.slice(0, 300),
      detail: `${ex.item}\nFix required: ${ex.fixRequired}\nOwner: ${ex.owner}.`,
      raised_by: `tripwire:${ex.tripwire}`,
      source_ref: ref,
      priority: recurring ? PRIORITY_TRIPWIRE_RECURRING : PRIORITY_TRIPWIRE_AGED,
      _recurring: recurring,
      _age: ex.ageDays ?? 0,
    });
  }
  return [...drafts.values()]
    .sort((a, b) => Number(b._recurring) - Number(a._recurring) || b._age - a._age)
    .map(({ _recurring, _age, ...draft }) => draft);
}

/**
 * Agent-escalation rung: an estimate-chaser `escalate` proposal also files
 * an issue so it can't evaporate from a Slack DM. Returns null when the
 * proposal has no work-order subject (no stable dedupe ref).
 */
export function buildEscalationIssue(proposal: {
  id: string;
  subject_id: string | null;
  payload: Record<string, unknown>;
  rationale: string | null;
}): IssueDraft | null {
  if (!proposal.subject_id) return null;
  const p = proposal.payload ?? {};
  const woNumber = p.wo_number ? `WO ${p.wo_number}` : 'work order';
  const where = [p.property_name, p.unit_name].filter(Boolean).join(' ');
  const detailLines = [
    proposal.rationale ?? '',
    p.vendor_name ? `Vendor: ${p.vendor_name}.` : '',
    p.chase_count != null ? `Chased ${p.chase_count}×.` : '',
    p.age_calendar_days != null ? `${p.age_calendar_days} calendar days old.` : '',
    p.appfolio_link ? `AppFolio: ${p.appfolio_link}` : '',
    `Proposal: proposal:${proposal.id}`,
  ].filter(Boolean);
  return {
    title: `Estimate escalation: ${woNumber}${where ? ` — ${where}` : ''}`.slice(0, 300),
    detail: detailLines.join('\n'),
    raised_by: 'agent:estimate_chaser',
    source_ref: escalationSourceRef(proposal.subject_id),
    priority: PRIORITY_AGENT_ESCALATION,
  };
}

// ── to-do lifecycle ─────────────────────────────────────────────────────
// open → done (human) | open → rolled (cron, first miss — a copy is created
// due +7 with source_id = the original's id, and the owner gets the single
// nudge) | open → missed (cron, second miss — files an issue on the root).

export type TodoAction = 'none' | 'roll' | 'file_issue';

/** `isRoll` = this todo's source_id points at another todo (it IS the rolled copy). */
export function decideTodoAction(
  todo: Pick<Todo, 'status' | 'due_on'>,
  isRoll: boolean,
  today: string
): TodoAction {
  if (todo.status !== 'open') return 'none';
  if (todo.due_on >= today) return 'none';
  return isRoll ? 'file_issue' : 'roll';
}

/** Due date of the rolled copy: today + TODO_ROLL_EXTENSION_DAYS. */
export function rolledDueOn(today: string): string {
  const anchor = new Date(`${today}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + TODO_ROLL_EXTENSION_DAYS);
  return anchor.toISOString().slice(0, 10);
}

export function buildTodoRoll(
  todo: Pick<Todo, 'id' | 'title' | 'owner_person' | 'source' | 'due_on'>,
  today: string
): {
  insert: {
    title: string;
    owner_person: string | null;
    due_on: string;
    source: Todo['source'];
    source_id: string;
  };
  nudge: { subject: string; body: (screenUrl: string) => string };
} {
  const dueOn = rolledDueOn(today);
  return {
    insert: {
      title: todo.title,
      owner_person: todo.owner_person,
      due_on: dueOn,
      source: todo.source,
      source_id: todo.id,
    },
    nudge: {
      subject: 'To-do rolled forward',
      body: (screenUrl: string) =>
        `📋 Your to-do *${todo.title}* was due ${todo.due_on} — I've moved it to ${dueOn}. ` +
        `If it slips again it goes on the Issues list for the weekly meeting.\n${screenUrl}`,
    },
  };
}

export function buildTodoMissedIssue(
  todo: Pick<Todo, 'title' | 'owner_person' | 'due_on' | 'source_id'>,
  originalDueOn: string | null,
  seatName: string | null
): IssueDraft {
  const rootId = todo.source_id as string; // second miss ⇒ this IS a rolled copy
  const owner = todo.owner_person ?? 'unassigned';
  return {
    title: `To-do missed twice: ${todo.title}`.slice(0, 300),
    detail:
      `Owner: ${owner}${seatName ? ` (seat: ${seatName})` : ''}. ` +
      `Due ${originalDueOn ?? '?'}, rolled to ${todo.due_on}, missed again. ` +
      `Original: todo:${rootId}.`,
    raised_by: ESCALATION_ACTOR,
    source_ref: todoSourceRef(rootId),
    priority: PRIORITY_TODO_TWICE_MISSED,
  };
}
