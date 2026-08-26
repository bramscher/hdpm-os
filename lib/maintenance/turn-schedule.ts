/**
 * Turnover schedule model — the pure core behind the single-turn Gantt
 * (feature/turn-over-pm). Groups a turn's work orders into make-ready phases,
 * derives a start→end bar span for each (AppFolio only populates scheduled_end
 * ~12% of the time, so the end falls back through completed / next-action /
 * default), classifies done/overdue/in-progress, and assembles the milestones
 * (move-out, first-available/showing, target-ready, move-in) + a padded
 * timeline domain. DB-free and Date-injectable so it unit-tests cleanly.
 */

/** AppFolio Turn Board phases, in make-ready order — the Gantt row groups. */
export const PHASES: { key: string; label: string }[] = [
  { key: 'Keys / Locks', label: 'Keys' },
  { key: 'Remotes', label: 'Remotes' },
  { key: 'Maintenance / Repair', label: 'Repair' },
  { key: 'Floors / Carpets', label: 'Floors' },
  { key: 'Paint', label: 'Paint' },
  { key: 'Housekeeping', label: 'Clean' },
  { key: 'Appliances', label: 'Appliances' },
  { key: 'Landscape Maintenance', label: 'Landscape' },
  { key: 'Other', label: 'Other' },
];
const PHASE_KEYS = new Set(PHASES.map((p) => p.key));
const PHASE_LABEL = new Map(PHASES.map((p) => [p.key, p.label]));

/** Manually-linked WOs (no category) and unknown categories land in Other. */
export function phaseKeyFor(category: string | null | undefined): string {
  return category && PHASE_KEYS.has(category) ? category : 'Other';
}

export type TaskStatus = 'done' | 'overdue' | 'in_progress' | 'planned';
export type MilestoneKind = 'move_out' | 'available' | 'target_ready' | 'move_in';

export interface TurnTaskInput {
  id: string;
  wo_number: string | null;
  description: string;
  unit_turn_category: string | null;
  stage: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  completed_date: string | null;
  next_action_date: string | null;
  appfolio_created_at: string | null;
  created_at: string;
  owner_name?: string | null;
  appfolio_link?: string | null;
}

export interface TurnTaskLite {
  id: string;
  woNumber: string | null;
  description: string;
  stage: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  status: TaskStatus;
  ownerName: string | null;
  appfolioLink: string | null;
}

export interface TurnPhase {
  key: string;
  label: string;
  tasks: TurnTaskLite[];
  start: string;
  end: string;
  status: TaskStatus;
  pctComplete: number; // 0–100
}

export interface Milestone {
  date: string;
  kind: MilestoneKind;
  label: string;
}

export interface TurnScheduleTurn {
  vacated_at: string;
  target_ready: string | null;
  movein_date: string | null;
}

export interface TurnSchedule {
  phases: TurnPhase[];
  milestones: Milestone[];
  domain: { start: string; end: string };
}

const DEFAULT_TASK_DAYS = 1;
const DOMAIN_PAD_DAYS = 1;

const dateOnly = (iso: string | null | undefined): string | null =>
  iso ? iso.slice(0, 10) : null;

