import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { payrollHours, weekStart, type PayrollSource } from "../overtime";
import { blankDay, dates, wallTime, type Day, type Sheet } from "../model";
import { payrollWorkbook } from "../export";

const day = (date: string, minutes: number, emergency = false): Day => ({
  ...blankDay(date),
  off: minutes === 0,
  shifts: minutes
    ? [
        {
          id: date,
          start: wallTime(date, "00:00"),
          end: new Date(
            Date.parse(wallTime(date, "00:00")) + minutes * 60000,
          ).toISOString(),
          source: "manual",
          breaks: [],
          emergencyAfterHours: emergency,
        },
      ]
    : [],
});
const sheet = (start: string, end: string, days: Day[]): Sheet => ({
  id: start,
  employee_id: "employee",
  employee_name: "Employee",
  period_start: start,
  period_end: end,
  state: "approved",
  days,
  note: "",
  pay_basis: "hourly",
  version: 1,
  review_manager_id: "manager",
  payroll_id: "PAY1",
  reason: "",
  approved_by: "manager@example.test",
  approved_at: "2026-09-16T12:00:00Z",
});
function source(
  days: Day[],
  start = "2026-09-06",
  end = "2026-09-12",
): PayrollSource {
  return {
    periodStart: start,
    periodEnd: end,
    sheets: [sheet(start, end, days)],
    overtime: {
      version: 1,
      employees: [{ id: "employee", overtime_status: "non_exempt" }],
      precedingSheets: [],
      openings: [],
    },
  };
}
const calculate = (s: PayrollSource) => payrollHours(s, s.sheets[0]);

