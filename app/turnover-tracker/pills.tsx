import { SECTION_STATUS_LABEL, type SectionStatus, type WoStatus } from '@/lib/turnover/model';

const SECTION_TONE: Record<SectionStatus, string> = {
  not_started: 'bg-sand-100 text-charcoal-600',
  in_progress: 'bg-teal-100 text-teal-800',
  estimated: 'bg-blue-100 text-blue-800',
  awaiting_approval: 'bg-amber-100 text-amber-800',
  awaiting_funds: 'bg-orange-100 text-orange-800',
  estimate_requested: 'bg-indigo-100 text-indigo-800',
  complete: 'bg-green-100 text-green-800',
};

export const WO_TONE: Record<WoStatus, string> = {
  unassigned: 'bg-sand-100 text-charcoal-600',
  assigned: 'bg-purple-100 text-purple-800',
  estimate_requested: 'bg-indigo-100 text-indigo-800',
  estimated: 'bg-blue-100 text-blue-800',
  awaiting_owner_approval: 'bg-amber-100 text-amber-800',
  awaiting_owner_funds: 'bg-orange-100 text-orange-800',
  scheduled: 'bg-teal-100 text-teal-800',
  completed_awaiting_invoice: 'bg-yellow-100 text-yellow-800',
  complete_invoice_received: 'bg-green-100 text-green-800',
  complete_no_bill: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-50 text-red-700',
};

export function SectionPill({ status }: { status: SectionStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${SECTION_TONE[status]}`}>
      {SECTION_STATUS_LABEL[status]}
    </span>
  );
}

export const SECTION_KEY_ORDER: SectionStatus[] = ['not_started', 'estimate_requested', 'estimated', 'awaiting_approval', 'awaiting_funds', 'in_progress', 'complete'];

/** "Oct 2" from YYYY-MM-DD. */
export function shortDate(d: string | null | undefined): string {
  if (!d) return 'Not set';
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
