import { periodFor, type Sheet } from "./model";

type PeriodSheet = Pick<Sheet, "period_start" | "period_end" | "state">;

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
