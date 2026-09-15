import { describe, expect, it } from "vitest";
import { invoiceReportPeriods } from "../invoice-report-periods";

describe("invoice report date presets", () => {
  it("keeps the existing semi-monthly periods and adds inclusive Monday–Sunday weeks", () => {
    const result = invoiceReportPeriods(new Date("2026-09-15T19:00:00Z"));
    expect(result.payroll.map(({ from, to }) => [from, to])).toEqual([
      ["2026-09-01", "2026-09-15"],
      ["2026-08-16", "2026-08-31"],
      ["2026-08-01", "2026-08-15"],
    ]);
    expect(result.weeks.map(({ from, to }) => [from, to])).toEqual([
      ["2026-09-14", "2026-09-20"],
      ["2026-09-07", "2026-09-13"],
      ["2026-08-31", "2026-09-06"],
    ]);
  });
  it("keeps Pacific Sunday in the previous week when UTC is already Monday", () => {
    expect(
      invoiceReportPeriods(new Date("2026-09-14T06:59:59Z")).weeks[0],
    ).toMatchObject({ from: "2026-09-07", to: "2026-09-13" });
    expect(
      invoiceReportPeriods(new Date("2026-09-14T07:00:00Z")).weeks[0],
    ).toMatchObject({ from: "2026-09-14", to: "2026-09-20" });
  });
  it("handles leap February and periods crossing New Year", () => {
    expect(
      invoiceReportPeriods(new Date("2028-02-29T20:00:00Z")).payroll[0],
    ).toMatchObject({ from: "2028-02-16", to: "2028-02-29" });
    const result = invoiceReportPeriods(new Date("2027-01-01T20:00:00Z"));
    expect(result.payroll[1]).toMatchObject({
      from: "2026-12-16",
      to: "2026-12-31",
    });
    expect(result.weeks[0]).toMatchObject({
      from: "2026-12-28",
      to: "2027-01-03",
    });
  });
  it("retains seven calendar days across daylight saving changes", () => {
    expect(
      invoiceReportPeriods(new Date("2026-03-08T20:00:00Z")).weeks[0],
    ).toMatchObject({ from: "2026-03-02", to: "2026-03-08" });
    expect(
      invoiceReportPeriods(new Date("2026-11-01T20:00:00Z")).weeks[0],
    ).toMatchObject({ from: "2026-10-26", to: "2026-11-01" });
  });
});
