'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { TurnSchedule, TaskStatus, MilestoneKind, TurnTaskLite } from '@/lib/maintenance/turn-schedule';

const LEFT_W = 320; // px — task-list pane width
const AXIS_H = 56;
const ROW_GROUP_H = 40;
const ROW_TASK_H = 34;
const CAP = 11; // hollow end-cap diameter, px
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

interface TurnSummary {
  id: string;
  propertyName: string;
  unitName: string | null;
  vacatedAt: string;
  targetReady: string | null;
  moveinDate: string | null;
  availableDate: string | null;
  budget: number | null;
  actual: number | null;
  currentBlocker: string | null;
  afUnitLink: string | null;
}

const BAR_FILL: Record<TaskStatus, string> = {
  done: 'bg-green-500',
  in_progress: 'bg-sky-500',
  overdue: 'bg-red-500',
  planned: 'bg-sand-300',
};
const BAR_BORDER: Record<TaskStatus, string> = {
  done: 'border-green-500',
  in_progress: 'border-sky-500',
  overdue: 'border-red-500',
  planned: 'border-sand-400',
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  done: 'done',
  in_progress: 'in progress',
  overdue: 'overdue',
  planned: 'planned',
};
const MILESTONE_COLOR: Record<MilestoneKind, { line: string; pill: string }> = {
  move_out: { line: 'border-charcoal-400', pill: 'bg-charcoal-100 text-charcoal-700' },
  available: { line: 'border-sky-400', pill: 'bg-sky-100 text-sky-700' },
  target_ready: { line: 'border-amber-400', pill: 'bg-amber-100 text-amber-700' },
  move_in: { line: 'border-green-500', pill: 'bg-green-100 text-green-700' },
};

