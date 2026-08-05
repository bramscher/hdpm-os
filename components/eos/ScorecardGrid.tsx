'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScorecardMetric, ScorecardEntry } from '@/lib/eos/types';

interface Props {
  metrics: ScorecardMetric[];
  entries: ScorecardEntry[];
  weeks: string[]; // oldest → newest (YYYY-MM-DD Mondays)
  currentWeek: string;
}

function fmtWeek(w: string): string {
  const d = new Date(`${w}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}

function fmtValue(v: number | null): string {
  if (v === null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <span className="inline-block w-16" />;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pts = values
    .map((v, i) =>
      v === null ? null : `${(i / (values.length - 1)) * 60},${18 - ((v - min) / span) * 16}`
    )
    .filter(Boolean)
    .join(' ');
  return (
    <svg width="64" height="20" className="inline-block text-charcoal-400" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function ScorecardGrid({ metrics, entries, weeks, currentWeek }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const byCell = new Map<string, ScorecardEntry>();
  for (const e of entries) byCell.set(`${e.metric_id}:${e.week_start}`, e);

  async function saveManual(metric: ScorecardMetric) {
    const raw = drafts[metric.id];
    const value = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(value)) return;
    setBusy(metric.id);
    setNote(null);
    try {
      const res = await fetch('/api/eos/scorecard/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metricId: metric.id, weekStart: currentWeek, value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNote(data.error ?? `Save failed (${res.status})`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function dropToIssues(metric: ScorecardMetric) {
    setBusy(metric.id);
    setNote(null);
    try {
      const res = await fetch('/api/eos/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Scorecard: ${metric.name}`,
          detail: `Dropped from the Scorecard screen. Goal ${metric.goal_op === 'gte' ? '≥' : '≤'} ${metric.goal_value} ${metric.unit ?? ''}. Owner: ${metric.owner_person ?? 'unassigned'}.`,
          sourceRef: `scorecard_metric:${metric.id}`,
          priority: 2,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setNote(res.ok ? `Issue filed for "${metric.name}".` : (data.error ?? 'Issue filing failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {note ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {note}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-charcoal-500">
            <tr>
              <th className="px-3 py-2">Metric</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Goal</th>
              <th className="px-3 py-2">Trend</th>
              {weeks.map((w) => (
                <th key={w} className={`px-2 py-2 text-center ${w === currentWeek ? 'text-charcoal-900' : ''}`}>
                  {fmtWeek(w)}
                </th>
              ))}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {metrics.map((m) => {
              const values = weeks.map((w) => {
                const e = byCell.get(`${m.id}:${w}`);
                return e?.value ?? null;
              });
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-medium text-charcoal-900">{m.name}</td>
                  <td className="px-3 py-2 text-charcoal-500">{m.owner_person ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-charcoal-500">
                    {m.goal_op === 'gte' ? '≥' : '≤'} {m.goal_value} {m.unit ?? ''}
                  </td>
                  <td className="px-3 py-2">
                    <Sparkline values={values} />
                  </td>
                  {weeks.map((w) => {
                    const e = byCell.get(`${m.id}:${w}`);
                    const isCurrent = w === currentWeek;
                    if (m.source === 'manual' && isCurrent && (!e || e.source === 'manual')) {
                      return (
                        <td key={w} className="px-1 py-1 text-center">
                          <input
                            className="w-16 rounded border border-sand-300 px-1 py-0.5 text-center text-sm"
                            defaultValue={e?.value ?? ''}
                            inputMode="decimal"
                            onChange={(ev) => setDrafts((d) => ({ ...d, [m.id]: ev.target.value }))}
                            onBlur={() => void saveManual(m)}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                            }}
                            disabled={busy === m.id}
                            aria-label={`${m.name} — this week's value`}
                          />
                        </td>
                      );
                    }
                    const tone =
                      e?.on_track === true
                        ? 'bg-green-50 text-green-800'
                        : e?.on_track === false
                          ? 'bg-red-50 text-red-700 font-semibold'
                          : 'text-charcoal-400';
                    return (
                      <td key={w} className={`px-2 py-2 text-center ${tone}`}>
                        {fmtValue(e?.value ?? null)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">
                    <button
                      className="whitespace-nowrap rounded border border-sand-300 px-2 py-1 text-xs text-charcoal-600 transition-colors hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
                      onClick={() => void dropToIssues(m)}
                      disabled={busy === m.id}
                      title="File this metric as an issue for the weekly meeting"
                    >
                      → Issue
                    </button>
                  </td>
                </tr>
              );
            })}
            {metrics.length === 0 ? (
              <tr>
                <td colSpan={weeks.length + 5} className="px-3 py-8 text-center text-charcoal-400">
                  No active metrics — run scripts/eos/seed-eos.ts.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
