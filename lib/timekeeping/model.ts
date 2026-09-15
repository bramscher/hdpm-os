import { oregonScheduleBreaks } from "./break-defaults";
export const EMPLOYEE_ATTESTATION =
  "I certify that this timesheet accurately records my work, breaks, leave and business miles. I approve and sign it using my Microsoft company account.";
export const ZONE = "America/Los_Angeles";
export type Schedule = {
  breakRule?: "oregon_adult" | "custom";
  lunch?: { start: string; end: string };
  weekdays: number[];
  start: string;
  end: string;
  unpaidBreak: number;
  paidBreak: number;
};
export type Break = {
  id: string;
  start: string | null;
  end: string | null;
  minutes: number;
  paid: boolean;
};
export type Shift = {
  id: string;
  start: string;
  end: string | null;
  source: "scheduled" | "manual" | "clocked";
  breaks: Break[];
};
export type Leave = {
  kind: "vacation" | "sick" | "loa_paid" | "loa_unpaid";
  minutes: number;
};
export type Day = {
  date: string;
  off: boolean;
  exception?: boolean;
  emergency?: boolean;
  emergencyPhone?: boolean;
  shifts: Shift[];
  leave: Leave[];
  miles: number;
  note: string;
};
export type Employee = {
  id: string;
  staff_person: string;
  name: string;
  email: string;
  payroll_id: string;
  pay_basis: "hourly" | "salary";
  manager_id: string | null;
  enabled: boolean;
  starts_on: string;
  ends_on: string | null;
  schedule: Schedule | null;
  version: number;
};
export type Sheet = {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  state: "draft" | "submitted" | "returned" | "approved";
  days: Day[];
  note: string;
  pay_basis: "hourly" | "salary";
  version: number;
  review_manager_id: string | null;
  employee_name: string;
  payroll_id: string;
  reason: string;
  approved_by: string | null;
  approved_at: string | null;
  employee_signed_by?: string | null;
  employee_signed_name?: string | null;
  employee_signed_at?: string | null;
  employee_signed_version?: number | null;
  employee_attestation?: string | null;
};
export type Clock = {
  employee_id: string;
  version: number;
  shift: Shift | null;
};
export type Totals = {
  worked: number;
  scheduled: number;
  unpaidBreak: number;
  paidBreak: number;
  vacation: number;
  sick: number;
  loa_paid: number;
  loa_unpaid: number;
  miles: number;
};
export const LEAVE_LABELS: Record<Leave["kind"], string> = {
  vacation: "Vacation",
  sick: "Sick",
  loa_paid: "LOA · paid",
  loa_unpaid: "LOA · unpaid",
};