function fmt(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}
function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;
}
function weekTicks(start: string, end: string): string[] {
  const ticks: string[] = [];
  const total = Math.ceil(daysBetween(start, end));
  for (let d = 0; d <= total; d += 7) {
    ticks.push(new Date(new Date(`${start}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10));
  }
  return ticks;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function TurnGantt({
  turn,
  schedule,
  today,
}: {
  turn: TurnSummary;
  schedule: TurnSchedule;
  today: string;
}) {
  const { phases, milestones, domain } = schedule;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1); // 1 = fit-to-width
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(960);

  useEffect(() => {
    const measure = () => scrollRef.current && setContainerW(scrollRef.current.clientWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const totalDays = Math.max(daysBetween(domain.start, domain.end), 1);
  const availW = Math.max(containerW - LEFT_W, 240);
  const pxPerDay = (availW / totalDays) * zoom;
  const timelineW = totalDays * pxPerDay; // = availW * zoom
  const xOf = (date: string) => clamp(daysBetween(domain.start, date) * pxPerDay, 0, timelineW);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const ticks = weekTicks(domain.start, domain.end);
  const daysVacant = Math.round(daysBetween(turn.vacatedAt, today));
  const where = turn.unitName ? `${turn.propertyName} · ${turn.unitName}` : turn.propertyName;
  const rowW = LEFT_W + timelineW;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-4">
        <Link href="/maintenance/board?view=turnover" className="text-xs text-charcoal-400 hover:text-charcoal-700">
          ← Turnover board
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-display text-charcoal-900">{where}</h1>
          {turn.afUnitLink && (
            <a href={turn.afUnitLink} target="_blank" rel="noreferrer" className="text-xs text-sky-600 hover:underline">
              Open in AppFolio ↗
            </a>
          )}
          <div className="ml-auto flex items-center gap-1">
            <ZoomBtn label="−" onClick={() => setZoom((z) => clamp(z / 1.5, ZOOM_MIN, ZOOM_MAX))} disabled={zoom <= ZOOM_MIN} />
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="rounded-lg border border-sand-200 bg-white px-2.5 py-1 text-xs font-medium text-charcoal-600 hover:bg-sand-50"
            >
              Fit
            </button>
            <ZoomBtn label="+" onClick={() => setZoom((z) => clamp(z * 1.5, ZOOM_MIN, ZOOM_MAX))} disabled={zoom >= ZOOM_MAX} />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-charcoal-500">
          <span><span className="font-semibold text-charcoal-800">{daysVacant}d</span> vacant</span>
          {milestones.map((m) => (
            <span key={m.kind}>{m.label} {fmt(m.date)}</span>
          ))}
          {turn.budget != null && (
            <span>
              Budget ${Math.round(turn.budget).toLocaleString()}
              {turn.actual != null ? ` · actual $${Math.round(turn.actual).toLocaleString()}` : ''}
            </span>
          )}
          {turn.currentBlocker && <span className="text-amber-700">⚠ {turn.currentBlocker}</span>}
        </div>
      </div>

      {/* Gantt */}
      <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-card">
        <div ref={scrollRef} className="overflow-x-auto">
          <div className="relative" style={{ width: rowW }}>
            {/* Axis */}
            <div className="flex border-b border-sand-200 bg-sand-50" style={{ height: AXIS_H }}>
              <div
                className="sticky left-0 z-20 flex shrink-0 items-end bg-sand-50 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500"
                style={{ width: LEFT_W }}
              >
                Phase / task
              </div>
              <div className="relative shrink-0" style={{ width: timelineW }}>
                {ticks.map((t) => (
                  <div key={t} className="absolute top-0 h-full border-l border-sand-200 pl-1 pt-1 text-[10px] text-charcoal-400" style={{ left: xOf(t) }}>
                    {fmt(t)}
                  </div>
                ))}
                {milestones.map((m) => {
                  const x = xOf(m.date);
                  const pct = timelineW > 0 ? x / timelineW : 0;
                  // Keep edge milestones (esp. move-in on the far right) in view.
                  const anchor = pct > 0.85 ? 'translateX(-100%)' : pct < 0.12 ? 'translateX(0)' : 'translateX(-50%)';
                  return (
                    <div
                      key={m.kind}
                      className={`absolute bottom-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${MILESTONE_COLOR[m.kind].pill}`}
                      style={{ left: x, transform: anchor }}
                    >
                      ◆ {m.label} {fmt(m.date)}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            {phases.map((phase) => {
              const isCollapsed = collapsed.has(phase.key);
              return (
                <div key={phase.key}>
                  {/* Phase group row */}
                  <div className="flex border-b border-sand-100" style={{ height: ROW_GROUP_H, width: rowW }}>
                    <button
                      type="button"
                      onClick={() => toggle(phase.key)}
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-white px-4 text-left hover:bg-sand-50"
                      style={{ width: LEFT_W }}
                    >
                      <span
                        className={`inline-block text-xs text-charcoal-500 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                        aria-hidden
                      >
                        ▶
                      </span>
                      <span className="text-sm font-semibold text-charcoal-800">{phase.label}</span>
                      <span className="text-xs text-charcoal-400">{phase.tasks.length} · {phase.pctComplete}%</span>
                    </button>
                    <div className="relative shrink-0" style={{ width: timelineW }}>
                      <GroupBar left={xOf(phase.start)} right={xOf(phase.end)} title={`${fmt(phase.start)} → ${fmt(phase.end)}`} />
                    </div>
                  </div>

                  {/* Task rows */}
                  {!isCollapsed &&
                    phase.tasks.map((t) => (
                      <div key={t.id} className="flex border-b border-sand-50" style={{ height: ROW_TASK_H, width: rowW }}>
                        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-white pl-10 pr-4" style={{ width: LEFT_W }}>
                          <TaskLabel task={t} />
                        </div>
                        <div className="relative shrink-0" style={{ width: timelineW }}>
                          <TaskBar left={xOf(t.start)} right={xOf(t.end)} status={t.status} title={`${STATUS_LABEL[t.status]} · ${fmt(t.start)} → ${fmt(t.end)}`} />
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}

            {phases.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-charcoal-400">No work orders linked to this turn yet.</div>
            )}

            {/* Overlay: gridlines + milestones + today, over the timeline region only */}
            <div className="pointer-events-none absolute bottom-0 top-0" style={{ left: LEFT_W, width: timelineW }}>
              {ticks.map((t) => (
                <div key={t} className="absolute bottom-0 top-0 border-l border-sand-100" style={{ left: xOf(t) }} />
              ))}
              {milestones.map((m) => (
                <div key={m.kind} className={`absolute bottom-0 top-0 border-l-2 border-dashed ${MILESTONE_COLOR[m.kind].line}`} style={{ left: xOf(m.date) }} />
              ))}
              <div className="absolute bottom-0 top-0 border-l-2 border-indigo-500" style={{ left: xOf(today) }} title={`Today ${fmt(today)}`} />
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-charcoal-500">
        <Legend cls="bg-green-500" label="done" />
        <Legend cls="bg-sky-500" label="in progress" />
        <Legend cls="bg-red-500" label="overdue" />
        <Legend cls="bg-sand-300 border border-sand-400" label="planned" />
        <span className="text-charcoal-400">◆ milestone · <span className="text-indigo-500">▏</span> today · − Fit + to zoom</span>
      </div>
    </div>
  );
}

/** A task bar with hollow end-caps. Single-day tasks collapse to one hollow node. */
function TaskBar({ left, right, status, title }: { left: number; right: number; status: TaskStatus; title: string }) {
  const span = right - left;
  const border = BAR_BORDER[status];
  if (span < CAP) {
    const mid = (left + right) / 2;
    return (
      <div
        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white ${border}`}
        style={{ left: mid, width: CAP, height: CAP }}
        title={title}
      />
    );
  }
  const width = Math.max(span, 3);
  return (
    <div className="absolute top-1/2 -translate-y-1/2" style={{ left, width, height: 12 }} title={title}>
      <div className={`absolute inset-y-0 left-0 right-0 rounded-full ${BAR_FILL[status]}`} />
      <span className={`absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white ${border}`} style={{ width: CAP, height: CAP }} />
      <span className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rounded-full border-2 bg-white ${border}`} style={{ width: CAP, height: CAP }} />
    </div>
  );
}

/** Neutral summary bar (MS-Project style) — span only; % lives in the label. */
function GroupBar({ left, right, title }: { left: number; right: number; title: string }) {
  const width = Math.max(right - left, 6);
  return (
    <div
      className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm bg-charcoal-700"
      style={{ left, width }}
      title={title}
    />
  );
}

function TaskLabel({ task }: { task: TurnTaskLite }) {
  const text = `${task.woNumber ? `#${task.woNumber} ` : ''}${task.description}`;
  return task.appfolioLink ? (
    <a href={task.appfolioLink} target="_blank" rel="noreferrer" className="truncate text-xs text-charcoal-600 hover:text-charcoal-900" title={task.description}>
      {text}
    </a>
  ) : (
    <span className="truncate text-xs text-charcoal-600" title={task.description}>
      {text}
    </span>
  );
}

function ZoomBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 rounded-lg border border-sand-200 bg-white text-sm font-semibold text-charcoal-600 hover:bg-sand-50 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-4 rounded-full ${cls}`} />
      {label}
    </span>
  );
}
