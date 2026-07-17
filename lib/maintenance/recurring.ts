/**
 * Maintenance OS — recurring work-order deferral.
 *
 * AppFolio auto-creates recurring WOs weeks in advance. They shouldn't crowd
 * the board, KPIs, or tripwires until they're actually actionable: a recurring
 * WO surfaces in the calendar week (Mon–Sun) its scheduled date falls in, and
 * stays visible once that week arrives (including overdue). Non-recurring WOs
 * and recurring WOs with no scheduled date are never deferred.
 */

export interface RecurringCheckFields {
  appfolio_recurring?: boolean | null;
  scheduled_start: string | null;
}

/** Monday (00:00) of the week containing the given date, as YYYY-MM-DD. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10);
  const dow = d.getUTCDay(); // 0 = Sunday
  const daysBack = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/**
 * True when the WO is recurring and scheduled for a FUTURE week — i.e. it
 * should be hidden from the board / KPIs / tripwires for now.
 */
export function isDeferredRecurring(wo: RecurringCheckFields, today: string): boolean {
  if (!wo.appfolio_recurring) return false;
  if (!wo.scheduled_start) return false;
  return mondayOf(wo.scheduled_start) > mondayOf(today);
}
