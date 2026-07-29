'use client';

import Link from 'next/link';
import type { MaintWorkOrder } from '@/lib/maintenance/types';
import type { BoardData, ExceptionsData } from '../board-types';
import { daysSince, fmtDate, woCreatedAt, woWhere } from '../board-types';

/** One review item: description link · property/unit chip · right-side meta. */
function ItemRow({ wo, meta }: { wo: MaintWorkOrder; meta?: React.ReactNode }) {
  return (
    <li>
      <Link className="mi-desc" href={`/maintenance/board/wo/${wo.id}`} title={wo.description}>
        {wo.description}
      </Link>
      <span className="mi-where">{woWhere(wo)}</span>
      {meta != null && <span className="mi-meta">{meta}</span>}
    </li>
  );
}

/**
 * A bucket's items as scannable rows. Long lists cap at `max` with a
 * "+N more" link so the meeting stays 30 minutes.
 */
function ItemList({
  items,
  max = 10,
  moreHref,
  moreLabel,
}: {
  items: Array<{ wo: MaintWorkOrder; meta?: React.ReactNode }>;
  max?: number;
  moreHref?: string;
  moreLabel?: string;
}) {
  if (items.length === 0) return <span style={{ color: 'var(--muted)' }}>none — ✓</span>;
  const shown = items.slice(0, max);
  const hidden = items.length - shown.length;
  return (
    <>
      <ul className="mo-items">
        {shown.map(({ wo, meta }) => (
          <ItemRow key={wo.id} wo={wo} meta={meta} />
        ))}
      </ul>
      {hidden > 0 &&
        (moreHref ? (
          <Link className="mo-more" href={moreHref}>
            + {hidden} more — {moreLabel ?? 'full list'} →
          </Link>
        ) : (
          <span className="mo-more" style={{ color: 'var(--muted)' }}>
            + {hidden} more
          </span>
        ))}
    </>
  );
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
  const agedNoReason = aged30.filter(({ wo }) => !wo.aging_reason).length;

  const vendorWait5 = board.open
    .map((wo) => ({
      wo,
      waitDays: daysSince(board.waitingSince[wo.id] ?? wo.updated_at, now) ?? 0,
    }))
    .filter(
      ({ wo, waitDays }) =>
        wo.stage === 'WAITING_ON' && wo.waiting_reason === 'VENDOR' && waitDays > 5
    )
    .sort((a, b) => b.waitDays - a.waitDays);

  const verifyQueue = board.open.filter((wo) => wo.stage === 'VERIFY');
  const unbilled = exceptions?.exceptions.filter((ex) => ex.tripwire === 8) ?? [];

  const turnsWithWo = board.turns.filter((t) => board.open.some((wo) => wo.id === t.work_order_id));

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
            <td>
              <ItemList items={p1s.map((wo) => ({ wo }))} />
            </td>
          </tr>
          <tr>
            <td>5–12</td>
            <td>30+ bucket (every item, blocker aloud)</td>
            <td>
              <b className={aged30.length > 5 ? 'flag' : ''}>{aged30.length} items over 30 days</b>
              {agedNoReason > 0 && (
                <span className="flag"> · {agedNoReason} missing a written reason</span>
              )}
              <ItemList
                items={aged30.map(({ wo, age }) => ({
                  wo,
                  meta: (
                    <>
                      {age}d
                      {' · '}
                      {wo.aging_reason ? (
                        wo.aging_reason
                      ) : (
                        <span className="flag">⚠ reason missing</span>
                      )}
                    </>
                  ),
                }))}
                max={10}
                moreHref="/maintenance/board?view=aging"
                moreLabel="Aging view"
              />
            </td>
          </tr>
          <tr>
            <td>12–18</td>
            <td>
              Waiting-on-vendor &gt; 5 days
              <span className="mo-hint">
                Decide each: last chance, or reassign + demote the vendor.
              </span>
            </td>
            <td>
              {vendorWait5.length > 0 && (
                <b className={vendorWait5.length > 10 ? 'flag' : ''}>
                  {vendorWait5.length} waiting on a vendor
                </b>
              )}
              <ItemList
                items={vendorWait5.map(({ wo, waitDays }) => ({
                  wo,
                  meta: (
                    <>
                      {wo.vendor_name ? `${wo.vendor_name} · ` : ''}
                      {waitDays}d waiting
                    </>
                  ),
                }))}
                max={12}
                moreHref="/maintenance/board?view=wait"
                moreLabel="Waiting-On view"
              />
            </td>
          </tr>
          <tr>
            <td>18–23</td>
            <td>Verify + unbilled</td>
            <td>
              <b>{verifyQueue.length} in Verify</b>
              {unbilled.length > 0 && (
                <span className="flag">
                  {' '}
                  · {unbilled.length} unbilled &gt;5d — {unbilled.map((ex) => ex.owner).join(', ')}{' '}
                  today
                </span>
              )}
              <ItemList
                items={verifyQueue.map((wo) => ({ wo }))}
                max={5}
                moreHref="/maintenance/board?view=open"
                moreLabel="Open Board"
              />
            </td>
          </tr>
          <tr>
            <td>23–28</td>
            <td>Turnover</td>
            <td>
              <ItemList
                items={turnsWithWo.map((t) => {
                  const wo = board.open.find((w) => w.id === t.work_order_id)!;
                  return {
                    wo,
                    meta: (
                      <>
                        vacant {daysSince(t.vacated_at, now)}d · target {fmtDate(t.target_ready)}
                        {t.current_blocker ? (
                          <span className="flag"> · {t.current_blocker}</span>
                        ) : null}
                      </>
                    ),
                  };
                })}
                max={10}
                moreHref="/maintenance/board?view=turnover"
                moreLabel="Turnover board"
              />
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
