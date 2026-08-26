'use client';

import { useState } from 'react';
import Link from 'next/link';
import { datePct, type TurnSchedule, type TaskStatus, type MilestoneKind } from '@/lib/maintenance/turn-schedule';

const LEFT_W = 320; // px — task-list pane width

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

const BAR_CLASS: Record<TaskStatus, string> = {
  done: 'bg-green-500',
  in_progress: 'bg-sky-500',
  overdue: 'bg-red-500',
  planned: 'bg-sand-300 border border-sand-400',
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
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000
  );
}

/** Weekly tick dates across the domain (inclusive of start). */
function weekTicks(start: string, end: string): string[] {
  const ticks: string[] = [];
  const total = daysBetween(start, end);
  for (let d = 0; d <= total; d += 7) {
    ticks.push(
      new Date(new Date(`${start}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10)
    );
  }
  return ticks;
}

function Bar({ start, end, status, domain }: { start: string; end: string; status: TaskStatus; domain: { start: string; end: string } }) {
  const left = datePct(start, domain);
  const width = Math.max(datePct(end, domain) - left, 1.2);
  return (
    <div
      className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${BAR_CLASS[status]}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      title={`${STATUS_LABEL[status]} · ${fmt(start)} → ${fmt(end)}`}
    />
  );
}

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
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const ticks = weekTicks(domain.start, domain.end);
  const daysVacant = daysBetween(turn.vacatedAt, today);
  const where = turn.unitName ? `${turn.propertyName} · ${turn.unitName}` : turn.propertyName;

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
        </div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-charcoal-500">
          <span><span className="font-semibold text-charcoal-800">{daysVacant}d</span> vacant</span>
          <span>Move-out {fmt(turn.vacatedAt)}</span>
          {turn.availableDate && <span>Available {fmt(turn.availableDate)}</span>}
          {turn.targetReady && <span>Target {fmt(turn.targetReady)}</span>}
          {turn.moveinDate && <span>Move-in {fmt(turn.moveinDate)}</span>}
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
        <div className="relative">
          {/* Axis: week labels + milestone flags */}
          <div className="flex border-b border-sand-200 bg-sand-50">
            <div
              className="shrink-0 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500"
              style={{ width: LEFT_W }}
            >
              Phase / task
            </div>
            <div className="relative h-14 flex-1">
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l border-sand-200 pl-1 pt-1 text-[10px] text-charcoal-400"
                  style={{ left: `${datePct(t, domain)}%` }}
                >
                  {fmt(t)}
                </div>
              ))}
              {milestones.map((m) => (
                <div
                  key={m.kind}
                  className={`absolute bottom-1 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${MILESTONE_COLOR[m.kind].pill}`}
                  style={{ left: `${datePct(m.date, domain)}%` }}
                >
                  ◆ {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {phases.map((phase) => {
              const isCollapsed = collapsed.has(phase.key);
              return (
                <div key={phase.key}>
                  {/* Phase group row */}
                  <button
                    type="button"
                    onClick={() => toggle(phase.key)}
                    className="flex w-full items-stretch border-b border-sand-100 text-left hover:bg-sand-50"
                  >
                    <div className="flex shrink-0 items-center gap-2 px-4 py-2" style={{ width: LEFT_W }}>
                      <span className="text-charcoal-400">{isCollapsed ? '▸' : '▾'}</span>
                      <span className="text-sm font-semibold text-charcoal-800">{phase.label}</span>
                      <span className="text-xs text-charcoal-400">
                        {phase.tasks.length} · {phase.pctComplete}%
                      </span>
                    </div>
                    <div className="relative flex-1">
                      <Bar start={phase.start} end={phase.end} status={phase.status} domain={domain} />
                    </div>
                  </button>

                  {/* Task rows */}
                  {!isCollapsed &&
                    phase.tasks.map((t) => (
                      <div key={t.id} className="flex items-stretch border-b border-sand-50">
                        <div className="flex shrink-0 items-center gap-2 py-1.5 pl-10 pr-4" style={{ width: LEFT_W }}>
                          {t.appfolioLink ? (
                            <a
                              href={t.appfolioLink}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-xs text-charcoal-600 hover:text-charcoal-900"
                              title={t.description}
                            >
                              {t.woNumber ? `#${t.woNumber} ` : ''}
                              {t.description}
                            </a>
                          ) : (
                            <span className="truncate text-xs text-charcoal-600" title={t.description}>
                              {t.woNumber ? `#${t.woNumber} ` : ''}
                              {t.description}
                            </span>
                          )}
                        </div>
                        <div className="relative flex-1 py-1.5">
                          <Bar start={t.start} end={t.end} status={t.status} domain={domain} />
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}

            {phases.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-charcoal-400">
                No work orders linked to this turn yet.
              </div>
            )}

            {/* Overlay: week gridlines + milestone lines + today, over the timeline region */}
            <div className="pointer-events-none absolute bottom-0 top-0" style={{ left: LEFT_W, right: 0 }}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute bottom-0 top-0 border-l border-sand-100"
                  style={{ left: `${datePct(t, domain)}%` }}
                />
              ))}
              {milestones.map((m) => (
                <div
                  key={m.kind}
                  className={`absolute bottom-0 top-0 border-l-2 border-dashed ${MILESTONE_COLOR[m.kind].line}`}
                  style={{ left: `${datePct(m.date, domain)}%` }}
                />
              ))}
              {datePct(today, domain) > 0 && datePct(today, domain) < 100 && (
                <div
                  className="absolute bottom-0 top-0 border-l-2 border-indigo-500"
                  style={{ left: `${datePct(today, domain)}%` }}
                  title={`Today ${fmt(today)}`}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-charcoal-500">
        <Legend cls="bg-green-500" label="done" />
        <Legend cls="bg-sky-500" label="in progress" />
        <Legend cls="bg-red-500" label="overdue" />
        <Legend cls="bg-sand-300 border border-sand-400" label="planned" />
        <span className="text-charcoal-400">◆ milestone · <span className="text-indigo-500">▏</span> today</span>
      </div>
    </div>
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
