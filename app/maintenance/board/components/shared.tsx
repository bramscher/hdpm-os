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

/** Short stage label for the stage chip (kanban shows stage as its column instead). */
const STAGE_SHORT: Record<string, string> = {
  NEW: 'NEW',
  TRIAGED: 'TRIAGE',
  SCHEDULED: 'SCHED',
  IN_PROGRESS: 'IN PROG',
  WAITING_ON: 'WAITING',
  VERIFY: 'VERIFY',
  BILL: 'BILL',
  CLOSED: 'CLOSED',
};

/**
 * One work order card: what/where, ONE owner, next-action date.
 * `showStage` prepends a stage chip — used outside the kanban (By Property view)
 * where stage is no longer implied by a column. Default off = kanban unchanged.
 */
export function WoCard({
  wo,
  showStage,
  showAssignee,
}: {
  wo: MaintWorkOrder;
  showStage?: boolean;
  /** Surface who the work is assigned to (assigned_to); flags unassigned WOs. */
  showAssignee?: boolean;
}) {
  const pastDue = !!wo.next_action_date && wo.next_action_date < todayStr();
  const edge = wo.priority_class ? wo.priority_class.toLowerCase() : 'p4';
  return (
    <Link href={`/maintenance/board/wo/${wo.id}`} className={`card ${edge}`}>
      {showStage && <span className="stagechip">{STAGE_SHORT[wo.stage] ?? wo.stage}</span>}
      {wo.wo_number && <span className="wonum">#{wo.wo_number}</span>}
      {wo.stage === 'WAITING_ON' && wo.waiting_reason && (
        <WaitBadge reason={wo.waiting_reason} small />
      )}
      <b>
        {wo.description.length > 96 ? `${wo.description.slice(0, 96)}…` : wo.description} —{' '}
        {woWhere(wo)}
      </b>
      {showAssignee &&
        (wo.assigned_to ? (
          <>
            <span className="own">👤 {wo.assigned_to}</span>
            {' · '}
          </>
        ) : (
          <>
            <span className="due past">⚠ unassigned</span>
            {' · '}
          </>
        ))}
      <span className="own">{wo.owner_name || '⚠ no HDPM owner'}</span>
      {' · '}
      {wo.next_action_date ? (
        <span className={pastDue ? 'due past' : 'due'}>
          {pastDue ? `due ${fmtDate(wo.next_action_date)} ⚠` : `act ${fmtDate(wo.next_action_date)}`}
        </span>
      ) : (
        <span className="due needsdate">needs date</span>
      )}
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
