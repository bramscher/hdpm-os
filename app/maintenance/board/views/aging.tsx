'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PEOPLE } from '@/lib/maintenance/types';
import type { BoardData } from '../board-types';
import { agingBand, daysSince, woCreatedAt, woWhere } from '../board-types';
import { KpiTile } from '../components/shared';

const BAND_LABELS = ['0–7 days', '8–14 days', '15–30 days', '30+ days'] as const;

export default function Aging({ board, onChanged }: { board: BoardData; onChanged?: () => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const withAge = board.open.map((wo) => ({ wo, age: daysSince(woCreatedAt(wo), now) ?? 0 }));
  const bands: number[] = [0, 0, 0, 0];
  for (const { age } of withAge) bands[agingBand(age)]++;

  const old = withAge.filter(({ age }) => age > 14).sort((a, b) => b.age - a.age);

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
          />
        ))}
      </div>

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
          </tr>
        </thead>
        <tbody>
          {old.map(({ wo, age }) => (
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
              <td>
                {wo.stage === 'WAITING_ON' && wo.waiting_reason
                  ? `WAIT-${wo.waiting_reason}`
                  : wo.stage}
              </td>
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
            </tr>
          ))}
          {old.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: 'var(--muted)' }}>
                Nothing over 14 days old.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="note">
        Sweep-edit directly in the table: reasons save on Tab/click-away; dates and owners save on
        change. Every save is logged to the work order&apos;s timeline. For AppFolio-owned changes
        (reschedule, reassign vendor) open the work order → Open in AppFolio ↗. Target: 30+
        bucket under 5, each with a written reason said aloud on Monday.
      </p>
    </section>
  );
}
