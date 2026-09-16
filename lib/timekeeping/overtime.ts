import { addDays, breakMinutes, dates, totals, type Sheet } from "./model";

export type OvertimeStatus = "non_exempt" | "exempt" | "unconfirmed";
export type WeekOpening = {
  employee_id: string;
  period_start: string;
  worked_minutes: number;
  note: string;
  version?: number;
};
export type OvertimeContext = {
  version: 1;
  employees: { id: string; overtime_status: OvertimeStatus }[];
  precedingSheets: Sheet[];
  openings: WeekOpening[];
};
export type PayrollSource = {
  periodStart: string;
  periodEnd: string;
  sheets: Sheet[];
  overtime?: OvertimeContext;
};
export type PayMinutes = {
  worked: number;
  regular: number;
  weeklyOvertime: number;
  emergency: number;
  emergencyAdditional: number;
  overlap: number;
  premium: number;
};
export type PayrollDay = PayMinutes & { date: string; weekStart: string };
export type PayrollWeek = PayMinutes & {
  start: string;
  end: string;
  priorWorked: number;
  totalWorked: number;
  continues: boolean;
  openingNote: string;
  issues: string[];
};
export const weekStart = (date: string) =>
  addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
const zero = (): PayMinutes => ({
  worked: 0,
  regular: 0,
  weeklyOvertime: 0,
  emergency: 0,
  emergencyAdditional: 0,
  overlap: 0,
  premium: 0,
});
function add(target: PayMinutes, source: PayMinutes) {
  for (const key of Object.keys(zero()) as (keyof PayMinutes)[])
    target[key] += source[key];
}

/** Minute-based allocation. Pay periods never reset the weekly 40-hour counter. */
export function payrollHours(source: PayrollSource, sheet: Sheet) {
  const status =
    source.overtime?.employees.find((e) => e.id === sheet.employee_id)
      ?.overtime_status || "unconfirmed";
  const weeks: PayrollWeek[] = [];
  const days: PayrollDay[] = [];
  const summary = zero();
  const issues: string[] = [];
  if (!source.overtime)
    issues.push("Legacy export: create a new export to calculate overtime.");
  if (status === "unconfirmed")
    issues.push("Confirm overtime eligibility in Payroll setup.");
  const starts = [
    ...new Set(dates(source.periodStart, source.periodEnd).map(weekStart)),
  ];
  for (const start of starts) {
    const week: PayrollWeek = {
      ...zero(),
      start,
      end: addDays(start, 6),
      priorWorked: 0,
      totalWorked: 0,
      continues: addDays(start, 6) > source.periodEnd,
      openingNote: "",
      issues: [],
    };
    if (start < source.periodStart) {
      const opening = source.overtime?.openings.find(
        (o) =>
          o.employee_id === sheet.employee_id &&
          o.period_start === source.periodStart,
      );
      if (opening) {
        week.priorWorked = opening.worked_minutes;
        week.openingNote = opening.note;
      } else {
        for (const date of dates(start, addDays(source.periodStart, -1))) {
          const previous =
            source.overtime?.precedingSheets.filter(
              (s) =>
                s.employee_id === sheet.employee_id &&
                s.days.some((d) => d.date === date),
            ) || [];
          if (previous.length !== 1 || previous[0].state !== "approved") {
            week.issues.push(
              `Missing approved hours for ${date}; confirm opening hours in Payroll setup.`,
            );
            continue;
          }
          const day = previous[0].days.find((d) => d.date === date)!;
          const t = totals([day]);
          if (t.scheduled)
            week.issues.push(`Unconfirmed scheduled hours on ${date}.`);
          week.priorWorked += t.worked;
        }
      }
    }
    let worked = week.priorWorked;
    for (const day of sheet.days
      .filter((d) => weekStart(d.date) === start)
      .sort((a, b) => a.date.localeCompare(b.date))) {
      const result: PayrollDay = {
        ...zero(),
        date: day.date,
        weekStart: start,
      };
      if (
        (day.emergency || day.emergencyPhone) &&
        day.shifts.some((s) => s.emergencyAfterHours === undefined)
      )
        week.issues.push(
          `${day.date}: identify after-hours emergency intervals (or confirm none) before export.`,
        );
      for (const shift of [...day.shifts].sort((a, b) =>
        a.start.localeCompare(b.start),
      )) {
        if (!shift.end || shift.source === "scheduled") {
          week.issues.push(`${day.date}: confirm actual work before export.`);
          continue;
        }
        const minutes =
          (Date.parse(shift.end) - Date.parse(shift.start)) / 60000 -
          shift.breaks
            .filter((b) => !b.paid)
            .reduce((n, b) => n + breakMinutes(b), 0);
        if (!Number.isFinite(minutes) || minutes < 0) {
          week.issues.push(`${day.date}: invalid worked time.`);
          continue;
        }
        const overtime =
          status === "exempt"
            ? 0
            : Math.max(0, worked + minutes - 2400) - Math.max(0, worked - 2400);
        const emergency = shift.emergencyAfterHours ? minutes : 0;
        const overlap = shift.emergencyAfterHours ? overtime : 0;
        const premium = overtime + emergency - overlap;
        add(result, {
          worked: minutes,
          regular: minutes - premium,
          weeklyOvertime: overtime,
          emergency,
          emergencyAdditional: emergency - overlap,
          overlap,
          premium,
        });
        worked += minutes;
      }
      days.push(result);
      add(week, result);
    }
    week.totalWorked = worked;
    weeks.push(week);
    add(summary, week);
    issues.push(...week.issues);
  }
  return {
    employeeId: sheet.employee_id,
    name: sheet.employee_name,
    status,
    summary,
    weeks,
    days,
    issues: [...new Set(issues)],
  };
}
