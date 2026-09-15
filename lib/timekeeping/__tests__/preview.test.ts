import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmployeePreview } from "../preview";
import type { TimekeepingBoot } from "../client";
import {
  DEFAULT_SCHEDULE,
  totals,
  type Sheet,
  type Employee,
  type Clock,
} from "../model";
afterEach(() => vi.unstubAllGlobals());
describe("isolated employee preview", () => {
  it("lets an employee configure defaults without making any network requests", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Preview must not call the network");
    });
    vi.stubGlobal("fetch", fetch);
    const request = createEmployeePreview(
      "first-visit",
      () => new Date("2026-09-21T16:00:00Z"),
    );
    const first = await request<TimekeepingBoot>();
    expect(first.isAdmin).toBe(false);
    expect(first.canReview).toBe(false);
    expect(first.employees).toEqual([]);
    expect(first.employee.schedule).toBeNull();
    expect(first.employee.starts_on).toBe("2026-09-16");
    await expect(
      request("", { op: "refresh", sheetId: first.sheet!.id, version: 1 }),
    ).rejects.toThrow("My defaults");
    const employee = await request<Employee>("", {
      op: "schedule",
      version: 1,
      schedule: {
        weekdays: [1, 2, 3, 4, 5],
        start: "08:00",
        end: "17:00",
        unpaidBreak: 30,
        paidBreak: 20,
      },
    });
    expect(employee.schedule?.start).toBe("08:00");
    const sheet = await request<Sheet>("", {
      op: "refresh",
      sheetId: first.sheet!.id,
      version: 1,
    });
    expect(
      sheet.days.find((d) => d.date === "2026-09-21")?.shifts,
    ).toHaveLength(1);
    expect(
      sheet.days.find((d) => d.date === "2026-09-16")?.shifts,
    ).toHaveLength(1);
    expect(sheet.days.find((d) => d.date === "2026-09-19")?.off).toBe(true);
    expect(sheet.days.filter((d) => d.shifts.length)).toHaveLength(11);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fills the full first-visit period on its last day and preserves exceptions when reapplied", async () => {
    const request = createEmployeePreview(
      "first-visit",
      () => new Date("2026-09-15T20:00:00Z"),
    );
    const boot = await request<TimekeepingBoot>();
    await request("", {
      op: "schedule",
      version: 1,
      schedule: DEFAULT_SCHEDULE,
    });
    const first = await request<Sheet>("", {
      op: "refresh",
      sheetId: boot.sheet!.id,
      version: 1,
    });
    expect(first.days.filter((d) => d.shifts.length)).toHaveLength(11);
    expect(totals(first.days).scheduled).toBe(11 * 510);
    first.days[0].note = "Keep this exception";
    const saved = await request<Sheet>("", {
      op: "save",
      sheetId: first.id,
      version: first.version,
      days: first.days,
      note: "",
    });
    await request("", {
      op: "schedule",
      version: 2,
      schedule: { ...DEFAULT_SCHEDULE, start: "07:15" },
    });
    const refreshed = await request<Sheet>("", {
      op: "refresh",
      sheetId: saved.id,
      version: saved.version,
    });
    expect(refreshed.days[0]).toEqual(saved.days[0]);
    expect(refreshed.days[1].shifts[0].start).not.toBe(
      saved.days[1].shifts[0].start,
    );
  });
  it("saves exceptions, simulates signature, advances periods, and resets in a new instance", async () => {
    const request = createEmployeePreview(
      "completed-period",
      () => new Date("2026-09-21T16:00:00Z"),
    );
    const initial = await request<TimekeepingBoot>(),
      s = initial.sheet!;
    const saved = await request<Sheet>("", {
      op: "save",
      sheetId: s.id,
      version: s.version,
      days: s.days,
      note: "Preview test note",
    });
    expect((await request<TimekeepingBoot>()).sheet?.note).toBe(
      "Preview test note",
    );
    await expect(
      request("", { op: "submit", sheetId: s.id, version: saved.version }),
    ).rejects.toThrow("signature");
    const signed = await request<Sheet>("", {
      op: "submit",
      sheetId: s.id,
      version: saved.version,
      attested: true,
    });
    expect(signed.employee_signed_by).toBe("taylor@example.test");
    expect(signed.state).toBe("submitted");
    expect(signed.employee_signed_at).toBe("2026-09-21T16:00:00.000Z");
    expect((await request<TimekeepingBoot>()).sheet?.period_start).toBe(
      "2026-09-16",
    );
    const reset = await createEmployeePreview(
      "completed-period",
      () => new Date("2026-09-21T16:00:00Z"),
    )<TimekeepingBoot>();
    expect(reset.sheet?.state).toBe("draft");
    expect(reset.sheet?.note).not.toBe("Preview test note");
    await expect(request("?view=exports")).rejects.toThrow("only the employee");
  });
  it("keeps actual clock/break durations within the fictional preview", async () => {
    let now = new Date("2026-09-21T16:00:00Z");
    const request = createEmployeePreview("first-visit", () => now);
    let clock = await request<Clock>("", {
      op: "clock",
      action: "in",
      clockVersion: 1,
    });
    now = new Date("2026-09-21T16:15:00Z");
    clock = await request<Clock>("", {
      op: "clock",
      action: "break",
      paid: false,
      clockVersion: clock.version,
    });
    now = new Date("2026-09-21T16:30:00Z");
    clock = await request<Clock>("", {
      op: "clock",
      action: "resume",
      clockVersion: clock.version,
    });
    now = new Date("2026-09-21T17:00:00Z");
    clock = await request<Clock>("", {
      op: "clock",
      action: "out",
      clockVersion: clock.version,
    });
    expect(clock.shift).toBeNull();
    expect(totals((await request<TimekeepingBoot>()).sheet!.days).worked).toBe(
      45,
    );
  });
});