export function localDate(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function localTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
export function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + "T12:00:00Z")) &&
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date
  );
}
export function addDays(date: string, count: number): string {
  if (!validDate(date)) throw new Error("Invalid date");
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function periodFor(date: string) {
  if (!validDate(date)) throw new Error("Invalid pay-period date");
  const [y, m, d] = date.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
  return d <= 15
    ? { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-15` }
    : { start: `${date.slice(0, 7)}-16`, end };
}
export function dates(start: string, end: string): string[] {
  const result: string[] = [];
  for (let d = start; d <= end && result.length < 32; d = addDays(d, 1))
    result.push(d);
  return result;
}
/** Resolve wall time explicitly; reject skipped/repeated DST times instead of guessing. */
export function wallTime(date: string, time: string): string {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Enter a valid date and time");
  const naive = Date.parse(`${date}T${time}:00Z`);
  const matches: string[] = [];
  for (const offset of [7, 8]) {
    const at = new Date(naive + offset * 3600000);
    if (localDate(at) === date && localTime(at.toISOString()) === time)
      matches.push(at.toISOString());
  }
  if (matches.length !== 1)
    throw new Error(
      "This time falls in a daylight-saving change. Use clocked time or ask your reviewer to record the exact timestamp.",
    );
  return matches[0];
}
/** Resolve a saved lunch relative to its shift, including overnight schedules. */
export function scheduledLunch(date: string, schedule: Schedule) {
  if (!schedule.lunch) return null;
  const shiftStart = wallTime(date, schedule.start);
  const shiftEnd = wallTime(
    schedule.end > schedule.start ? date : addDays(date, 1),
    schedule.end,
  );
  const lunchDate =
    schedule.lunch.start < schedule.start ? addDays(date, 1) : date;
  const start = wallTime(lunchDate, schedule.lunch.start);
  const end = wallTime(
    schedule.lunch.end > schedule.lunch.start
      ? lunchDate
      : addDays(lunchDate, 1),
    schedule.lunch.end,
  );
  if (start < shiftStart || end > shiftEnd || end <= start)
    throw new Error(
      "Lunch start and end must fit within your usual work hours",
    );
  return { start, end, minutes: (Date.parse(end) - Date.parse(start)) / 60000 };
}
export const DEFAULT_SCHEDULE: Schedule = {
  weekdays: [1, 2, 3, 4, 5],
  start: "07:00",
  end: "16:30",
  lunch: { start: "12:00", end: "13:00" },
  unpaidBreak: 60,
  paidBreak: 20,
  breakRule: "oregon_adult",
};
export function validateSchedule(value: unknown): Schedule {
  const s = value as Schedule;
  if (
    !s ||
    !Array.isArray(s.weekdays) ||
    s.weekdays.length > 7 ||
    new Set(s.weekdays).size !== s.weekdays.length ||
    s.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw new Error("Choose your scheduled weekdays");
  const start = wallTime("2026-09-15", s.start),
    end = wallTime(s.end > s.start ? "2026-09-15" : "2026-09-16", s.end);
  for (const n of [s.unpaidBreak, s.paidBreak])
    if (!Number.isInteger(n) || n < 0 || n > 240)
      throw new Error("Break defaults must be 0–240 whole minutes");
  if (
    s.start === s.end ||
    (Date.parse(end) - Date.parse(start)) / 60000 < s.unpaidBreak + s.paidBreak
  )
    throw new Error("Breaks must fit within the shift");
  if (s.breakRule && !["oregon_adult", "custom"].includes(s.breakRule))
    throw new Error("Choose a valid break default rule");
  const lunch = scheduledLunch("2026-09-15", s);
  if (lunch && lunch.minutes !== s.unpaidBreak)
    throw new Error(
      "Unpaid lunch minutes must match the lunch start and end times",
    );
  if (s.breakRule === "oregon_adult") {
    const suggested = oregonScheduleBreaks(s.start, s.end, lunch?.minutes);
    if (
      s.unpaidBreak !== suggested.unpaidBreak ||
      s.paidBreak !== suggested.paidBreak
    )
      throw new Error(
        "Refresh the Oregon break defaults or choose custom minutes",
      );
  }
  return {
    ...(s.breakRule ? { breakRule: s.breakRule } : {}),
    ...(s.lunch ? { lunch: { start: s.lunch.start, end: s.lunch.end } } : {}),
    weekdays: [...s.weekdays],
    start: s.start,
    end: s.end,
    unpaidBreak: s.unpaidBreak,
    paidBreak: s.paidBreak,
  };
}
/** Empty unfinished days can be filled even after an earlier edit; explicit days off stay protected. */
export function canApplyScheduleDefaults(day: Day): boolean {
  return (
    !day.emergency &&
    !day.emergencyPhone &&
    !day.note &&
    !day.miles &&
    !day.leave.length &&
    day.shifts.every((shift) => shift.source === "scheduled") &&
    (!day.exception || (!day.off && day.shifts.length === 0))
  );
}
export function blankDay(date: string): Day {
  return { date, off: false, shifts: [], leave: [], miles: 0, note: "" };
}

/** Split timestamps and timed breaks at local midnight. Duration-only breaks belong to the first segment. */
export function splitShift(shift: Shift): { date: string; shift: Shift }[] {
  if (!shift.end) throw new Error("Clock out before saving a shift");
  const start = Date.parse(shift.start),
    end = Date.parse(shift.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 24 * 3600000
  )
    throw new Error(
      "A shift must be longer than zero and no longer than 24 hours",
    );
  const result: { date: string; shift: Shift }[] = [];
  let at = start;
  while (at < end) {
    const date = localDate(new Date(at)),
      boundary = Date.parse(wallTime(addDays(date, 1), "00:00"));
    const until = Math.min(boundary, end);
    const breaks = shift.breaks.flatMap((b) => {
      if (!b.start) return at === start ? [b] : [];
      if (!b.end) throw new Error("Finish the open break first");
      const bs = Math.max(at, Date.parse(b.start)),
        be = Math.min(until, Date.parse(b.end));
      return be > bs
        ? [
            {
              ...b,
              start: new Date(bs).toISOString(),
              end: new Date(be).toISOString(),
            },
          ]
        : [];
    });
    result.push({
      date,
      shift: {
        ...shift,
        id: `${shift.id}:${date}`,
        start: new Date(at).toISOString(),
        end: new Date(until).toISOString(),
        breaks,
      },
    });
    at = until;
  }
  return result;
}
export function buildDays(
  employee: Employee,
  start: string,
  end: string,
): Day[] {
  const days = dates(start, end).map(blankDay),
    schedule = employee.schedule;
  if (!schedule)
    return days.map((day) => ({
      ...day,
      off:
        day.date < employee.starts_on ||
        (!!employee.ends_on && day.date > employee.ends_on),
    }));
  // Include carry-in from a scheduled overnight shift on the preceding day.
  for (const date of dates(addDays(start, -1), end)) {
    if (
      date < employee.starts_on ||
      (employee.ends_on && date > employee.ends_on)
    )
      continue;
    if (!schedule.weekdays.includes(new Date(date + "T12:00:00Z").getUTCDay()))
      continue;
    try {
      const shift: Shift = {
        id: `schedule:${date}`,
        source: "scheduled",
        start: wallTime(date, schedule.start),
        end: wallTime(
          schedule.end > schedule.start ? date : addDays(date, 1),
          schedule.end,
        ),
        breaks: [],
      };
      // Place draft allowances only to allocate their minutes across midnight.
      // Remove these nominal times below; they are not actual break punches.
      const span = (Date.parse(shift.end!) - Date.parse(shift.start)) / 60000;
      const paidCount =
        schedule.breakRule === "oregon_adult"
          ? schedule.paidBreak / 10
          : schedule.paidBreak
            ? 1
            : 0;
      const lunch = scheduledLunch(date, schedule);
      const mealCount = lunch
        ? 0
        : schedule.breakRule === "oregon_adult"
          ? schedule.unpaidBreak / 30
          : schedule.unpaidBreak
            ? 1
            : 0;
      const allowances: { paid: boolean; minutes: number; center: number }[] =
        [];
      for (let i = 0; i < paidCount; i++)
        allowances.push({
          paid: true,
          minutes: schedule.paidBreak / paidCount,
          center: (span * (i + 0.5)) / paidCount,
        });
      for (let i = 0; i < mealCount; i++)
        allowances.push({
          paid: false,
          minutes: schedule.unpaidBreak / mealCount,
          center: (span * (i + 1)) / (mealCount + 1),
        });
      allowances.sort((a, b) => a.center - b.center);
      let after = 0;
      for (let i = 0; i < allowances.length; i++) {
        const allowance = allowances[i],
          remaining = allowances.slice(i).reduce((n, b) => n + b.minutes, 0);
        const from = Math.max(
          after,
          Math.min(allowance.center - allowance.minutes / 2, span - remaining),
        );
        shift.breaks.push({
          id: `default:${i}`,
          paid: allowance.paid,
          minutes: 0,
          start: new Date(Date.parse(shift.start) + from * 60000).toISOString(),
          end: new Date(
            Date.parse(shift.start) + (from + allowance.minutes) * 60000,
          ).toISOString(),
        });
        after = from + allowance.minutes;
      }
      if (lunch)
        shift.breaks.push({
          id: "default:lunch",
          paid: false,
          minutes: 0,
          start: lunch.start,
          end: lunch.end,
        });
      for (const part of splitShift(shift)) {
        const day = days.find((d) => d.date === part.date);
        if (day)
          day.shifts.push({
            ...part.shift,
            breaks: part.shift.breaks.map((b) =>
              b.id === "default:lunch"
                ? b
                : {
                    ...b,
                    minutes: breakMinutes(b),
                    start: null,
                    end: null,
                  },
            ),
          });
      }
    } catch {
      /* DST ambiguity needs an explicit entry, never a guessed actual time. */
    }
  }
  for (const day of days)
    if (
      !day.shifts.length &&
      (day.date < employee.starts_on ||
        (employee.ends_on && day.date > employee.ends_on) ||
        !schedule.weekdays.includes(
          new Date(day.date + "T12:00:00Z").getUTCDay(),
        ))
    )
      day.off = true;
  return days;
}
export function breakMinutes(b: Break): number {
  return b.start && b.end
    ? (Date.parse(b.end) - Date.parse(b.start)) / 60000
    : b.minutes;
}
export function totals(days: Day[]): Totals {
  const t: Totals = {
    worked: 0,
    scheduled: 0,
    unpaidBreak: 0,
    paidBreak: 0,
    vacation: 0,
    sick: 0,
    loa_paid: 0,
    loa_unpaid: 0,
    miles: 0,
  };
  for (const day of days) {
    t.miles += day.miles;
    for (const leave of day.leave) t[leave.kind] += leave.minutes;
    for (const shift of day.shifts) {
      if (!shift.end) continue;
      let elapsed = (Date.parse(shift.end) - Date.parse(shift.start)) / 60000;
      for (const b of shift.breaks) {
        const n = breakMinutes(b);
        if (!b.paid) elapsed -= n;
        if (shift.source !== "scheduled")
          t[b.paid ? "paidBreak" : "unpaidBreak"] += n;
      }
      t[shift.source === "scheduled" ? "scheduled" : "worked"] += elapsed;
    }
  }
  t.miles = Math.round(t.miles * 100) / 100;
  return t;
}
export function hours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}
export function duration(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Strict server validation is also used by the editor before saving. */
export function validateDays(
  input: unknown,
  start: string,
  end: string,
  submitting = false,
  now = new Date(),
): Day[] {
  if (!Array.isArray(input) || input.length !== dates(start, end).length)
    throw new Error("The sheet must include every day of the pay period");
  const days = input as Day[],
    expected = dates(start, end),
    ids = new Set<string>(),
    today = localDate(now),
    finalDay = end === today && periodFor(end).end === end;
  if (submitting && end > today)
    throw new Error(
      "Sign and submit on the final day of the pay period or later",
    );
  let previousEnd = -Infinity;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (
      !d ||
      d.date !== expected[i] ||
      typeof d.off !== "boolean" ||
      (d.emergency !== undefined && typeof d.emergency !== "boolean") ||
      (d.emergencyPhone !== undefined &&
        typeof d.emergencyPhone !== "boolean") ||
      typeof d.note !== "string" ||
      d.note.length > 2000 ||
      typeof d.miles !== "number" ||
      !Number.isFinite(d.miles) ||
      d.miles < 0 ||
      d.miles > 2000 ||
      (Math.round(d.miles * 100) !== d.miles * 100 &&
        Math.abs(Math.round(d.miles * 100) - d.miles * 100) > 1e-6)
    )
      throw new Error(`Check date, note and miles for ${expected[i]}`);
    if (
      !Array.isArray(d.shifts) ||
      d.shifts.length > 12 ||
      !Array.isArray(d.leave) ||
      d.leave.length > 4
    )
      throw new Error(`Too many entries on ${d.date}`);
    if (d.off && (d.shifts.length || d.leave.length))
      throw new Error(`${d.date}: a day off cannot also contain work or leave`);
    const leaveKinds = new Set<string>();
    for (const l of d.leave) {
      if (
        !l ||
        !(l.kind in LEAVE_LABELS) ||
        !Object.hasOwn(LEAVE_LABELS, l.kind) ||
        leaveKinds.has(l.kind) ||
        !Number.isInteger(l.minutes) ||
        l.minutes <= 0 ||
        l.minutes > 1440
      )
        throw new Error(`${d.date}: check leave category and hours`);
      leaveKinds.add(l.kind);
    }
    let workMinutes = 0;
    for (const s of d.shifts) {
      if (
        !s ||
        typeof s.id !== "string" ||
        s.id.length > 150 ||
        ids.has(s.id) ||
        !["manual", "scheduled", "clocked"].includes(s.source) ||
        !Array.isArray(s.breaks) ||
        s.breaks.length > 20
      )
        throw new Error(`${d.date}: invalid or duplicated shift`);
      ids.add(s.id);
      const a = Date.parse(s.start),
        b = s.end ? Date.parse(s.end) : NaN;
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        b <= a ||
        localDate(new Date(a)) !== d.date ||
        b > Date.parse(wallTime(addDays(d.date, 1), "00:00")) ||
        a < previousEnd
      )
        throw new Error(
          `${d.date}: enter nonoverlapping start/end times within this day (use 12:00 AM next day for midnight)`,
        );
      previousEnd = b;
      if (s.source === "clocked" && b > now.getTime())
        throw new Error(`${d.date}: clocked work cannot end in the future`);
      let unpaid = 0,
        allBreaks = 0,
        lastBreakEnd = a;
      for (const br of s.breaks) {
        if (
          typeof br.paid !== "boolean" ||
          typeof br.minutes !== "number" ||
          !Number.isFinite(br.minutes)
        )
          throw new Error(`${d.date}: invalid break`);
        if (br.start || br.end) {
          const bs = Date.parse(br.start || ""),
            be = Date.parse(br.end || "");
          if (
            !Number.isFinite(bs) ||
            !Number.isFinite(be) ||
            bs < lastBreakEnd ||
            bs < a ||
            be <= bs ||
            be > b
          )
            throw new Error(
              `${d.date}: breaks must fit the shift and not overlap`,
            );
          lastBreakEnd = be;
        } else if (!Number.isInteger(br.minutes) || br.minutes < 0)
          throw new Error(`${d.date}: break duration must be whole minutes`);
        const n = breakMinutes(br);
        allBreaks += n;
        if (!br.paid) unpaid += n;
      }
      if (allBreaks > (b - a) / 60000)
        throw new Error(`${d.date}: breaks are longer than the shift`);
      workMinutes += (b - a) / 60000 - unpaid;
    }
    if (workMinutes + d.leave.reduce((sum, l) => sum + l.minutes, 0) > 1440)
      throw new Error(
        `${d.date}: work and leave exceed 24 hours; adjust the scheduled work for leave`,
      );
    if (d.leave.length && d.shifts.some((s) => s.source === "scheduled"))
      throw new Error(
        `${d.date}: adjust the scheduled shift before adding partial-day leave`,
      );
    if (submitting && !d.off && !d.shifts.length && !d.leave.length)
      throw new Error(`${d.date}: enter time or confirm no work`);
    // Final-day signatures may include a planned departure; clock punches
    // still cannot claim future work (checked above).
    if (
      submitting &&
      d.shifts.some((s) => s.end && Date.parse(s.end) > now.getTime()) &&
      !(finalDay && d.date === end)
    )
      throw new Error(
        `${d.date}: planned end times can only be finalized on the final day of the pay period`,
      );
  }
  return days.map((d) => ({ ...d, shifts: [...d.shifts] }));
}
export function confirmDays(days: Day[]): Day[] {
  return days.map((d) => ({
    ...d,
    shifts: d.shifts.map((s) => ({
      ...s,
      source: s.source === "scheduled" ? "manual" : s.source,
    })),
  }));
}
export function currentSheet(
  sheets: Sheet[],
  today: string,
): Sheet | undefined {
  return (
    [...sheets]
      .filter(
        (s) =>
          s.period_start <= today && ["draft", "returned"].includes(s.state),
      )
      .sort((a, b) => a.period_start.localeCompare(b.period_start))[0] ??
    sheets.find((s) => s.period_start === periodFor(today).start)
  );
}
export function canReadSheet(
  sheet: Sheet,
  actorId: string,
  isAdmin: boolean,
  currentId: string | undefined,
): boolean {
  return (
    isAdmin ||
    (sheet.employee_id !== actorId && sheet.review_manager_id === actorId) ||
    (sheet.employee_id === actorId && sheet.id === currentId)
  );
}
export function editDayShift(
  day: Day,
  id: string,
  start: string,
  end: string,
  unpaid: number,
  paid: number,
): Day {
  const next = {
    ...day,
    off: false,
    shifts: day.shifts.map((s) =>
      s.id === id
        ? {
            ...s,
            start: wallTime(day.date, start),
            end:
              end === "24:00"
                ? wallTime(addDays(day.date, 1), "00:00")
                : wallTime(day.date, end),
            source: "manual" as const,
            breaks: [
              ...(Math.round(
                s.breaks
                  .filter((b) => !b.paid)
                  .reduce((n, b) => n + breakMinutes(b), 0),
              ) === unpaid
                ? s.breaks.filter((b) => !b.paid)
                : [
                    {
                      id: `${id}:unpaid`,
                      start: null,
                      end: null,
                      minutes: unpaid,
                      paid: false,
                    },
                  ]),
              ...(Math.round(
                s.breaks
                  .filter((b) => b.paid)
                  .reduce((n, b) => n + breakMinutes(b), 0),
              ) === paid
                ? s.breaks.filter((b) => b.paid)
                : [
                    {
                      id: `${id}:paid`,
                      start: null,
                      end: null,
                      minutes: paid,
                      paid: true,
                    },
                  ]),
            ].sort((a, b) => (a.start || "z").localeCompare(b.start || "z")),
          }
        : s,
    ),
  };
  next.shifts.sort((a, b) => a.start.localeCompare(b.start));
  return next;
}
