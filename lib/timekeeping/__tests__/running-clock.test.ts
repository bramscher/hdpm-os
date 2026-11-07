import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDays,
  type Clock,
  type Employee,
  type Sheet,
  type Shift,
} from "../model";
import {
  checkFixStart,
  lastClockOut,
  removePlanned,
  restorePlanned,
} from "../running-clock";
import { clockBody } from "@/lib/field-app/model";

const mock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  results: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: mock.from, rpc: mock.rpc }),
}));
vi.mock("@/lib/require-role", () => ({
  isCompanyEmail: (email?: string) => email?.endsWith("@highdesertpm.com"),
}));
import { command, clockFor } from "../server";

// Thursday 2026-01-08, 9:00 AM Pacific.
const NOW = new Date("2026-01-08T17:00:00Z");
const TODAY = "2026-01-08";
const worker: Employee = {
  id: "worker",
  staff_person: "Worker",
  name: "Test Worker",
  email: "worker@highdesertpm.com",
  payroll_id: "T-1",
  pay_basis: "hourly",
  manager_id: "admin",
  enabled: true,
  starts_on: "2026-01-01",
  ends_on: null,
  schedule: {
    weekdays: [1, 2, 3, 4, 5],
    start: "08:00",
    end: "17:00",
    paidBreak: 0,
    unpaidBreak: 0,
  },
  version: 1,
};
const admin: Employee = {
  ...worker,
  id: "admin",
  staff_person: "Admin",
  name: "Test Admin",
  email: "admin@highdesertpm.com",
};
const workerCtx = { email: worker.email, isAdmin: false, employee: worker };
const adminCtx = { email: admin.email, isAdmin: true, employee: admin };
const reviewerCtx = { ...adminCtx, isAdmin: false };

const planned = (e: Employee = worker): Sheet => ({
  id: "sheet",
  employee_id: e.id,
  period_start: "2026-01-01",
  period_end: "2026-01-15",
  days: buildDays(e, "2026-01-01", "2026-01-15"),
  state: "draft",
  note: "",
  pay_basis: "hourly",
  version: 3,
  review_manager_id: "admin",
  employee_name: e.name,
  payroll_id: e.payroll_id,
  reason: "",
  approved_at: null,
  approved_by: null,
});
/** The sheet as it is after clocking in today: today's planned hours are off. */
const clockedInSheet = (e: Employee = worker) =>
  removePlanned([planned(e)], TODAY)[0];
const running = (start = "2026-01-08T16:30:00.000Z"): Shift => ({
  id: "run",
  start,
  end: null,
  source: "clocked",
  breaks: [],
});
const clock = (shift: Shift | null = running()): Clock => ({
  employee_id: worker.id,
  version: 7,
  shift,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mock.results = [];
  mock.from.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "ilike",
      "order",
      "upsert",
      "single",
      "maybeSingle",
      "range",
      "in",
    ])
      chain[m] = () => chain;
    chain.then = (resolve: (value: unknown) => void) =>
      Promise.resolve({ data: mock.results.shift(), error: null }).then(
        resolve,
      );
    return chain;
  });
  mock.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});
afterEach(() => vi.useRealTimers());

/** Queue: getClock (upsert, select), ensureSheets (existing periods), ownSheets. */
const queueClock = (c: Clock, sheets: Sheet[]) =>
  mock.results.push(
    null,
    c,
    sheets.map((s) => ({ period_start: s.period_start })),
    sheets,
  );