describe("Oregon weekly overtime and company emergency premium", () => {
  it("uses Sunday-Saturday across month and year boundaries", () => {
    expect(weekStart("2026-09-06")).toBe("2026-09-06");
    expect(weekStart("2026-09-12")).toBe("2026-09-06");
    expect(weekStart("2027-01-01")).toBe("2026-12-27");
  });
  it("pays only time above 40, counts paid breaks, and excludes leave and unpaid breaks", () => {
    const days = dates("2026-09-07", "2026-09-11").map((d) => day(d, 540));
    for (const d of days)
      d.shifts[0].breaks = [
        { id: "lunch", start: null, end: null, minutes: 60, paid: false },
        { id: "rest", start: null, end: null, minutes: 20, paid: true },
      ];
    days[0].leave = [{ kind: "holiday", minutes: 480 }];
    const result = calculate(source(days));
    expect(result.summary.worked).toBe(2400);
    expect(result.summary.weeklyOvertime).toBe(0);
    expect(result.summary.regular).toBe(2400);
    days.push(day("2026-09-12", 15));
    expect(calculate(source(days)).summary.weeklyOvertime).toBe(15);
  });
  it("does not average a long week with a short week", () => {
    const s = source(
      [
        day("2026-09-06", 1440),
        day("2026-09-07", 1260),
        day("2026-09-13", 1200),
        day("2026-09-14", 900),
      ],
      "2026-09-06",
      "2026-09-19",
    );
    const result = calculate(s);
    expect(result.summary.worked).toBe(4800);
    expect(result.summary.weeklyOvertime).toBe(300);
  });
  it("pays emergency time below 40 and counts those hours toward 40", () => {
    const s = source([
      day("2026-09-06", 120, true),
      ...dates("2026-09-07", "2026-09-11").map((d) => day(d, 480)),
    ]);
    const r = calculate(s).summary;
    expect(r.worked).toBe(2520);
    expect(r.weeklyOvertime).toBe(120);
    expect(r.emergencyAdditional).toBe(120);
    expect(r.premium).toBe(240);
    expect(r.regular + r.premium).toBe(r.worked);
  });
  it("never pays the same hour twice when weekly overtime and emergency overlap", () => {
    const s = source([
      ...dates("2026-09-07", "2026-09-11").map((d) => day(d, 480)),
      day("2026-09-12", 120, true),
    ]);
    const r = calculate(s).summary;
    expect(r.weeklyOvertime).toBe(120);
    expect(r.overlap).toBe(120);
    expect(r.emergencyAdditional).toBe(0);
    expect(r.premium).toBe(120);
    expect(r.regular).toBe(2400);
  });
  it("carries approved prior-period hours forward without paying them again", () => {
    const s = source([day("2026-09-16", 600)], "2026-09-16", "2026-09-30");
    s.overtime!.precedingSheets = [
      sheet("2026-09-01", "2026-09-15", [
        day("2026-09-13", 480),
        day("2026-09-14", 960),
        day("2026-09-15", 480),
      ]),
    ];
    const r = calculate(s);
    expect(r.issues).toEqual([]);
    expect(r.weeks[0].priorWorked).toBe(1920);
    expect(r.summary.worked).toBe(600);
    expect(r.summary.weeklyOvertime).toBe(120);
    expect(r.summary.regular).toBe(480);
    expect(r.weeks.at(-1)?.continues).toBe(true);
  });
  it("keeps missing or unapproved prior time visible, accepts explicitly confirmed zero", () => {
    const s = source([day("2026-09-16", 480)], "2026-09-16", "2026-09-30");
    expect(
      calculate(s).issues.some((x) => x.includes("Prior payroll hours needed")),
    ).toBe(true);
    s.overtime!.openings = [
      {
        employee_id: "employee",
        period_start: s.periodStart,
        worked_minutes: 0,
        note: "Confirmed no prior work",
      },
    ];
    expect(calculate(s).issues).toEqual([]);
    s.overtime!.openings[0].worked_minutes = 2400;
    expect(calculate(s).summary.weeklyOvertime).toBe(480);
  });
  it("does not infer salary exemption; confirmed exempt staff retain company emergency pay", () => {
    const s = source([day("2026-09-06", 1440), day("2026-09-07", 1440, true)]);
    s.sheets[0].pay_basis = "salary";
    expect(calculate(s).summary.weeklyOvertime).toBe(480);
    s.overtime!.employees[0].overtime_status = "exempt";
    const r = calculate(s).summary;
    expect(r.weeklyOvertime).toBe(0);
    expect(r.premium).toBe(1440);
  });
  it("requires specific interval classification for legacy emergency-day flags", () => {
    const d = day("2026-09-07", 480);
    d.emergency = true;
    delete d.shifts[0].emergencyAfterHours;
    const s = source([d]);
    expect(calculate(s).issues[0]).toContain("identify after-hours");
    d.shifts[0].emergencyAfterHours = false;
    expect(calculate(s).issues).toEqual([]);
  });
  it("treats phone carrying as a stipend record, not emergency work or an export error", () => {
    const d = day("2026-09-07", 480);
    d.emergencyPhone = true;
    delete d.shifts[0].emergencyAfterHours;
    const s = source([d]);
    expect(calculate(s).issues).toEqual([]);
    expect(calculate(s).summary.emergencyAdditional).toBe(0);
    const wb = XLSX.read(
      payrollWorkbook({
        ...s,
        version: 1,
        createdBy: "admin@example.test",
        generatedAt: "2026-09-16T12:00:00Z",
      }),
      { type: "array" },
    );
    const row = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets.Summary,
    )[0];
    expect(row["Phone carrying days (stipend)"]).toBe(1);
    expect(row["Regular worked hours (1x)"]).toBe(8);
    expect(row["Total hours at 1.5x (included)"]).toBe(0);
    d.shifts[0].emergencyAfterHours = true;
    expect(calculate(s).summary.emergencyAdditional).toBe(480);
  });
  it("rebuilds a clearly marked review copy without turning missing prior payroll into zero overtime", () => {
    const s = source([day("2026-09-16", 480)], "2026-09-16", "2026-09-30");
    const snapshot = {
      ...s,
      version: 0,
      createdBy: "admin@example.test",
      generatedAt: "2026-09-16T12:00:00Z",
    };
    expect(() => payrollWorkbook(snapshot)).toThrow(
      "Prior payroll hours needed",
    );
    const wb = XLSX.read(payrollWorkbook(snapshot, { review: true }), {
      type: "array",
    });
    const row = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets.Summary,
    )[0];
    expect(row["Report status"]).toBe("REVIEW COPY - NOT FOR PAYROLL");
    expect(row["Worked hours"]).toBe(8);
    expect(row["Weekly overtime hours (1.5x)"]).toBe("Pending payroll inputs");
    expect(row["Review notes"]).toContain("Prior payroll hours needed");
  });
  it("uses elapsed minutes through daylight-saving time changes", () => {
    const d = day("2026-11-01", 0);
    d.off = false;
    d.shifts = [
      {
        id: "dst",
        start: "2026-11-01T07:00:00Z",
        end: "2026-11-01T11:00:00Z",
        source: "clocked",
        breaks: [],
        emergencyAfterHours: true,
      },
    ];
    expect(
      calculate(source([d], "2026-11-01", "2026-11-15")).summary.emergency,
    ).toBe(240);
  });
  it("exports reconciled categories and an auditable weekly calculation", () => {
    const s = source([
      ...dates("2026-09-07", "2026-09-11").map((d) => day(d, 480)),
      day("2026-09-12", 120, true),
    ]);
    const wb = XLSX.read(
      payrollWorkbook({
        ...s,
        version: 1,
        createdBy: "admin@example.test",
        generatedAt: "2026-09-16T12:00:00Z",
      }),
      { type: "array" },
    );
    const summary = XLSX.utils.sheet_to_json<Record<string, number>>(
      wb.Sheets.Summary,
    )[0];
    expect(summary["Worked hours"]).toBe(42);
    expect(summary["Regular worked hours (1x)"]).toBe(40);
    expect(summary["Weekly overtime hours (1.5x)"]).toBe(2);
    expect(summary["Additional emergency hours (1.5x)"]).toBe(0);
    expect(summary["Total hours at 1.5x (included)"]).toBe(2);
    expect(wb.SheetNames).toContain("Weekly overtime");
    s.overtime!.employees[0].overtime_status = "unconfirmed";
    expect(() =>
      payrollWorkbook({
        ...s,
        version: 1,
        createdBy: "admin@example.test",
        generatedAt: "2026-09-16T12:00:00Z",
      }),
    ).toThrow("Confirm overtime eligibility");
  });
});
