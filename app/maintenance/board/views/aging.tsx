'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PEOPLE, STAGES, type Stage } from '@/lib/maintenance/types';
import type { BoardData } from '../board-types';
import { agingBand, daysSince, woCreatedAt, woWhere } from '../board-types';
import { KpiTile } from '../components/shared';

const BAND_LABELS = ['0–7 days', '8–14 days', '15–30 days', '30+ days'] as const;

function stageLabel(wo: { stage: Stage; waiting_reason: string | null }): string {
  return wo.stage === 'WAITING_ON' && wo.waiting_reason
    ? `WAIT-${wo.waiting_reason}`
    : wo.stage;
}

export default function Aging({ board, onChanged }: { board: BoardData; onChanged?: () => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<'all' | Stage>('all');

  const now = new Date();
  const withAge = board.open.map((wo) => ({ wo, age: daysSince(woCreatedAt(wo), now) ?? 0 }));
  const bands: number[] = [0, 0, 0, 0];
  for (const { age } of withAge) bands[agingBand(age)]++;

  const old = withAge.filter(({ age }) => age > 14).sort((a, b) => b.age - a.age);

  // Stage breakdown of the aging pile (drives the filter chips).
  const stageCounts = new Map<Stage, number>();
  for (const { wo } of old) stageCounts.set(wo.stage, (stageCounts.get(wo.stage) ?? 0) + 1);
  const presentStages = STAGES.filter((s) => stageCounts.has(s));

  // The 30+ pile and how much of it is already-completed-in-AppFolio (VERIFY),
  // i.e. closeable at the source rather than genuine open backlog.
  const over30 = withAge.filter(({ age }) => age > 30);
  const over30Verify = over30.filter(({ wo }) => wo.stage === 'VERIFY').length;

  const rows = stageFilter === 'all' ? old : old.filter(({ wo }) => wo.stage === stageFilter);

  // Inline sweep-editing: each save is a normal audited workflow PATCH.
  async function patch(woId: string, fields: Record<string, unknown>) {
    setSaving(woId);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/work-orders/${woId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.errors?.join('; ') || body.error || `Save failed (${res.status})`);
        return;
      }
      setSaved((s) => ({ ...s, [woId]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [woId]: false })), 1500);
      onChanged?.();
    } finally {
      setSaving(null);
    }
  }

  return (
    <section>
      <div className="kpis">
        {BAND_LABELS.map((label, i) => (
          <KpiTile
            key={label}
            value={bands[i]}
            label={label}
            tone={i === 3 && bands[3] > 0 ? 'bad' : i === 2 && bands[2] > 0 ? 'warn' : undefined}
            title={`Open work orders aged ${label} since their AppFolio creation date. ${
              i >= 2
                ? 'These appear in the list below (oldest first).'
                : 'Healthy band — not listed below (the list starts at 15 days).'
            }`}
          />
        ))}
      </div>

      {over30.length > 0 && (
        <p className="note">
          <b>{over30.length}</b> work orders are 30+ days old.{' '}
          {over30Verify > 0 ? (
            <>
              <b>{over30Verify}</b> of those are in <b>VERIFY</b> — AppFolio already marked the work
              complete, so closing them in AppFolio drops them off here on the next sync. Filter to{' '}
              <button
                className="linklike"
                onClick={() => setStageFilter('VERIFY')}
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                VERIFY
              </button>{' '}
              and use the AppFolio links to burn them down.
            </>
          ) : (
            'None are in VERIFY — these are genuine open work; triage below.'
          )}
        </p>
      )}

      {presentStages.length > 1 && (
        <div className="chips">
          <button
            className={`chip ${stageFilter === 'all' ? 'on' : ''}`}
            onClick={() => setStageFilter('all')}
          >
            All <b>{old.length}</b>
          </button>
          {presentStages.map((s) => (
            <button
              key={s}
              className={`chip ${stageFilter === s ? 'on' : ''}`}
              onClick={() => setStageFilter(s)}
            >
              {s} <b>{stageCounts.get(s)}</b>
            </button>
          ))}
        </div>
      )}

      {error && <p className="note flag">{error}</p>}

      <table className="mo-table">
        <thead>
          <tr>
            <th>Work order</th>
            <th>Created</th>
            <th>Days</th>
            <th>Stage</th>
            <th style={{ minWidth: 280 }}>Why it&apos;s old (type + Tab to save)</th>
            <th>Next action</th>
            <th>HDPM Owner</th>
            <th>Close</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ wo, age }) => (
            <tr key={wo.id} style={saved[wo.id] ? { background: 'var(--tint)' } : undefined}>
              <td>
                <Link href={`/maintenance/board/wo/${wo.id}`}>
                  {wo.description.slice(0, 60)} — {woWhere(wo)}
                </Link>
              </td>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                {woCreatedAt(wo).slice(0, 10)}
              </td>
              <td className={age > 30 ? 'flag' : 'warn'}>{age}</td>
              <td>{stageLabel(wo)}</td>
              <td>
                <input
                  className="mo-input"
                  placeholder="⚠ no written reason — type it here"
                  defaultValue={wo.aging_reason ?? ''}
                  disabled={saving === wo.id}
                  style={!wo.aging_reason ? { borderColor: 'var(--red)' } : undefined}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val !== (wo.aging_reason ?? '')) patch(wo.id, { aging_reason: val || null });
                  }}
                />
              </td>
              <td>
                <input
                  type="date"
                  className="mo-input"
                  style={{ width: 140 }}
                  defaultValue={wo.next_action_date ?? ''}
                  disabled={saving === wo.id}
                  onChange={(e) => {
                    if (e.target.value && e.target.value !== wo.next_action_date) {
                      patch(wo.id, { next_action_date: e.target.value });
                    }
                  }}
                />
              </td>
              <td>
                <select
                  className="mo-input"
                  style={{ width: 100 }}
                  defaultValue={wo.owner_name}
                  disabled={saving === wo.id}
                  onChange={(e) => patch(wo.id, { owner_name: e.target.value })}
                >
                  {PEOPLE.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {wo.appfolio_link ? (
                  <a
                    href={wo.appfolio_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mo-btn secondary"
                    style={{ textDecoration: 'none' }}
                    title="Close / resolve this work order in AppFolio (the system of record); it drops off here on the next sync"
                  >
                    AppFolio ↗
                  </a>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>—</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: 'var(--muted)' }}>
                {old.length === 0
                  ? 'Nothing over 14 days old.'
                  : `No work orders in ${stageFilter} over 14 days old.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="note">
        Sweep-edit directly in the table: reasons save on Tab/click-away; dates and owners save on
        change. Every save is logged to the work order&apos;s timeline. <b>Closing is AppFolio-owned</b>
        — use the <b>Close</b> column&apos;s AppFolio ↗ link to resolve a job at the source; it drops
        off this board on the next sync. Filter by stage above to burn down the pile (VERIFY = already
        completed in AppFolio). Target: 30+ bucket under 5, each with a written reason said aloud on
        Monday.
      </p>
    </section>
  );
}