describe("planned hours on clock-in and cancel", () => {
  it("cancel gives back exactly the planned hours clock-in took off", () => {
    const original = planned();
    const after = removePlanned([original], TODAY)[0];
    const today = after.days.find((d) => d.date === TODAY)!;
    expect(today.shifts).toEqual([]);
    expect(today.exception).toBe(true);
    expect(restorePlanned([after], worker, TODAY)[0].days).toEqual(
      original.days,
    );
  });
  it("restores tonight's carry-over into tomorrow for an overnight schedule", () => {
    const night = {
      ...worker,
      schedule: { ...worker.schedule!, start: "22:00", end: "06:00" },
    };
    const original = planned(night);
    const after = removePlanned([original], TODAY)[0];
    const tomorrow = after.days.find((d) => d.date === "2026-01-09")!;
    expect(tomorrow.shifts.some((s) => s.id.startsWith(`schedule:${TODAY}`))).toBe(false);
    expect(restorePlanned([after], night, TODAY)[0].days).toEqual(
      original.days,
    );
  });
  it("leaves days with real entries alone and skips locked sheets", () => {
    const after = clockedInSheet();
    const day = after.days.find((d) => d.date === TODAY)!;
    day.shifts = [
      {
        id: "earlier",
        start: "2026-01-08T14:00:00.000Z",
        end: "2026-01-08T15:00:00.000Z",
        source: "clocked",
        breaks: [],
      },
    ];
    expect(restorePlanned([after], worker, TODAY)).toEqual([]);
    expect(
      restorePlanned([{ ...clockedInSheet(), state: "submitted" }], worker, TODAY),
    ).toEqual([]);
  });
});

describe("fix-start limits", () => {
  const sheets = [clockedInSheet()];
  it("worker: in the past, today only", () => {
    expect(
      checkFixStart(running(), "2026-01-08T16:00:00.000Z", sheets, NOW, true),
    ).toBe("2026-01-08T16:00:00.000Z");
    expect(() =>
      checkFixStart(running(), "2026-01-08T17:30:00.000Z", sheets, NOW, true),
    ).toThrow("in the past");
    // 11 PM Pacific yesterday.
    expect(() =>
      checkFixStart(running(), "2026-01-08T07:00:00.000Z", sheets, NOW, true),
    ).toThrow("within today");
    expect(() => checkFixStart(running(), "nope", sheets, NOW, true)).toThrow(
      "valid start",
    );
  });
  it("not before the last clock-out", () => {
    const withShift = clockedInSheet();
    withShift.days.find((d) => d.date === TODAY)!.shifts = [
      {
        id: "early",
        start: "2026-01-08T14:00:00.000Z",
        end: "2026-01-08T15:45:00.000Z", // 7:45 AM
        source: "clocked",
        breaks: [],
      },
    ];
    expect(lastClockOut([withShift], NOW.getTime())).toBe(
      Date.parse("2026-01-08T15:45:00.000Z"),
    );
    expect(() =>
      checkFixStart(running(), "2026-01-08T15:30:00.000Z", [withShift], NOW, true),
    ).toThrow("last clock-out (2026-01-08 at 7:45 AM)");
    expect(
      checkFixStart(running(), "2026-01-08T15:45:00.000Z", [withShift], NOW, true),
    ).toBe("2026-01-08T15:45:00.000Z");
  });
  it("admin: older than today is fine, within 24 hours, and before the first break", () => {
    expect(
      checkFixStart(running(), "2026-01-08T07:00:00.000Z", sheets, NOW, false),
    ).toBe("2026-01-08T07:00:00.000Z");
    expect(() =>
      checkFixStart(running(), "2026-01-07T16:00:00.000Z", sheets, NOW, false),
    ).toThrow("24 hours");
    const onBreak = {
      ...running(),
      breaks: [
        {
          id: "b",
          start: "2026-01-08T16:40:00.000Z",
          end: null,
          minutes: 0,
          paid: false,
        },
      ],
    };
    expect(() =>
      checkFixStart(onBreak, "2026-01-08T16:45:00.000Z", sheets, NOW, false),
    ).toThrow("first break");
  });
});

