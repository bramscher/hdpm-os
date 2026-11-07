// Running clock fixes (Craig, 2026-11-07): fix the start time of a running clock, or cancel a
// clock-in started by mistake. Pure helpers; lib/timekeeping/server.ts saves the result through
// timekeeping_apply (worker) or timekeeping_admin_clock (admin). Nothing is deleted: every change
// is a timekeeping_event row with who and why.
import {
  addDays,
  buildDays,
  canApplyScheduleDefaults,
  DEFAULT_SCHEDULE,
  localDate,
  localTime,
  type Day,
  type Employee,
  type Sheet,
  type Shift,
} from "./model";
import { displayTime } from "./presentation";

const DAY_MS = 24 * 3600000;
/** Scheduled placeholders are `schedule:<origin date>:<part date>`; the key ties a carry-over to its origin day. */
const placeholderKey = (s: Shift) => s.id.split(":").slice(0, 2).join(":");
const changed = (a: Sheet, days: Day[]) =>
  JSON.stringify(a.days) !== JSON.stringify(days);

/**
 * Clock-in on `date`: that day's planned (scheduled) hours come off the sheet, and so does the
 * carry-over of that night's planned shift into the next day. Returns only the sheets that change.
 */
export function removePlanned(sheets: Sheet[], date: string): Sheet[] {
  const keys = new Set<string>();
  for (const s of sheets)
    s.days
      .find((d) => d.date === date)
      ?.shifts.filter((x) => x.source === "scheduled")
      .forEach((x) => keys.add(placeholderKey(x)));
  const result: Sheet[] = [];
  for (const sheet of sheets) {
    const days = sheet.days.map((d) =>
      d.date === date
        ? {
            ...d,
            off: false,
            exception: true,
            shifts: d.shifts.filter((s) => s.source !== "scheduled"),
          }
        : d.date < date
          ? d
          : {
              ...d,
              shifts: d.shifts.filter(
                (s) => s.source !== "scheduled" || !keys.has(placeholderKey(s)),
              ),
            },
    );
    if (changed(sheet, days)) result.push({ ...sheet, days });
  }
  return result;
}

/**
 * Undo removePlanned for a cancelled clock-in on `date`: the day gets its planned hours back (the
 * way "Apply defaults" fills an untouched day), and the next day gets back that night's carry-over.
 * Days with real entries (another shift, leave, notes, miles) are left as they are, and so are
 * sheets that are no longer editable. Returns only the sheets that change.
 */
export function restorePlanned(
  sheets: Sheet[],
  employee: Employee,
  date: string,
): Sheet[] {
  const next = addDays(date, 1);
  const [fresh, freshNext] = buildDays(
    { ...employee, schedule: employee.schedule ?? DEFAULT_SCHEDULE },
    date,
    next,
  );
  const carry = new Set(
    fresh.shifts
      .filter((s) => s.source === "scheduled")
      .map((s) => placeholderKey(s)),
  );
  const result: Sheet[] = [];
  for (const sheet of sheets) {
    if (!["draft", "returned"].includes(sheet.state)) continue;
    const days = sheet.days.map((d) => {
      if (d.date === date && canApplyScheduleDefaults(d)) return fresh;
      if (d.date === next && canApplyScheduleDefaults(d)) {
        const missing = freshNext.shifts.filter(
          (s) =>
            s.source === "scheduled" &&
            carry.has(placeholderKey(s)) &&
            !d.shifts.some((x) => x.id === s.id),
        );
        if (missing.length)
          return {
            ...d,
            off: false,
            shifts: [...d.shifts, ...missing].sort((a, b) =>
              a.start.localeCompare(b.start),
            ),
          };
      }
      return d;
    });
    if (changed(sheet, days)) result.push({ ...sheet, days });
  }
  return result;
}

/** The end of the latest finished (clocked or entered) shift, at or before `now`; -Infinity if none. */
export function lastClockOut(sheets: Sheet[], now: number): number {
  let last = -Infinity;
  for (const sheet of sheets)
    for (const day of sheet.days)
      for (const s of day.shifts) {
        if (s.source === "scheduled" || !s.end) continue;
        const end = Date.parse(s.end);
        if (end <= now && end > last) last = end;
      }
  return last;
}

/**
 * Check a new start time for a running shift and return it as an ISO timestamp.
 * Everyone: in the past, within 24 hours, not before the last clock-out, not after the first break.
 * A worker fixing their own clock: today only (Pacific). Anything older is an admin fix.
 */
export function checkFixStart(
  shift: Shift,
  start: unknown,
  sheets: Sheet[],
  now: Date,
  worker: boolean,
): string {
  const at = typeof start === "string" ? Date.parse(start) : NaN;
  if (!Number.isFinite(at)) throw new Error("Enter a valid start time.");
  if (at >= now.getTime()) throw new Error("The start time must be in the past.");
  if (worker && localDate(new Date(at)) !== localDate(now))
    throw new Error(
      "You can move the start only within today. Ask an administrator to fix an older start.",
    );
  if (now.getTime() - at > DAY_MS)
    throw new Error(
      "A running shift can't start more than 24 hours ago. Stop the clock at the right time instead.",
    );
  const last = lastClockOut(sheets, now.getTime());
  if (at < last) {
    const iso = new Date(last).toISOString();
    throw new Error(
      `The start can't be before the last clock-out (${localDate(new Date(last))} at ${displayTime(localTime(iso))}).`,
    );
  }
  const firstBreak = Math.min(
    ...shift.breaks.filter((b) => b.start).map((b) => Date.parse(b.start!)),
  );
  if (at > firstBreak)
    throw new Error("The start must be before the shift's first break.");
  return new Date(at).toISOString();
}

/**
 * The first sheet covering one of `dates` that can no longer change (submitted, approved or
 * removed). Fix-start and cancel check this whether or not any day on that sheet changes:
 * a locked sheet needs return or reopen first. The database checks the same under its lock.
 */
export function lockedSheetFor(
  sheets: Sheet[],
  dates: string[],
): Sheet | undefined {
  return sheets.find(
    (s) =>
      !["draft", "returned"].includes(s.state) &&
      dates.some((d) => s.period_start <= d && s.period_end >= d),
  );
}

/** Replace sheets in `base` with their changed versions. */
export function merge(base: Sheet[], changes: Sheet[]): Sheet[] {
  return base.map((s) => changes.find((c) => c.id === s.id) ?? s);
}
/** Keep the latest version of each changed sheet, in first-changed order. */
export function collect(...lists: Sheet[][]): Sheet[] {
  const out: Sheet[] = [];
  for (const list of lists)
    for (const s of list) {
      const i = out.findIndex((x) => x.id === s.id);
      if (i >= 0) out[i] = s;
      else out.push(s);
    }
  return out;
}
