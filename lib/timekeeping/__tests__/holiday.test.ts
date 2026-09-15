import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { blankDay, totals, validateDays, wallTime, type Sheet } from "../model";
import { createEmployeePreview } from "../preview";
import { payrollWorkbook } from "../export";
import type { TimekeepingBoot } from "../client";

const now = new Date("2026-09-21T16:00:00Z");

describe("holiday time", () => {
  it.each(["2026-09-07", "2026-09-06"])(
    "accepts holiday hours on %s without counting them as worked time",
    (date) => {
      const day = {
        ...blankDay(date),
        leave: [{ kind: "holiday" as const, minutes: 480 }],
      };
      expect(() => validateDays([day], date, date, true, now)).not.toThrow();
      expect(totals([day])).toMatchObject({
        holiday: 480,
        worked: 0,
        scheduled: 0,
        vacation: 0,
        sick: 0,
      });
    },
  );
  it("keeps partial holiday and actual work separate", () => {
    const date = "2026-09-07";
    const day = {
      ...blankDay(date),
      shifts: [
        {
          id: "work",
          source: "manual" as const,
          start: wallTime(date, "08:00"),
          end: wallTime(date, "12:00"),
          breaks: [],
        },
      ],
      leave: [{ kind: "holiday" as const, minutes: 240 }],
    };
    expect(() => validateDays([day], date, date, true, now)).not.toThrow();
    expect(totals([day])).toMatchObject({ worked: 240, holiday: 240 });
    expect(() =>
      validateDays(
        [{ ...day, leave: [...day.leave, ...day.leave] }],
        date,
        date,
        true,
        now,
      ),
    ).toThrow("category");
  });
  it("retains saved holiday hours through applying defaults and signing, and reconciles Excel totals", async () => {
    const api = createEmployeePreview("completed-period", () => now);
    const { sheet: initial } = await api<TimekeepingBoot>();
    const days = structuredClone(initial!.days);
    const holiday = days.find((d) => d.date === "2026-09-07")!;
    Object.assign(holiday, {
      off: false,
      shifts: [],
      leave: [{ kind: "holiday", minutes: 480 }],
      note: "Labor Day",
    });
    const saved = await api<Sheet>("", {
      op: "save",
      sheetId: initial!.id,
      version: initial!.version,
      days,
      note: initial!.note,
    });
    const refreshed = await api<Sheet>("", {
      op: "refresh",
      sheetId: saved.id,
      version: saved.version,
    });
    expect(refreshed.days.find((d) => d.date === holiday.date)).toMatchObject({
      leave: holiday.leave,
      shifts: [],
      note: "Labor Day",
    });
    const signed = await api<Sheet>("", {
      op: "submit",
      sheetId: saved.id,
      version: refreshed.version,
      attested: true,
    });
    expect(totals(signed.days).holiday).toBe(480);
    const workbook = XLSX.read(
      payrollWorkbook({
        periodStart: signed.period_start,
        periodEnd: signed.period_end,
        generatedAt: now.toISOString(),
        createdBy: "admin@example.test",
        version: 1,
        sheets: [{ ...signed, state: "approved" }],
      }),
      { type: "array" },
    );
    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets.Summary,
    );
    const daily = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets["Daily detail"],
    );
    expect(summary[0]["Holiday hours"]).toBe(8);
    expect(summary[0]["Holiday hours"]).toBe(
      daily.reduce((sum, d) => sum + Number(d["Holiday hours"]), 0),
    );
    expect(daily.find((d) => d.Date === holiday.date)).toMatchObject({
      "Holiday hours": 8,
      "Worked hours": 0,
      Notes: "Labor Day",
    });
    expect(summary[0]["Worked hours"]).toBe(totals(signed.days).worked / 60);
  });
});