describe("worker clock fixes", () => {
  it("fix start edits the running entry in place, with a reason", async () => {
    queueClock(clock(), [clockedInSheet()]);
    await command(workerCtx, {
      op: "clock",
      action: "fix_start",
      clockVersion: 7,
      start: "2026-01-08T16:00:00.000Z",
      reason: "Forgot to tap in",
    });
    const [name, args] = mock.rpc.mock.calls[0];
    expect(name).toBe("timekeeping_apply");
    expect(args).toEqual({
      p_actor: worker.email,
      p_request: {
        op: "clock",
        clockAction: "fix_start",
        clockVersion: 7,
        shift: { ...running(), start: "2026-01-08T16:00:00.000Z" },
        reason: "Forgot to tap in",
        sheets: [],
      },
    });
  });
  it("fix start needs a reason and keeps to today", async () => {
    queueClock(clock(), [clockedInSheet()]);
    await expect(
      command(workerCtx, {
        op: "clock",
        action: "fix_start",
        clockVersion: 7,
        start: "2026-01-08T16:00:00.000Z",
        reason: "  ",
      }),
    ).rejects.toThrow("Say why");
    queueClock(clock(), [clockedInSheet()]);
    await expect(
      command(workerCtx, {
        op: "clock",
        action: "fix_start",
        clockVersion: 7,
        start: "2026-01-07T20:00:00.000Z",
        reason: "Earlier",
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("within today") });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("cancel clears the running entry and gives back today's planned hours", async () => {
    queueClock(clock(), [clockedInSheet()]);
    await command(workerCtx, {
      op: "clock",
      action: "cancel",
      clockVersion: 7,
      reason: "Clocked in by mistake",
    });
    const request = mock.rpc.mock.calls[0][1].p_request;
    expect(request).toMatchObject({
      op: "clock",
      clockAction: "cancel",
      shift: null,
      reason: "Clocked in by mistake",
    });
    expect(request.sheets).toEqual([
      { id: "sheet", version: 3, days: planned().days },
    ]);
  });
  it("cancel needs a reason and a running clock", async () => {
    queueClock(clock(), [clockedInSheet()]);
    await expect(
      command(workerCtx, { op: "clock", action: "cancel", clockVersion: 7 }),
    ).rejects.toThrow("cancelling");
    queueClock(clock(null), [planned()]);
    await expect(
      command(workerCtx, {
        op: "clock",
        action: "cancel",
        clockVersion: 7,
        reason: "x",
      }),
    ).rejects.toThrow("Clock in first");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("every plain action names itself so the event log can label it", async () => {
    queueClock(clock(), [clockedInSheet()]);
    await command(workerCtx, {
      op: "clock",
      action: "break",
      paid: false,
      clockVersion: 7,
    });
    expect(mock.rpc.mock.calls[0][1].p_request).toMatchObject({
      clockAction: "break",
      reason: "",
    });
  });
});

describe("admin clock fixes", () => {
  it("are for administrators only, with a reason, on someone else's clock", async () => {
    const body = {
      op: "adminClock",
      employeeId: worker.id,
      action: "cancel",
      clockVersion: 7,
      reason: "Pocket tap",
    };
    await expect(command(reviewerCtx, body)).rejects.toMatchObject({
      status: 403,
    });
    await expect(command(adminCtx, { ...body, reason: "" })).rejects.toThrow(
      "reason",
    );
    await expect(
      command(adminCtx, { ...body, employeeId: admin.id }),
    ).rejects.toThrow("your own clock");
    await expect(
      command(adminCtx, { ...body, action: "in" }),
    ).rejects.toThrow("Unknown clock action");
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("cancel goes to timekeeping_admin_clock with the admin as actor", async () => {
    mock.results.push(worker);
    queueClock(clock(), [clockedInSheet()]);
    await command(adminCtx, {
      op: "adminClock",
      employeeId: worker.id,
      action: "cancel",
      clockVersion: 7,
      reason: "Pocket tap",
    });
    const [name, args] = mock.rpc.mock.calls[0];
    expect(name).toBe("timekeeping_admin_clock");
    expect(args.p_actor).toBe(admin.email);
    expect(args.p_request).toEqual({
      employeeId: worker.id,
      clockAction: "cancel",
      clockVersion: 7,
      shift: null,
      reason: "Pocket tap",
      sheets: [{ id: "sheet", version: 3, days: planned().days }],
    });
  });
  it("stop writes the shift to the sheet at the given end time", async () => {
    mock.results.push(worker);
    queueClock(clock(), [clockedInSheet()]);
    // Clock-out finds the sheet for each day the shift covers.
    mock.results.push([{ period_start: "2026-01-01" }], [clockedInSheet()]);
    await command(adminCtx, {
      op: "adminClock",
      employeeId: worker.id,
      action: "stop",
      clockVersion: 7,
      end: "2026-01-08T16:45:00.000Z",
      reason: "Phone died",
    });
    const request = mock.rpc.mock.calls[0][1].p_request;
    expect(request).toMatchObject({ clockAction: "stop", shift: null });
    const day = request.sheets[0].days.find(
      (d: { date: string }) => d.date === TODAY,
    );
    expect(day.shifts).toEqual([
      {
        ...running(),
        id: `run:${TODAY}`,
        end: "2026-01-08T16:45:00.000Z",
      },
    ]);
  });
  it("fix start can go back before today, within 24 hours", async () => {
    mock.results.push(worker);
    queueClock(clock(), [clockedInSheet()]);
    await command(adminCtx, {
      op: "adminClock",
      employeeId: worker.id,
      action: "fix_start",
      clockVersion: 7,
      start: "2026-01-08T07:30:00.000Z", // 11:30 PM yesterday
      reason: "Started the night callout",
    });
    const request = mock.rpc.mock.calls[0][1].p_request;
    expect(request.shift.start).toBe("2026-01-08T07:30:00.000Z");
    // Today's planned hours come back; yesterday (a planned workday) loses its own.
    const days = request.sheets[0].days;
    expect(days.find((d: { date: string }) => d.date === TODAY)).toEqual(
      planned().days.find((d) => d.date === TODAY),
    );
    expect(
      days.find((d: { date: string }) => d.date === "2026-01-07").shifts,
    ).toEqual([]);
  });
  it("says plainly when the SQL update isn't applied yet", async () => {
    mock.results.push(worker);
    queueClock(clock(), [clockedInSheet()]);
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "not found", code: "PGRST202" },
    });
    await expect(
      command(adminCtx, {
        op: "adminClock",
        employeeId: worker.id,
        action: "cancel",
        clockVersion: 7,
        reason: "Pocket tap",
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("the admin sheet knows when the person is clocked in", () => {
  it("reads another employee's clock for admins only, without writing", async () => {
    await expect(clockFor(reviewerCtx, worker.id)).rejects.toMatchObject({
      status: 403,
    });
    mock.results.push(clock());
    expect((await clockFor(adminCtx, worker.id)).shift).toEqual(running());
    mock.results.push(null);
    expect(await clockFor(adminCtx, "nobody")).toEqual({
      employee_id: "nobody",
      version: 1,
      shift: null,
    });
  });
  it("refuses an admin's change to today or later with a clear message instead of dropping it", async () => {
    const s = clockedInSheet();
    const days = structuredClone(s.days);
    days.find((d) => d.date === TODAY)!.note = "Changed today";
    mock.results.push(s, [], null, clock());
    await expect(
      command(adminCtx, {
        op: "save",
        sheetId: s.id,
        version: s.version,
        days,
        reason: "Fix",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Test Worker is clocked in"),
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("still saves an admin's change to earlier days while the person is clocked in", async () => {
    const s = clockedInSheet();
    const days = structuredClone(s.days);
    days.find((d) => d.date === "2026-01-05")!.note = "Fixed Monday";
    mock.results.push(s, [], null, clock());
    await command(adminCtx, {
      op: "save",
      sheetId: s.id,
      version: s.version,
      days,
      reason: "Fix Monday",
    });
    const request = mock.rpc.mock.calls[0][1].p_request;
    expect(request.reason).toBe("Fix Monday");
    expect(
      request.days.find((d: { date: string }) => d.date === "2026-01-05").note,
    ).toBe("Fixed Monday");
    expect(request.days.find((d: { date: string }) => d.date === TODAY)).toEqual(
      s.days.find((d) => d.date === TODAY),
    );
  });
});

describe("HDPM Field cancel", () => {
  it("maps cancel with a reason to the clock command", () => {
    expect(
      clockBody({ action: "cancel", reason: " Tapped by mistake ", clockVersion: 4 }),
    ).toEqual({
      op: "clock",
      action: "cancel",
      reason: "Tapped by mistake",
      clockVersion: 4,
    });
  });
  it("needs a reason; fix-start stays on the website", () => {
    expect(() => clockBody({ action: "cancel", clockVersion: 4 })).toThrow(
      "cancelling",
    );
    expect(() =>
      clockBody({ action: "fix_start", start: "x", clockVersion: 4 }),
    ).toThrow("Unknown clock action");
  });
});
