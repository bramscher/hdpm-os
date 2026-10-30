import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  addDays,
  blankDay,
  buildDays,
  canReadSheet,
  confirmDays,
  currentSheet,
  periodFor,
  splitShift,
  totals,
  validateDays,
  validateSchedule,
  wallTime,
  type Employee,
  type Sheet,
  type Shift,
  prefilledDates,
} from "../model";
import { payrollWorkbook } from "../export";

const employee: Employee = {
  id: "employee",
  staff_person: "Employee",
  name: "Example Employee",
  email: "employee@example.test",
  payroll_id: "PAY-1",
  pay_basis: "salary",
  manager_id: "manager",
  enabled: true,
  starts_on: "2026-01-01",
  ends_on: null,
  schedule: {
    weekdays: [1, 2, 3, 4, 5],
    start: "08:00",
    end: "17:00",
    unpaidBreak: 30,
    paidBreak: 20,
  },
  version: 1,
};
const sheet = (overrides: Partial<Sheet> = {}): Sheet => ({
  id: "sheet",
  employee_id: employee.id,
  period_start: "2026-09-01",
  period_end: "2026-09-15",
  state: "draft",
  days: buildDays(employee, "2026-09-01", "2026-09-15"),
  note: "Period note",
  pay_basis: "salary",
  version: 1,
  review_manager_id: "manager",
  employee_name: employee.name,
  payroll_id: employee.payroll_id,
  reason: "",
  approved_by: null,
  approved_at: null,
  ...overrides,
});
const now = new Date("2026-10-01T20:00:00Z");
describe("pay periods and schedules", () => {
  it("covers 1–15 and 16–month-end including leap years and year-end", () => {
    expect(periodFor("2028-02-16")).toEqual({
      start: "2028-02-16",
      end: "2028-02-29",
    });
    expect(periodFor("2026-02-28").end).toBe("2026-02-28");
    expect(periodFor("2026-09-15").start).toBe("2026-09-01");
    expect(periodFor("2026-12-31").end).toBe("2026-12-31");
    expect(periodFor(addDays("2026-12-31", 1)).start).toBe("2027-01-01");
    expect(() => periodFor("2026-02-30")).toThrow();
  });
  it("prefills weekdays without manufacturing confirmed time, respects enrollment", () => {
    const days = buildDays(
      { ...employee, starts_on: "2026-09-03" },
      "2026-09-01",
      "2026-09-15",
    );
    expect(days[0].off).toBe(true);
    expect(days[5].off).toBe(true);
    expect(days[2].shifts[0].source).toBe("scheduled");
    expect(totals(days).worked).toBe(0);
    expect(totals([days[2]]).scheduled).toBe(510);
  });
  it("counts paid breaks once and deducts only unpaid breaks", () => {
    const day = confirmDays(buildDays(employee, "2026-09-01", "2026-09-01"));
    const t = totals(day);
    expect(t.worked).toBe(510);
    expect(t.unpaidBreak).toBe(30);
    expect(t.paidBreak).toBe(20);
  });
  it("rejects ambiguous and skipped DST wall times", () => {
    expect(() => wallTime("2026-03-08", "02:30")).toThrow("daylight");
    expect(() => wallTime("2026-11-01", "01:30")).toThrow("daylight");
    expect(wallTime("2026-09-15", "08:00")).toBe("2026-09-15T15:00:00.000Z");
  });
  it("splits overnight work and timed breaks across the cutoff exactly once", () => {
    const s: Shift = {
      id: "night",
      source: "clocked",
      start: wallTime("2026-09-15", "22:00"),
      end: wallTime("2026-09-16", "02:00"),
      breaks: [
        {
          id: "break",
          start: wallTime("2026-09-15", "23:45"),
          end: wallTime("2026-09-16", "00:15"),
          minutes: 0,
          paid: false,
        },
      ],
    };
    const parts = splitShift(s);
    expect(parts.map((p) => p.date)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(
      parts.map(
        (p) => totals([{ ...blankDay(p.date), shifts: [p.shift] }]).worked,
      ),
    ).toEqual([105, 105]);
  });
  it("preserves real elapsed time through a daylight-saving shift", () => {
    const parts = splitShift({
      id: "dst",
      source: "clocked",
      start: "2026-11-01T07:00:00Z",
      end: "2026-11-01T11:00:00Z",
      breaks: [],
    });
    expect(
      totals(parts.map((p) => ({ ...blankDay(p.date), shifts: [p.shift] })))
        .worked,
    ).toBe(240);
  });
  it("does not prefill work without a personal schedule", () => {
    expect(
      buildDays(
        { ...employee, schedule: null },
        "2026-09-01",
        "2026-09-15",
      ).every((d) => !d.shifts.length),
    ).toBe(true);
  });
  it("validates default break duration and weekday input", () => {
    expect(() =>
      validateSchedule({ ...employee.schedule, weekdays: [1, 1] }),
    ).toThrow();
    expect(() =>
      validateSchedule({
        ...employee.schedule,
        start: "08:00",
        end: "09:00",
        unpaidBreak: 90,
      }),
    ).toThrow();
  });
});
describe("daily entries and submission", () => {
  it("separates partial work, vacation, LOA and fractional miles", () => {
    const d = {
      ...blankDay("2026-09-01"),
      shifts: [
        {
          id: "half",
          source: "manual" as const,
          start: wallTime("2026-09-01", "08:00"),
          end: wallTime("2026-09-01", "12:00"),
          breaks: [],
        },
      ],
      leave: [{ kind: "vacation" as const, minutes: 240 }],
      miles: 12.5,
    };
    validateDays([d], d.date, d.date, true, now);
    expect(totals([d])).toMatchObject({
      worked: 240,
      vacation: 240,
      miles: 12.5,
    });
  });
  it("requires explicit no-work confirmation and accepts planned future hours", () => {
    const d = blankDay("2026-09-01");
    expect(() => validateDays([d], d.date, d.date, true, now)).toThrow(
      "confirm no work",
    );
    expect(() =>
      validateDays([{ ...d, off: true }], d.date, d.date, true, now),
    ).not.toThrow();
    const future = buildDays(employee, "2026-09-01", "2026-09-01");
    expect(() =>
      validateDays(
        future,
        d.date,
        d.date,
        true,
        new Date("2026-09-01T15:00:00Z"),
      ),
    ).not.toThrow();
  });
  it.each([
    "2026-09-15",
    "2026-09-30",
    "2027-02-28",
    "2028-02-29",
    "2026-12-31",
  ])("accepts planned final-day hours on %s before departure", (date) => {
    const period = periodFor(date);
    const days = buildDays(
      {
        ...employee,
        schedule: { ...employee.schedule!, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
      period.start,
      period.end,
    );
    const morning = new Date(wallTime(date, "09:00"));
    for (const draft of [days, confirmDays(days)]) {
      expect(() =>
        validateDays(draft, period.start, period.end, false, morning),
      ).not.toThrow();
      expect(() =>
        validateDays(draft, period.start, period.end, true, morning),
      ).not.toThrow();
    }
    const clocked = structuredClone(days);
    clocked.at(-1)!.shifts[0].source = "clocked";
    expect(() =>
      validateDays(clocked, period.start, period.end, true, morning),
    ).toThrow("clocked work cannot end in the future");
  });
  it("accepts signing any day of the period, with planned hours ahead", () => {
    const days = buildDays(employee, "2026-09-01", "2026-09-15");
    const midPeriod = new Date("2026-09-08T17:00:00Z"); // Sep 8, 10 AM Pacific
    expect(() =>
      validateDays(days, "2026-09-01", "2026-09-15", true, midPeriod),
    ).not.toThrow();
    expect(() =>
      validateDays(
        confirmDays(days),
        "2026-09-01",
        "2026-09-15",
        true,
        midPeriod,
      ),
    ).not.toThrow();
    expect(() =>
      validateDays(
        days.map((d) => ({ ...d, off: true, shifts: [] })),
        "2026-09-01",
        "2026-09-15",
        true,
        midPeriod,
      ),
    ).not.toThrow();
    // Days ahead still need time or "no work" before signing.
    const blank = days.map((d) =>
      d.date === "2026-09-12" ? { ...d, off: false, shifts: [], leave: [] } : d,
    );
    expect(() =>
      validateDays(blank, "2026-09-01", "2026-09-15", true, midPeriod),
    ).toThrow("2026-09-12: enter time or confirm no work");
    // Clock punches still cannot claim future work.
    const clocked = structuredClone(days);
    const later = clocked.find((d) => d.date > "2026-09-08" && d.shifts.length)!;
    later.shifts[0].source = "clocked";
    expect(() =>
      validateDays(clocked, "2026-09-01", "2026-09-15", true, midPeriod),
    ).toThrow("clocked work cannot end in the future");
  });
  it("rejects overlap, missing ends and breaks outside a shift", () => {
    const d = confirmDays(buildDays(employee, "2026-09-01", "2026-09-01"))[0];
    expect(() =>
      validateDays(
        [{ ...d, shifts: [d.shifts[0], { ...d.shifts[0], id: "duplicate" }] }],
        d.date,
        d.date,
        false,
        now,
      ),
    ).toThrow("nonoverlapping");
    expect(() =>
      validateDays(
        [{ ...d, shifts: [{ ...d.shifts[0], end: null }] }],
        d.date,
        d.date,
        false,
        now,
      ),
    ).toThrow();
    const shift = structuredClone(d.shifts[0]);
    shift.breaks[0].start = wallTime(d.date, "07:00");
    expect(() =>
      validateDays([{ ...d, shifts: [shift] }], d.date, d.date, false, now),
    ).toThrow("breaks must fit");
  });
  it("rejects leave mixed with an unadjusted default and duplicate leave categories", () => {
    const d = buildDays(employee, "2026-09-01", "2026-09-01")[0];
    expect(() =>
      validateDays(
        [{ ...d, leave: [{ kind: "sick", minutes: 120 }] }],
        d.date,
        d.date,
        false,
        now,
      ),
    ).toThrow("adjust");
    expect(() =>
      validateDays(
        [
          {
            ...blankDay(d.date),
            leave: [
              { kind: "sick", minutes: 60 },
              { kind: "sick", minutes: 60 },
            ],
          },
        ],
        d.date,
        d.date,
        false,
        now,
      ),
    ).toThrow("category");
  });
  it("retains notes and requires the complete day set", () => {
    const s = sheet();
    s.days[0].note = "Travel to property";
    expect(validateDays(s.days, s.period_start, s.period_end)[0].note).toBe(
      "Travel to property",
    );
    expect(() =>
      validateDays(s.days.slice(1), s.period_start, s.period_end),
    ).toThrow("every day");
  });
});
describe("access and payroll", () => {
  it("keeps active work separate while allowing employees to read their submitted history", () => {
    const old = sheet(),
      current = sheet({
        id: "new",
        period_start: "2026-09-16",
        period_end: "2026-09-30",
      });
    expect(currentSheet([current, old], "2026-09-17")?.id).toBe("sheet");
    expect(
      currentSheet([current, { ...old, state: "submitted" }], "2026-09-17")?.id,
    ).toBe("new");
    expect(canReadSheet(old, "employee", false, "new")).toBe(false);
    for (const state of ["submitted", "approved", "returned"] as const) {
      const historic = { ...old, state };
      expect(canReadSheet(historic, "employee", false, "new")).toBe(true);
      expect(canReadSheet(historic, "other", false, "new")).toBe(false);
    }
    expect(canReadSheet(old, "manager", false, "new")).toBe(false);
    expect(canReadSheet(old, "other", false, "new")).toBe(false);
    expect(canReadSheet(old, "admin", true, "new")).toBe(true);
  });
  it("exports salary, notes, approval and reconciled daily totals without formulas from user text", () => {
    const s = sheet({
      days: confirmDays(sheet().days),
      state: "approved",
      approved_by: "manager@example.test",
      approved_at: "2026-09-16T00:00:00Z",
      employee_signed_by: employee.email,
      employee_signed_name: employee.name,
      employee_signed_at: "2026-09-15T12:00:00-07:00",
      employee_signed_version: 3,
      employee_attestation: "Employee certification",
      note: '=HYPERLINK("https://example.test")',
    });
    const bytes = payrollWorkbook({
      periodStart: s.period_start,
      periodEnd: s.period_end,
      generatedAt: "2026-09-16T01:00:00Z",
      createdBy: "admin@example.test",
      version: 1,
      sheets: [s],
    });
    const wb = XLSX.read(bytes, { type: "array" });
    expect(wb.SheetNames).toContain("Summary");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets.Summary,
      ),
      daily = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets["Daily detail"],
      );
    expect(rows[0]["Employee signed by"]).toBe(employee.email);
    expect(rows[0]["Employee signed at (UTC)"]).toBe(
      "2026-09-15T19:00:00.000Z",
    );
    expect(rows[0]["Employee signed version"]).toBe(3);
    expect(rows[0]["Pay basis"]).toBe("SALARY");
    expect(rows[0]["Period notes"]).toBe(s.note);
    expect(rows[0]["Worked hours"]).toBe(
      daily.reduce((n, r) => n + Number(r["Worked hours"]), 0),
    );
    expect(
      Object.values(wb.Sheets.Summary).some(
        (c) => typeof c === "object" && c && "f" in c,
      ),
    ).toBe(false);
  });
});

describe("prefilledDates", () => {
  const days = buildDays(employee, "2026-09-01", "2026-09-15");
  const base = { days, pay_basis: "hourly" as const };
  it("flags hourly days whose shifts end after the signature", () => {
    const signedAt = wallTime("2026-09-08", "10:00");
    const flagged = prefilledDates({ ...base, employee_signed_at: signedAt });
    const expected = days
      .filter((d) => d.shifts.some((s) => Date.parse(s.end!) > Date.parse(signedAt)))
      .map((d) => d.date);
    expect(flagged).toEqual(expected);
    // Sep 8 itself counts (planned end later that day); Sep 7 and earlier don't.
    expect(flagged.every((d) => d >= "2026-09-08")).toBe(true);
    expect(flagged.length).toBeGreaterThan(0);
  });
  it("flags nothing when signed after the last shift, unsigned, or salaried", () => {
    expect(
      prefilledDates({ ...base, employee_signed_at: wallTime("2026-09-16", "08:00") }),
    ).toEqual([]);
    expect(prefilledDates({ ...base, employee_signed_at: null })).toEqual([]);
    expect(
      prefilledDates({
        ...base,
        pay_basis: "salary",
        employee_signed_at: wallTime("2026-09-08", "10:00"),
      }),
    ).toEqual([]);
  });
});
