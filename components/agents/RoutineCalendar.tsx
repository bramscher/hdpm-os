'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RoutineView, RoutineRun } from '@/lib/routines/status';
import { pacific, runColor, timeLabel, weekBlocks, weekDates, type GridBlock, type RunColor } from '@/lib/routines/calendar';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const COLOR: Record<RunColor, { block: string; dot: string; label: string }> = {
  ok: { block: 'border-green-300 bg-green-50 text-green-900', dot: 'bg-green-500', label: 'Last run OK' },
  warn: { block: 'border-amber-300 bg-amber-50 text-amber-900', dot: 'bg-amber-500', label: 'Halted or skipped' },
  error: { block: 'border-red-300 bg-red-50 text-red-900', dot: 'bg-red-500', label: 'Error' },
  running: { block: 'border-blue-300 bg-blue-50 text-blue-900', dot: 'bg-blue-500 animate-pulse', label: 'Running now' },
  never: { block: 'border-sand-300 bg-sand-100 text-charcoal-700', dot: 'bg-sand-400', label: 'No run recorded' },
};

const CATEGORY_LABEL: Record<string, string> = { sync: 'Sync', agent: 'Agent', report: 'Report', eos: 'EOS', brain: 'Brain' };

const fmt = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

function duration(run: Pick<RoutineRun, 'started_at' | 'finished_at'>): string {
  if (!run.finished_at) return '';
  const s = Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function RoutineCalendar({ routines, logReady, nowIso }: { routines: RoutineView[]; logReady: boolean; nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const byId = useMemo(() => new Map(routines.map((r) => [r.id, r])), [routines]);
  const [category, setCategory] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = (id: string) => category === 'all' || byId.get(id)?.category === category;
  const blocks = useMemo(() => weekBlocks(now, routines), [now, routines]);
  const continuous = routines.filter((r) => r.cadence === 'continuous' && visible(r.id));
  const dates = weekDates(now);
  const today = pacific(now);

  const shown = blocks.filter((b) => visible(b.routineId));
  const hours = shown.length ? [Math.min(...shown.map((b) => b.hour)), Math.max(...shown.map((b) => b.hour))] : [6, 18];
  const hourRows = Array.from({ length: hours[1] - hours[0] + 1 }, (_, i) => hours[0] + i);
  const cell = new Map<string, GridBlock[]>();
  for (const b of shown) {
    const k = `${b.day}:${b.hour}`;
    cell.set(k, [...(cell.get(k) ?? []), b]);
  }

  const counts = routines.reduce<Record<RunColor, number>>(
    (acc, r) => ({ ...acc, [runColor(r.lastRun?.status)]: acc[runColor(r.lastRun?.status)] + 1 }),
    { ok: 0, warn: 0, error: 0, running: 0, never: 0 }
  );

  return (
    <div className="space-y-4">
      {!logReady && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The run log isn’t switched on yet (the <code>routine_run</code> migration hasn’t been applied), so every routine shows as “No run recorded.” Schedules and recipients are live.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {['all', 'agent', 'report', 'eos', 'brain', 'sync'].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={`min-h-9 rounded-full border px-3 text-sm ${category === c ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-sand-200 bg-white text-charcoal-700'}`}
          >
            {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap gap-3 text-xs text-charcoal-600">
          {(Object.keys(COLOR) as RunColor[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${COLOR[k].dot}`} />
              {COLOR[k].label} · {counts[k]}
            </span>
          ))}
        </span>
      </div>

      {continuous.length > 0 && (
        <section aria-label="Runs all day" className="rounded-xl border border-sand-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Runs all day</p>
          <div className="space-y-1.5">
            {continuous.map((r) => {
              const c = COLOR[runColor(r.lastRun?.status)];
              return (
                <button key={r.id} onClick={() => setOpenId(r.id)} className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs ${c.block}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} />
                  <span className="font-medium">{r.name}</span>
                  <span className="text-charcoal-500">{r.schedule.startsWith('*/') ? `every ${r.schedule.split(' ')[0].slice(2)} min` : 'hourly'}</span>
                  <span className="ml-auto text-charcoal-500">last {fmt(r.lastRun?.started_at)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full min-w-[56rem] table-fixed border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-16 border-b border-sand-200 p-2 text-left font-medium text-charcoal-500">PT</th>
              {DAY_NAMES.map((d, i) => (
                <th key={d} className={`border-b border-l border-sand-200 p-2 text-left font-medium ${dates[i] === today.date ? 'bg-blue-50 text-blue-900' : 'text-charcoal-700'}`}>
                  {d} <span className="font-normal text-charcoal-500">{Number(dates[i].slice(8))}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hourRows.map((h) => (
              <tr key={h} className="align-top">
                <td className="border-b border-sand-100 p-2 text-charcoal-500">{timeLabel(h, 0).replace(':00', '')}</td>
                {DAY_NAMES.map((_, day) => {
                  const items = cell.get(`${day}:${h}`) ?? [];
                  const isNowCell = dates[day] === today.date && today.hour === h;
                  return (
                    <td key={day} className={`border-b border-l border-sand-100 p-1 ${dates[day] === today.date ? 'bg-blue-50/40' : ''} ${isNowCell ? 'outline outline-2 -outline-offset-2 outline-blue-300' : ''}`}>
                      <div className="space-y-1">
                        {items.map((b) => {
                          const r = byId.get(b.routineId)!;
                          const c = COLOR[runColor(r.lastRun?.status)];
                          return (
                            <button key={`${b.routineId}-${b.at}`} onClick={() => setOpenId(r.id)} title={`${r.name} · ${timeLabel(b.hour, b.minute)} PT`} className={`block w-full rounded-md border px-1.5 py-1 text-left leading-tight ${c.block}`}>
                              <span className="flex items-center gap-1">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
                                <span className="truncate font-medium">{r.name}</span>
                              </span>
                              <span className="block truncate text-[11px] opacity-75">
                                {timeLabel(b.hour, b.minute)}
                                {r.recipientNames.length > 0 && ` → ${r.recipientNames.join(', ')}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-charcoal-500">
        Vercel runs crons on UTC, so in winter (PST) every block shifts an hour earlier. Yearly and monthly routines appear only in weeks they fire.
      </p>

      {openId && byId.get(openId) && <RoutineDrawer routine={byId.get(openId)!} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function RoutineDrawer({ routine, onClose }: { routine: RoutineView; onClose: () => void }) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRuns(null);
    fetch(`/api/agents/routines/${routine.id}/runs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => live && setRuns(j.runs ?? []))
      .catch((e) => live && setError(e.message));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => {
      live = false;
      window.removeEventListener('keydown', esc);
    };
  }, [routine.id, onClose]);

  const c = COLOR[runColor(routine.lastRun?.status)];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="routine-drawer-title">
      <button aria-label="Close" className="absolute inset-0 bg-charcoal-900/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 border-b border-sand-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-charcoal-500">{CATEGORY_LABEL[routine.category]} · {routine.schedule} UTC</p>
              <h2 id="routine-drawer-title" className="text-lg font-semibold">{routine.name}</h2>
            </div>
            <button onClick={onClose} className="min-h-10 rounded-lg border border-sand-200 px-3 text-sm">Close</button>
          </div>
          <p className="mt-2 inline-flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
            {c.label}
            {routine.lastRun && ` · ${fmt(routine.lastRun.started_at)}`}
          </p>
        </header>
        <div className="space-y-4 p-5 text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
            <dt className="text-charcoal-500">Owner</dt>
            <dd>{routine.owner}</dd>
            <dt className="text-charcoal-500">Who hears from it</dt>
            <dd className="flex flex-wrap gap-1">
              {routine.recipientNames.length ? routine.recipientNames.map((n) => <span key={n} className="rounded-full bg-sand-100 px-2 py-0.5 text-xs">{n}</span>) : <span className="text-charcoal-500">Nobody (data only)</span>}
              {routine.notify && <span className="text-xs text-charcoal-500">(editable in Controls)</span>}
            </dd>
            <dt className="text-charcoal-500">Next run</dt>
            <dd>{fmt(routine.nextRunAt)} PT</dd>
            <dt className="text-charcoal-500">Endpoint</dt>
            <dd><code className="break-all text-xs">{routine.path}</code></dd>
          </dl>

          <section>
            <h3 className="mb-2 font-semibold">Last 20 runs</h3>
            {error && <p className="text-red-700">Couldn’t load runs: {error}</p>}
            {!runs && !error && <p className="text-charcoal-500">Loading…</p>}
            {runs && runs.length === 0 && <p className="text-charcoal-500">No runs recorded yet.</p>}
            {runs && runs.length > 0 && (
              <ol className="space-y-1.5">
                {runs.map((r) => {
                  const rc = COLOR[runColor(r.status)];
                  return (
                    <li key={r.id} className={`rounded-md border px-3 py-2 ${rc.block}`}>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${rc.dot}`} />
                        <span className="font-medium">{r.status}</span>
                        <span className="text-charcoal-600">{fmt(r.started_at)}</span>
                        <span className="ml-auto text-xs text-charcoal-500">
                          {r.items !== null && `${r.items} items · `}
                          {duration(r)}
                        </span>
                      </div>
                      {(r.halt_reason || r.error) && <p className="mt-1 text-xs">{r.error ?? r.halt_reason}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
