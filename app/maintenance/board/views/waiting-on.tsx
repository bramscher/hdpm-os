'use client';

import { useState } from 'react';
import Link from 'next/link';
import { WAITING_REASONS, type WaitingReason } from '@/lib/maintenance/types';
import type { BoardData } from '../board-types';
import { daysSince, fmtDate, woWhere } from '../board-types';
import { DaysPill, WaitBadge } from '../components/shared';

const DOT_COLORS: Record<WaitingReason, string> = {
  TENANT: 'var(--w-tenant)',
  VENDOR: 'var(--w-vendor)',
  PARTS: 'var(--w-parts)',
  OWNER: 'var(--w-owner)',
  WEATHER: 'var(--w-weather)',
  INTERNAL: 'var(--w-internal)',
};

export default function WaitingOn({ board }: { board: BoardData }) {
  const [filter, setFilter] = useState<'all' | WaitingReason>('all');

  const waiting = board.open.filter((wo) => wo.stage === 'WAITING_ON' && wo.waiting_reason);
  const counts = new Map<WaitingReason, number>();
  for (const r of WAITING_REASONS) counts.set(r, 0);
  for (const wo of waiting) {
    counts.set(wo.waiting_reason!, (counts.get(wo.waiting_reason!) ?? 0) + 1);
  }

  const rows = filter === 'all' ? waiting : waiting.filter((wo) => wo.waiting_reason === filter);

  return (
    <section>
      <div className="chips">
        <button
          className={`chip ${filter === 'all' ? 'on' : ''}`}
          onClick={() => setFilter('all')}
        >
          <span className="dot" style={{ background: 'var(--ink)' }} />
          All <b>{waiting.length}</b>
        </button>
        {WAITING_REASONS.map((r) => (
          <button
            key={r}
            className={`chip ${filter === r ? 'on' : ''}`}
            onClick={() => setFilter(r)}
          >
            <span className="dot" style={{ background: DOT_COLORS[r] }} />
            {r.charAt(0) + r.slice(1).toLowerCase()} <b>{counts.get(r)}</b>
          </button>
        ))}
      </div>

      <table className="mo-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Work order</th>
            <th>Waiting for</th>
            <th>Days</th>
            <th>Next action</th>
            <th>By</th>
            <th>HDPM Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((wo) => {
            const days = daysSince(board.waitingSince[wo.id] ?? wo.updated_at) ?? 0;
            return (
              <tr key={wo.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <WaitBadge reason={wo.waiting_reason!} />
                </td>
                <td>
                  <Link href={`/maintenance/board/wo/${wo.id}`}>
                    {wo.description.slice(0, 60)} — {woWhere(wo)}
                  </Link>
                </td>
                <td>{wo.waiting_reason!.charAt(0) + wo.waiting_reason!.slice(1).toLowerCase()}</td>
                <td>
                  <DaysPill days={days} />
                </td>
                <td>{wo.aging_reason || '⚠ no written next action'}</td>
                <td>{fmtDate(wo.next_action_date)}</td>
                <td>{wo.owner_name}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: 'var(--muted)' }}>
                Nothing waiting{filter !== 'all' ? ` on ${filter.toLowerCase()}` : ''}.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="note">
        One table, same seven columns for every wait type — click a chip to filter. Type badge
        color is constant everywhere; the Days pill is the urgency signal (green ≤2 · amber 3–5 ·
        red &gt;5, red = chase by phone today). Every row has a next action, a date, and one HDPM
        owner (the accountable team member — the OWNER wait-type badge means the property owner).
        Nothing waits silently.
      </p>
    </section>
  );
}
