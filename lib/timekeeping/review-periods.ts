import { periodFor, type Sheet } from "./model";

type PeriodSheet = Pick<Sheet, "period_start" | "period_end" | "state">;

/** Continue the visible review queue, wrapping to earlier names if needed. */
export function nextReviewSheet(
  sheets: Sheet[],
  current: Sheet,
  reviewerId: string,
  employeeFilter = "",
): Sheet | null {
  const compare = (a: Sheet, b: Sheet) =>
    a.employee_name.localeCompare(b.employee_name) || a.id.localeCompare(b.id);
  const pending = sheets
    .filter(
      (sheet) =>
        sheet.id !== current.id &&
        sheet.period_start === current.period_start &&
        sheet.state === "submitted" &&
        sheet.employee_id !== reviewerId &&
        (!employeeFilter || sheet.employee_id === employeeFilter),
    )
    .sort(compare);
  return (
    pending.find((sheet) => compare(sheet, current) > 0) || pending[0] || null
  );
}

/** Newest first, independent of the order returned by the API. */
export function reviewPeriods(sheets: PeriodSheet[]): string[] {
  return [...new Set(sheets.map((sheet) => sheet.period_start))]
    .sort()
    .reverse();
}

export function selectedReviewPeriod(
  sheets: PeriodSheet[],
  requested: string,
  today: string,
): string {
  const periods = reviewPeriods(sheets);
  if (periods.includes(requested)) return requested;
  // Keep unfinished payroll visible after the next period opens.
  const unfinished = sheets
    .filter((sheet) => sheet.period_end < today && sheet.state !== "approved")
    .map((sheet) => sheet.period_start)
    .sort();
  if (unfinished.length) return unfinished[0];
  const current = periodFor(today).start;
  return periods.includes(current) ? current : periods[0] || current;
}