function addDays(dateStr: string, n: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// YYYY-MM-DD strings compare correctly lexicographically.
const minDate = (a: string, b: string) => (a <= b ? a : b);
const maxDate = (a: string, b: string) => (a >= b ? a : b);

/** Derive one task's bar span + status from its (sparse) AppFolio dates. */
export function deriveTask(t: TurnTaskInput, today: string): TurnTaskLite {
  const start = dateOnly(t.scheduled_start) ?? dateOnly(t.appfolio_created_at) ?? dateOnly(t.created_at)!;
  const endCandidate =
    dateOnly(t.scheduled_end) ??
    dateOnly(t.completed_date) ??
    dateOnly(t.next_action_date) ??
    addDays(start, DEFAULT_TASK_DAYS);
  const end = maxDate(endCandidate, start);

  const done = t.stage === 'CLOSED' || t.completed_date != null;
  let status: TaskStatus;
  if (done) status = 'done';
  else if (end < today) status = 'overdue';
  else if (start <= today) status = 'in_progress';
  else status = 'planned';

  return {
    id: t.id,
    woNumber: t.wo_number,
    description: t.description,
    stage: t.stage,
    start,
    end,
    status,
    ownerName: t.owner_name ?? null,
    appfolioLink: t.appfolio_link ?? null,
  };
}

function rollupStatus(tasks: TurnTaskLite[]): TaskStatus {
  if (tasks.every((t) => t.status === 'done')) return 'done';
  if (tasks.some((t) => t.status === 'overdue')) return 'overdue';
  if (tasks.some((t) => t.status === 'in_progress' || t.status === 'done')) return 'in_progress';
  return 'planned';
}

export function buildTurnSchedule(
  turn: TurnScheduleTurn,
  tasks: TurnTaskInput[],
  availableDate: string | null | undefined,
  today: string = new Date().toISOString().slice(0, 10)
): TurnSchedule {
  const derived = tasks.map((t) => ({ task: deriveTask(t, today), phaseKey: phaseKeyFor(t.unit_turn_category) }));

  // Group into phases, emitted in make-ready order, only non-empty ones.
  const byPhase = new Map<string, TurnTaskLite[]>();
  for (const { task, phaseKey } of derived) {
    const list = byPhase.get(phaseKey);
    if (list) list.push(task);
    else byPhase.set(phaseKey, [task]);
  }

  const phases: TurnPhase[] = [];
  for (const { key, label } of PHASES) {
    const phaseTasks = byPhase.get(key);
    if (!phaseTasks || phaseTasks.length === 0) continue;
    phaseTasks.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const start = phaseTasks.reduce((m, t) => minDate(m, t.start), phaseTasks[0].start);
    const end = phaseTasks.reduce((m, t) => maxDate(m, t.end), phaseTasks[0].end);
    const doneCount = phaseTasks.filter((t) => t.status === 'done').length;
    phases.push({
      key,
      label: PHASE_LABEL.get(key) ?? label,
      tasks: phaseTasks,
      start,
      end,
      status: rollupStatus(phaseTasks),
      pctComplete: Math.round((doneCount / phaseTasks.length) * 100),
    });
  }

  // Milestones (nulls dropped), sorted chronologically.
  const milestones: Milestone[] = [];
  const pushM = (date: string | null | undefined, kind: MilestoneKind, label: string) => {
    const d = dateOnly(date);
    if (d) milestones.push({ date: d, kind, label });
  };
  pushM(turn.vacated_at, 'move_out', 'Move-out');
  pushM(availableDate, 'available', 'Available');
  pushM(turn.target_ready, 'target_ready', 'Target ready');
  pushM(turn.movein_date, 'move_in', 'Move-in');
  milestones.sort((a, b) => a.date.localeCompare(b.date));

  // Domain = move-out → latest milestone/task, so the schedule always
  // zoom-fits edge to edge. `today` is deliberately NOT included: when it's
  // beyond the schedule the render pins its marker to the right edge instead
  // of stretching dead space onto the right.
  const all: string[] = [dateOnly(turn.vacated_at)!].filter(Boolean);
  for (const p of phases) {
    all.push(p.start, p.end);
  }
  for (const m of milestones) all.push(m.date);
  let start = all.reduce((m, d) => minDate(m, d), all[0]);
  let end = all.reduce((m, d) => maxDate(m, d), all[0]);
  start = addDays(start, -DOMAIN_PAD_DAYS);
  end = addDays(maxDate(end, addDays(start, 1)), DOMAIN_PAD_DAYS);

  return { phases, milestones, domain: { start, end } };
}

/** Map a date to a 0–100% offset within the domain (clamped). For the render. */
export function datePct(date: string, domain: { start: string; end: string }): number {
  const total = daysBetween(domain.start, domain.end);
  if (total <= 0) return 0;
  const off = daysBetween(domain.start, date);
  return Math.max(0, Math.min(100, (off / total) * 100));
}

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;
}
