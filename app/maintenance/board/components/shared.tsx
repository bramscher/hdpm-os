'use client';

/** Small shared primitives for the maintenance board (mockup visual contract). */

import Link from 'next/link';
import type { MaintWorkOrder, WaitingReason } from '@/lib/maintenance/types';
import { daysPillClass, fmtDate, todayStr, woWhere } from '../board-types';

/** Wait-type badge — one color per type, used everywhere. */
export function WaitBadge({ reason, small }: { reason: WaitingReason; small?: boolean }) {
  return (
    <span className={`wtag wt-${reason.toLowerCase()}`} style={small ? undefined : { minWidth: 74 }}>
      {reason}
    </span>
  );
}

/** Days pill: green ≤2 · amber 3–5 · red >5 (red = chase by phone today). */
export function DaysPill({ days }: { days: number }) {
  return <span className={daysPillClass(days)}>{days}</span>;
}

/** One work order card: what/where, ONE owner, next-action date. */
export function WoCard({ wo }: { wo: MaintWorkOrder }) {
  const pastDue = !!wo.next_action_date && wo.next_action_date < todayStr();
  const edge = wo.priority_class ? wo.priority_class.toLowerCase() : 'p4';
  return (
    <Link href={`/maintenance/board/wo/${wo.id}`} className={`card ${edge}`}>
      {wo.stage === 'WAITING_ON' && wo.waiting_reason && (
        <WaitBadge reason={wo.waiting_reason} small />
      )}
      <b>
        {wo.description.length > 96 ? `${wo.description.slice(0, 96)}…` : wo.description} —{' '}
        {woWhere(wo)}
      </b>
      <span className="own">{wo.owner_name || '⚠ no owner'}</span>
      {' · '}
      <span className={pastDue ? 'due past' : 'due'}>
        {pastDue ? `due ${fmtDate(wo.next_action_date)} ⚠` : `act ${fmtDate(wo.next_action_date)}`}
      </span>
    </Link>
  );
}

export function KpiTile({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone?: 'bad' | 'warn';
}) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}
