'use client';

import Link from 'next/link';
import type { MaintWorkOrder } from '@/lib/maintenance/types';
import type { BoardData, ExceptionsData } from '../board-types';
import { daysSince, fmtDate, woCreatedAt, woWhere } from '../board-types';

function woLink(wo: MaintWorkOrder) {
  return (
    <Link key={wo.id} href={`/maintenance/board/wo/${wo.id}`}>
      {wo.description.slice(0, 50)} — {woWhere(wo)}
    </Link>
  );
}

function joinNodes(nodes: React.ReactNode[]): React.ReactNode {
  if (nodes.length === 0) return <span style={{ color: 'var(--muted)' }}>none — ✓</span>;
  return nodes.map((n, i) => (
    <span key={i}>
      {n}
      {i < nodes.length - 1 ? '; ' : ''}
    </span>
  ));
}

/**
 * Monday Review — the dashboard IS the meeting (30 min, this page only).
 * Composite filter: P1 last 7d · 30+ bucket · vendor-wait >5d · VERIFY/unbilled · turns.
 */
export default function MondayReview({
  board,
  exceptions,
}: {
  board: BoardData;
  exceptions: ExceptionsData | null;
}) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const p1s = board.open
    .concat(board.closedThisWeek)
    .filter((wo) => wo.priority_class === 'P1' && woCreatedAt(wo) >= sevenDaysAgo);

  const aged30 = board.open
    .map((wo) => ({ wo, age: daysSince(woCreatedAt(wo), now) ?? 0 }))
    .filter(({ age }) => age > 30)
    .sort((a, b) => b.age - a.age);

  const vendorWait5 = board.open.filter(
    (wo) =>
      wo.stage === 'WAITING_ON' &&
      wo.waiting_reason === 'VENDOR' &&
      (daysSince(board.waitingSince[wo.id] ?? wo.updated_at, now) ?? 0) > 5
  );

  const verifyQueue = board.open.filter((wo) => wo.stage === 'VERIFY');
  const unbilled = exceptions?.exceptions.filter((ex) => ex.tripwire === 8) ?? [];

  const turnsWithWo = board.turns.filter((t) => board.open.some((wo) => wo.id === t.work_order_id));

  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7));
  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <section>
      <div className="grp">{dateLabel} — 30 minutes, this page only</div>
      <table className="mo-table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Min</th>
            <th style={{ width: 240 }}>Agenda</th>
            <th>Today&apos;s items</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0–5</td>
            <td>P1s last week</td>
            <td>{joinNodes(p1s.map(woLink))}</td>
          </tr>
          <tr>
            <td>5–12</td>
            <td>30+ bucket (every item, blocker aloud)</td>
            <td>
              {aged30.length > 12 ? (
                <>
                  <b className={aged30.length > 5 ? 'flag' : ''}>{aged30.length} items over 30 days</b>{' '}
                  ({aged30.filter(({ wo }) => !wo.aging_reason).length} missing a written reason) —
                  oldest:{' '}
                  {joinNodes(
                    aged30.slice(0, 8).map(({ wo, age }) => (
                      <span key={wo.id}>
                        {woLink(wo)} <span style={{ color: 'var(--muted)' }}>({age}d)</span>
                      </span>
                    ))
                  )}
                  {' … '}
                  <Link href="/maintenance/board?view=aging">full list on the Aging view →</Link>
                </>
              ) : (
                joinNodes(
                  aged30.map(({ wo, age }) => (
                    <span key={wo.id}>
                      {woLink(wo)} <span style={{ color: 'var(--muted)' }}>({age}d)</span>{' '}
                      <span className={wo.aging_reason ? '' : 'flag'}>
                        ({wo.aging_reason || '⚠ reason missing'})
                      </span>
                    </span>
                  ))
                )
              )}
            </td>
          </tr>
          <tr>
            <td>12–18</td>
            <td>Waiting-on-vendor &gt; 5 days</td>
            <td>
              {joinNodes(
                vendorWait5.map((wo) => (
                  <span key={wo.id}>
                    {woLink(wo)} — decide: last chance or reassign + demote
                  </span>
                ))
              )}
            </td>
          </tr>
          <tr>
            <td>18–23</td>
            <td>Verify + unbilled</td>
            <td>
              {verifyQueue.length} in Verify
              {verifyQueue.length > 0 && <> ({joinNodes(verifyQueue.slice(0, 5).map(woLink))})</>}
              {'; '}
              {unbilled.length} unbilled &gt;5d
              {unbilled.length > 0 && (
                <span className="flag"> — {unbilled.map((ex) => ex.owner).join(', ')} today</span>
              )}
            </td>
          </tr>
          <tr>
            <td>23–28</td>
            <td>Turnover</td>
            <td>
              {joinNodes(
                turnsWithWo.map((t) => {
                  const wo = board.open.find((w) => w.id === t.work_order_id)!;
                  return (
                    <span key={t.work_order_id}>
                      {woLink(wo)} — vacant {daysSince(t.vacated_at, now)}d, target{' '}
                      {fmtDate(t.target_ready)}
                      {t.current_blocker ? ` (${t.current_blocker})` : ''}
                    </span>
                  );
                })
              )}
            </td>
          </tr>
          <tr>
            <td>28–30</td>
            <td>One improvement (rotating)</td>
            <td style={{ color: 'var(--muted)' }}>
              Rotating speaker brings one process improvement — no software needed.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="note">The dashboard IS the meeting. No slides, no prep, no status emails.</p>
    </section>
  );
}
