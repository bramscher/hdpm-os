import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  DEFAULT_SCHEDULE,
  buildDays,
  confirmDays,
  editDayShift,
  localTime,
  totals,
  validateDays,
  validateSchedule,
  wallTime,
  type Employee,
  type Sheet,
} from "../model";
import { createEmployeePreview } from "../preview";
import type { TimekeepingBoot } from "../client";
import { payrollWorkbook } from "../export";
const employee: Employee = {
  id: "demo",
  staff_person: "Demo",
  name: "Demo",
  email: "demo@example.test",
  payroll_id: "",
  pay_basis: "hourly",
  enabled: true,
  manager_id: "manager",
  version: 1,
  starts_on: "2026-09-01",
  ends_on: null,
  schedule: DEFAULT_SCHEDULE,
};
describe("lunch windows and daily exceptions", () => {
  it("deducts a one-hour lunch and preserves it when work hours change", () => {
    validateSchedule(DEFAULT_SCHEDULE);
    const [day] = buildDays(employee, "2026-09-15", "2026-09-15");
    expect(totals([day]).scheduled).toBe(510);
    expect(
      day.shifts[0].breaks.filter((b) => b.paid).map((b) => b.minutes),
    ).toEqual([10, 10]);
    const lunch = day.shifts[0].breaks.find((b) => !b.paid)!;
    expect(localTime(lunch.start!)).toBe("12:00");
    expect(localTime(lunch.end!)).toBe("13:00");
    const edited = editDayShift(
      day,
      day.shifts[0].id,
      "07:15",
      "16:30",
      60,
      20,
    );
    expect(edited.shifts[0].breaks.find((b) => !b.paid)).toEqual(lunch);
    validateDays([edited], day.date, day.date);
    expect(totals([edited]).worked).toBe(495);
  });
  it("accepts staggered lunches, rejects mismatched/outside windows, and splits overnight lunch", () => {
    const schedule = {
      ...DEFAULT_SCHEDULE,
      lunch: { start: "11:30", end: "12:30" },
    };
    expect(validateSchedule(schedule).lunch).toEqual(schedule.lunch);
    expect(() => validateSchedule({ ...schedule, unpaidBreak: 30 })).toThrow(
      "must match",
    );
    expect(() =>
      validateSchedule({
        ...schedule,
        lunch: { start: "16:00", end: "17:00" },
      }),
    ).toThrow("fit within");
    const days = buildDays(
      {
        ...employee,
        schedule: {
          ...DEFAULT_SCHEDULE,
          weekdays: [2],
          start: "20:00",
          end: "05:30",
          lunch: { start: "23:30", end: "00:30" },
        },
      },
      "2026-09-15",
      "2026-09-16",
    );
    validateDays(days, "2026-09-15", "2026-09-16");
    expect(totals(days).scheduled).toBe(510);
    expect(confirmDays(days).map((d) => totals([d]).unpaidBreak)).toEqual([
      30, 30,
    ]);
  });
  it("updates totals from exact daily lunch times and rejects lunch beyond the shift", () => {
    const [day] = confirmDays(buildDays(employee, "2026-09-15", "2026-09-15"));
    const lunch = day.shifts[0].breaks.find((b) => !b.paid)!;
    lunch.start = wallTime(day.date, "12:07");
    lunch.end = wallTime(day.date, "12:52");
    expect(totals([day]).worked).toBe(525);
    validateDays([day], day.date, day.date);
    lunch.end = wallTime(day.date, "17:00");
    expect(() => validateDays([day], day.date, day.date)).toThrow(
      "fit the shift",
    );
  });
  it("saves weekend emergency work and exports flags, lunch times, and only current leave categories", async () => {
    const request = createEmployeePreview(
      "completed-period",
      () => new Date("2026-09-21T16:00:00Z"),
    );
    const boot = await request<TimekeepingBoot>();
    const s = boot.sheet!;
    const day = s.days.find((d) => d.date === "2026-09-12")!;
    day.off = false;
    day.emergency = true;
    day.emergencyPhone = true;
    day.note = "Weekend emergency phone follow-up";
    day.shifts = [
      {
        id: "weekend",
        start: wallTime(day.date, "09:00"),
        end: wallTime(day.date, "10:00"),
        source: "manual",
        breaks: [],
      },
    ];
    const saved = await request<Sheet>("", {
      op: "save",
      sheetId: s.id,
      version: s.version,
      days: s.days,
      note: s.note,
    });
    const refreshed = await request<Sheet>("", {
      op: "refresh",
      sheetId: s.id,
      version: saved.version,
    });
    expect(refreshed.days.find((d) => d.date === day.date)).toMatchObject({
      emergency: true,
      emergencyPhone: true,
      note: day.note,
    });
    const workbook = (sheet: Sheet) =>
      XLSX.read(
        payrollWorkbook({
          sheets: [{ ...sheet, days: confirmDays(sheet.days) }],
          periodStart: s.period_start,
          periodEnd: s.period_end,
          generatedAt: "2026-09-21T16:00:00Z",
          createdBy: "admin@example.test",
          version: 1,
        }),
        { type: "array" },
      );
    const wb = workbook(refreshed);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["Daily detail"],
    );
    expect(rows.find((r) => r.Date === day.date)).toMatchObject({
      "Worked hours": 1,
      "Emergency work": "Yes",
      "Emergency phone management": "Yes",
    });
    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets.Summary,
    )[0];
    expect(summary["Emergency work days"]).toBe(1);
    expect(summary).not.toHaveProperty("Paid LOA hours");
    const breaks = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["Shifts and breaks"],
    );
    expect(
      breaks.some(
        (b) =>
          b["Record type"] === "Unpaid break" &&
          b["Start (Pacific)"] === "12:00 PM" &&
          b["End (Pacific)"] === "1:00 PM" &&
          b.Minutes === 60,
      ),
    ).toBe(true);
    refreshed.days[0].leave = [{ kind: "loa_paid", minutes: 60 }];
    const legacy = workbook(refreshed);
    expect(
      XLSX.utils.sheet_to_json<Record<string, unknown>>(
        legacy.Sheets.Summary,
      )[0]["Paid LOA hours"],
    ).toBe(1);
  });
});
