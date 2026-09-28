/** Scheduling and notice dates use the property manager's Pacific calendar. */
export const INSPECTION_HORIZON_DAYS = 21;
export function inspectionToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
export function shiftInspectionDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function inspectionHorizon(today = inspectionToday()): string {
  return shiftInspectionDate(today, INSPECTION_HORIZON_DAYS);
}
export function withinInspectionHorizon(date: string | null | undefined, today = inspectionToday()): boolean {
  return !date || date <= inspectionHorizon(today);
}
export function inspectionScheduleError(start: string, end: string, today = inspectionToday()): string | null {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!valid(start) || !valid(end) || start > end) return 'Choose a valid inspection date range.';
  if (start < shiftInspectionDate(today, 7)) return 'Routes must be scheduled at least 7 days in advance to allow time for tenant notices.';
  if (end > inspectionHorizon(today)) return 'Routes can only be scheduled up to 21 days in advance.';
  return null;
}
/** Apply the current window even before the next candidate sync updates stored statuses. */
export function currentCandidateStatus(status: string | null, due: string | null, today = inspectionToday()): string | null {
  return status === 'eligible' && !withinInspectionHorizon(due, today) ? 'defer' : status;
}
