import { describe, expect, it } from "vitest";
import {
  oregonBreaksForWorkMinutes,
  oregonScheduleBreaks,
} from "../break-defaults";
import { displayTime, QUARTER_HOUR_TIMES } from "../presentation";
import { buildDays, totals, validateDays, type Employee } from "../model";
describe("Oregon adult break defaults and civilian times", () => {
  it.each([
    [120, 0, 0],
    [121, 1, 0],
    [359, 1, 0],
    [360, 1, 1],
    [361, 2, 1],
    [600, 2, 1],
    [601, 3, 1],
    [839, 3, 1],
    [840, 3, 2],
    [841, 4, 2],
    [1080, 4, 2],
    [1081, 5, 2],
    [1319, 5, 2],
    [1320, 5, 3],
    [1321, 6, 3],
  ])(
    "matches BOLI work-period boundary %i minutes",
    (work, restCount, mealCount) => {
      expect(oregonBreaksForWorkMinutes(work)).toEqual({
        restCount,
        mealCount,
      });
    },
  );
  it("prefills the requested usual day and handles short/overnight schedules", () => {
    expect(oregonScheduleBreaks("07:00", "16:30")).toEqual({
      paidBreak: 20,
      unpaidBreak: 30,
    });
    expect(oregonScheduleBreaks("08:00", "10:00")).toEqual({
      paidBreak: 0,
      unpaidBreak: 0,
    });
    expect(oregonScheduleBreaks("08:00", "12:00")).toEqual({
      paidBreak: 10,
      unpaidBreak: 0,
    });
    expect(oregonScheduleBreaks("22:00", "06:30")).toEqual({
      paidBreak: 20,
      unpaidBreak: 30,
    });
  });
  it("labels noon/midnight in AM/PM without rounding exact recorded minutes", () => {
    expect(displayTime("00:00")).toBe("12:00 AM");
    expect(displayTime("12:00")).toBe("12:00 PM");
    expect(displayTime("16:30")).toBe("4:30 PM");
    expect(displayTime("07:07")).toBe("7:07 AM");
    expect(displayTime("24:00")).toBe("12:00 AM (next day)");
    expect(QUARTER_HOUR_TIMES).toHaveLength(96);
    expect(QUARTER_HOUR_TIMES[1]).toBe("00:15");
  });
  it("keeps two separate paid allowances, no fictional punch times, and correct work totals", () => {
    const employee: Employee = {
      id: "demo",
      staff_person: "Demo",
      name: "Demo",
      email: "demo@example.test",
      pay_basis: "hourly",
      payroll_id: "",
      enabled: true,
      starts_on: "2026-09-15",
      ends_on: null,
      manager_id: "manager",
      version: 1,
      schedule: {
        weekdays: [2],
        start: "07:00",
        end: "16:30",
        breakRule: "oregon_adult",
        paidBreak: 20,
        unpaidBreak: 30,
      },
    };
    const days = buildDays(employee, "2026-09-15", "2026-09-15");
    expect(totals(days).scheduled).toBe(540);
    expect(
      days[0].shifts[0].breaks.filter((b) => b.paid).map((b) => b.minutes),
    ).toEqual([10, 10]);
    expect(
      days[0].shifts[0].breaks.every((b) => b.start === null && b.end === null),
    ).toBe(true);
    expect(() => validateDays(days, "2026-09-15", "2026-09-15")).not.toThrow();
  });
});
