import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blankDay,
  dates,
  totals,
  localTime,
  wallTime,
  DEFAULT_SCHEDULE,
  type Employee,
  type Sheet,
} from "../model";

const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  filter: vi.fn(),
  results: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: mock.from, rpc: mock.rpc }),
}));
vi.mock("@/lib/require-role", () => ({
  isCompanyEmail: (email?: string) => email?.endsWith("@highdesertpm.com"),
}));
import {
  authorizedSheet,
  command,
  context,
  exportRows,
  ensureSheets,
  submittedSheets,
  history,
  payrollReview,
  bootstrap,
  listSheets,
} from "../server";
import { POST } from "@/app/api/timekeeping/route";

const employee: Employee = {
  id: "employee",
  staff_person: "Employee",
  name: "Example",
  email: "employee@highdesertpm.com",
  payroll_id: "T-1",
  pay_basis: "salary",
  manager_id: "manager",
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
const ctx = { email: employee.email, isAdmin: false, employee };
const sheet = (): Sheet => ({
  id: "sheet",
  employee_id: employee.id,
  period_start: "2026-01-01",
  period_end: "2026-01-15",
  days: dates("2026-01-01", "2026-01-15").map((date) => ({
    ...blankDay(date),
    off: true,
  })),
  state: "draft",
  note: "",
  pay_basis: "salary",
  version: 1,
  review_manager_id: "manager",
  employee_name: employee.name,
  payroll_id: employee.payroll_id,
  reason: "",
  approved_at: null,
  approved_by: null,
});
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mock.results = [];
  mock.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "neq",
      "ilike",
      "order",
      "upsert",
      "single",
      "maybeSingle",
      "limit",
      "range",
      "in",
    ])
      chain[method] = () => chain;
    for (const method of ["eq", "in"]) {
      chain[method] = (column: string, value: unknown) => {
        mock.filter(table, method, column, value);
        return chain;
      };
    }
    chain.upsert = (data: unknown) => {
      mock.upsert(table, data);
      return chain;
    };
    chain.then = (resolve: (value: unknown) => void) =>
      Promise.resolve({ data: mock.results.shift(), error: null }).then(
        resolve,
      );
    return chain;
  });
  mock.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("payroll setup permissions", () => {
  it("keeps payroll calculations and eligibility changes admin-only", async () => {
    await expect(payrollReview(ctx, "2026-09-01")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      command(ctx, { op: "payrollSetup", setting: "eligibility" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("requires a reason and uses the authenticated admin identity", async () => {
    const body = {
      op: "payrollSetup",
      setting: "opening",
      employeeId: "employee",
      version: 0,
      period: "2026-09-01",
      workedMinutes: 480,
      reason: "Prior approved payroll",
      actor: "spoof@example.test",
    };
    await expect(
      command({ ...ctx, isAdmin: true }, { ...body, reason: "" }),
    ).rejects.toThrow("source or reason");
    mock.rpc.mockResolvedValueOnce({
      data: { worked_minutes: 480 },
      error: null,
    });
    await command({ ...ctx, isAdmin: true }, body);
    expect(mock.rpc).toHaveBeenCalledWith("timekeeping_payroll_setup", {
      p_actor: ctx.email,
      p_request: {
        setting: "opening",
        employeeId: "employee",
        version: 0,
        reason: "Prior approved payroll",
        overtimeStatus: undefined,
        period: "2026-09-01",
        workedMinutes: 480,
      },
    });
  });
});
describe("timekeeping server identity and signatures", () => {
  it("automatically enrolls a first-time profile using the configured manager and real session actor", async () => {
    vi.stubEnv("TIMEKEEPING_DEFAULT_MANAGER", "Craig");
    const first = { ...employee, enabled: false, manager_id: null };
    mock.auth.mockResolvedValue({ user: { email: employee.email } });
    mock.results.push(
      [
        {
          person: "Employee",
          name: "Example",
          email: employee.email,
          access_role: "staff",
        },
      ],
      null,
      first,
    );
    mock.rpc.mockResolvedValue({
      data: { ...first, enabled: true, manager_id: "craig-id", version: 2 },
      error: null,
    });
    expect((await context()).employee).toMatchObject({
      enabled: true,
      manager_id: "craig-id",
    });
    expect(mock.rpc).toHaveBeenCalledWith("timekeeping_auto_enroll", {
      p_actor: employee.email,
      p_manager_staff: "Craig",
    });
  });
  it("retains manual setup while the additive migration is pending", async () => {
    vi.stubEnv("TIMEKEEPING_DEFAULT_MANAGER", "Craig");
    const first = { ...employee, enabled: false, manager_id: null };
    mock.auth.mockResolvedValue({ user: { email: employee.email } });
    mock.results.push(
      [
        {
          person: "Employee",
          name: "Example",
          email: employee.email,
          access_role: "staff",
        },
      ],
      null,
      first,
    );
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Function not found" },
    });
    expect((await context()).employee.enabled).toBe(false);
  });

  it("excludes only configured staff keys from timekeeping", async () => {
    vi.stubEnv("TIMEKEEPING_EXCLUDED_STAFF", " Jen, Jayme, Bryce, Bianca ");
    const { participatesInTimekeeping } = await import("../roster");
    expect(participatesInTimekeeping("Jen")).toBe(false);
    expect(participatesInTimekeeping("jayme")).toBe(false);
    expect(participatesInTimekeeping("Jenna")).toBe(true);
    mock.auth.mockResolvedValue({ user: { email: "jen@highdesertpm.com" } });
    mock.results.push([
      {
        person: "Jen",
        name: "Jennifer Bertran",
        email: "jen@highdesertpm.com",
        access_role: "staff",
      },
    ]);
    await expect(context()).rejects.toMatchObject({ status: 403 });
    expect(mock.from).toHaveBeenCalledTimes(1);
  });

  it("requires a company Microsoft session", async () => {
    mock.auth.mockResolvedValue(null);
    await expect(context()).rejects.toMatchObject({ status: 401 });
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("derives admin privileges from the active directory, not the browser/session role", async () => {
    mock.auth.mockResolvedValue({
      user: { email: employee.email, isAdmin: true },
    });
    mock.results.push(
      [
        {
          person: "Employee",
          name: "Example",
          email: employee.email,
          access_role: "staff",
        },
      ],
      null,
      employee,
    );
    expect((await context()).isAdmin).toBe(false);
  });
  it("rejects duplicate directory identities", async () => {
    mock.auth.mockResolvedValue({ user: { email: employee.email } });
    mock.results.push([{ person: "One" }, { person: "Two" }]);
    await expect(context()).rejects.toMatchObject({ status: 403 });
  });
  it("denies another employee sheet and historical export", async () => {
    mock.results.push({ ...sheet(), employee_id: "other" }, [sheet()]);
    await expect(authorizedSheet(ctx, "sheet")).rejects.toMatchObject({
      status: 403,
    });
    await expect(exportRows(ctx, "old-export")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("scopes submitted history to the session employee, including for administrators", async () => {
    for (const isAdmin of [false, true]) {
      mock.results.push([]);
      expect(await submittedSheets({ ...ctx, isAdmin })).toEqual([]);
      expect(mock.filter).toHaveBeenCalledWith(
        "timekeeping_sheet",
        "eq",
        "employee_id",
        employee.id,
      );
      expect(mock.filter).toHaveBeenCalledWith(
        "timekeeping_sheet",
        "in",
        "state",
        ["submitted", "approved", "returned"],
      );
      mock.filter.mockClear();
    }
  });
  it("allows own historical approval details but rejects historical edits and other employees' history", async () => {
    const historic = { ...sheet(), state: "approved" as const };
    mock.results.push(
      historic,
      [historic],
      [{ action: "approve", actor: "manager@example.test" }],
    );
    expect(await history(ctx, historic.id)).toEqual([
      { action: "approve", actor: "manager@example.test" },
    ]);
    mock.results.push(historic, [historic]);
    await expect(
      command(ctx, {
        op: "save",
        sheetId: historic.id,
        version: 1,
        days: historic.days,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.results.push({ ...historic, employee_id: "another-employee" }, []);
    await expect(history(ctx, historic.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("requires explicit employee attestation and ignores supplied signer/time", async () => {
    const s = sheet();
    mock.results.push(s, [s]);
    await expect(
      command(ctx, { op: "submit", sheetId: s.id, version: 1 }),
    ).rejects.toThrow("signature");
    mock.results.push(s, [s], null, {
      employee_id: employee.id,
      shift: null,
      version: 1,
    });
    await command(ctx, {
      op: "submit",
      sheetId: s.id,
      version: 1,
      attested: true,
      employee_signed_by: "fake",
      employee_signed_at: "1900-01-01",
    });
    const args = mock.rpc.mock.calls[0][1];
    expect(args.p_actor).toBe(employee.email);
    expect(args.p_request.attested).toBe(true);
    expect(args.p_request).not.toHaveProperty("employee_signed_by");
    expect(args.p_request).not.toHaveProperty("employee_signed_at");
  });
  it("saves, submits and permits admin review of a planned final-day departure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T17:00:00Z")); // 9 AM Pacific
    try {
      const s = sheet();
      const last = s.days.at(-1)!;
      last.off = false;
      last.shifts = [
        {
          id: "planned",
          source: "scheduled",
          start: wallTime(last.date, "07:00"),
          end: wallTime(last.date, "16:30"),
          breaks: [],
        },
      ];
      mock.results.push(s, [s]);
      await command(ctx, {
        op: "save",
        sheetId: s.id,
        version: 1,
        days: s.days,
      });
      expect(
        mock.rpc.mock.calls.at(-1)![1].p_request.days.at(-1).shifts[0].end,
      ).toBe(wallTime(last.date, "16:30"));
      mock.results.push(s, [s], null, {
        employee_id: employee.id,
        shift: null,
        version: 1,
      });
      await command(ctx, {
        op: "submit",
        sheetId: s.id,
        version: 1,
        attested: true,
      });
      const submission = mock.rpc.mock.calls.at(-1)![1];
      expect(submission.p_actor).toBe(employee.email);
      expect(submission.p_request).toMatchObject({
        op: "submit",
        attested: true,
      });
      expect(submission.p_request.days.at(-1).shifts[0]).toMatchObject({
        source: "manual",
        end: wallTime(last.date, "16:30"),
      });
      const signed = {
        ...s,
        state: "submitted",
        days: submission.p_request.days,
        employee_signed_at: new Date().toISOString(),
      };
      const manager = {
        ...employee,
        id: "manager",
        email: "manager@highdesertpm.com",
      };
      mock.results.push(signed, []);
      await command(
        { employee: manager, email: manager.email, isAdmin: true },
        { op: "approve", sheetId: s.id, version: 1 },
      );
      expect(mock.rpc.mock.calls.at(-1)![1]).toMatchObject({
        p_actor: manager.email,
        p_request: { op: "approve" },
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("still requires an active clock to stop before final-day signing", async () => {
    const s = sheet();
    mock.results.push(s, [s], null, {
      employee_id: employee.id,
      shift: { id: "running" },
      version: 1,
    });
    await expect(
      command(ctx, { op: "submit", sheetId: s.id, version: 1, attested: true }),
    ).rejects.toThrow("Clock out before submitting");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("keeps explicit no-work exceptions when refreshing defaults", async () => {
    const s = sheet();
    s.days[0].exception = true;
    s.days[1].exception = true;
    s.days[1].off = false; // A cleared, unfinished day can be filled; explicit days off stay protected.
    mock.results.push(s, [s]);
    await command(ctx, { op: "refresh", sheetId: s.id, version: 1 });
    const days = mock.rpc.mock.calls[0][1].p_request.days;
    expect(days[0].off).toBe(true);
    expect(days[0].shifts).toEqual([]);
    expect(days[1].shifts).toHaveLength(1);
  });
  it("uses company defaults when none are saved and respects real enrollment dates", async () => {
    const s = sheet();
    mock.results.push(s, [s]);
    await command(
      { ...ctx, employee: { ...employee, schedule: null } },
      { op: "refresh", sheetId: s.id, version: 1 },
    );
    const initialDays = mock.rpc.mock.calls[0][1].p_request.days;
    expect(totals(initialDays).scheduled).toBe(11 * 510);
    expect(localTime(initialDays[0].shifts[0].start)).toBe("07:00");
    mock.rpc.mockClear();
    mock.results.push(s, [s]);
    await command(
      { ...ctx, employee: { ...employee, starts_on: "2026-01-15" } },
      { op: "refresh", sheetId: s.id, version: 1 },
    );
    const days = mock.rpc.mock.calls[0][1].p_request.days;
    expect(
      days
        .slice(0, 14)
        .every(
          (d: { off: boolean; shifts: unknown[] }) => d.off && !d.shifts.length,
        ),
    ).toBe(true);
    expect(days[14].shifts).toHaveLength(1);
  });
  it.each([
    ["2026-09-16", "2026-09-30", 11],
    ["2026-10-01", "2026-10-15", 11],
  ])(
    "automatically fills the new period beginning %s with personal defaults",
    async (start, end, workdays) => {
      mock.results.push([], null, null);
      await ensureSheets(
        {
          ...employee,
          starts_on: start,
          schedule: { ...DEFAULT_SCHEDULE, start: "08:00", end: "17:00" },
        },
        start,
      );
      const inserted = mock.upsert.mock.calls.find(
        ([table]) => table === "timekeeping_sheet",
      )![1];
      expect(inserted).toMatchObject({ period_start: start, period_end: end });
      expect(
        inserted.days.filter((d: { shifts: unknown[] }) => d.shifts.length),
      ).toHaveLength(workdays);
      expect(totals(inserted.days).scheduled).toBe(workdays * 480);
      expect(localTime(inserted.days[0].shifts[0].start)).toBe("08:00");
      mock.upsert.mockClear();
      mock.results.push([{ period_start: start }]);
      await ensureSheets({ ...employee, starts_on: start }, start);
      expect(mock.upsert).not.toHaveBeenCalled();
    },
  );
  it("automatically fills a new period from company defaults before personal setup", async () => {
    mock.results.push([], null, null);
    await ensureSheets(
      { ...employee, starts_on: "2026-09-16", schedule: null },
      "2026-09-16",
    );
    const inserted = mock.upsert.mock.calls.find(
      ([table]) => table === "timekeeping_sheet",
    )![1];
    expect(totals(inserted.days).scheduled).toBe(11 * 510);
    expect(localTime(inserted.days[0].shifts[0].end)).toBe("16:30");
    expect(
      inserted.days[0].shifts[0].breaks.find((b: { paid: boolean }) => !b.paid),
    ).toMatchObject({
      start: wallTime("2026-09-16", "12:00"),
      end: wallTime("2026-09-16", "13:00"),
    });
  });
  it("lets reviewer-only Craig edit an employee's defaults under his own identity", async () => {
    const craig = {
      ...employee,
      id: "craig",
      staff_person: "Craig",
      email: "craig@highdesertpm.com",
      schedule: null,
    };
    mock.results.push(employee);
    await command(
      { email: craig.email, isAdmin: true, employee: craig },
      {
        op: "schedule",
        employeeId: employee.id,
        version: 1,
        schedule: DEFAULT_SCHEDULE,
        p_actor: "spoof@example.test",
      },
    );
    expect(mock.rpc).toHaveBeenCalledWith("timekeeping_admin_schedule", {
      p_actor: craig.email,
      p_employee_id: employee.id,
      p_version: 1,
      p_schedule: DEFAULT_SCHEDULE,
    });
  });
  it("rejects staff edits to someone else's defaults before any write", async () => {
    await expect(
      command(ctx, {
        op: "schedule",
        employeeId: "other",
        version: 1,
        schedule: DEFAULT_SCHEDULE,
      }),
    ).rejects.toThrow("administrator");
    expect(mock.from).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("reports a pending admin schedule migration without falling back to unaudited writes", async () => {
    mock.results.push({ ...employee, id: "other" });
    mock.rpc.mockResolvedValue({ error: { code: "PGRST202" }, data: null });
    await expect(
      command(
        { ...ctx, isAdmin: true },
        {
          op: "schedule",
          employeeId: "other",
          version: 1,
          schedule: DEFAULT_SCHEDULE,
        },
      ),
    ).rejects.toThrow("SQL update");
    expect(mock.upsert).not.toHaveBeenCalled();
  });
  it("lets Craig apply the target employee's schedule with an audit reason and preserves exceptions", async () => {
    const craig = {
      ...employee,
      id: "craig",
      staff_person: "Craig",
      email: "craig@highdesertpm.com",
      schedule: null,
    };
    const penny = {
      ...employee,
      schedule: { ...DEFAULT_SCHEDULE, start: "09:00", end: "17:00" },
    };
    const s = sheet();
    s.days[0].exception = true;
    s.days[1].note = "Keep notes";
    s.days[4].shifts = [
      {
        id: "clocked",
        source: "clocked",
        start: wallTime("2026-01-05", "10:00"),
        end: wallTime("2026-01-05", "11:00"),
        breaks: [],
      },
    ];
    s.days[4].off = false;
    mock.results.push(s, [], penny);
    await command(
      { email: craig.email, isAdmin: true, employee: craig },
      { op: "refresh", sheetId: s.id, version: 1 },
    );
    const args = mock.rpc.mock.calls[0][1];
    expect(args.p_actor).toBe(craig.email);
    expect(args.p_request.reason).toBe(
      "Applied employee schedule defaults to untouched days",
    );
    expect(args.p_request.days[0]).toEqual(s.days[0]);
    expect(args.p_request.days[1]).toEqual(s.days[1]);
    expect(args.p_request.days[4]).toEqual(s.days[4]);
    expect(localTime(args.p_request.days[5].shifts[0].start)).toBe("09:00");
  });
  it("does not let a non-admin reviewer apply another employee's defaults", async () => {
    const manager = { ...employee, id: "manager" };
    const s = sheet();
    mock.results.push(s, []);
    await expect(
      command(
        { email: manager.email, isAdmin: false, employee: manager },
        { op: "refresh", sheetId: s.id, version: 1 },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("prevents personal time tracking and sheet generation for reviewer-only Craig", async () => {
    const craig = {
      ...employee,
      id: "craig",
      staff_person: "Craig",
      email: "craig@highdesertpm.com",
    };
    const reviewer = { email: craig.email, isAdmin: true, employee: craig };
    await ensureSheets(craig);
    await expect(
      command(reviewer, {
        op: "schedule",
        version: 1,
        schedule: employee.schedule,
      }),
    ).rejects.toThrow("administration only");
    await expect(
      command(reviewer, { op: "clock", action: "in", clockVersion: 1 }),
    ).rejects.toThrow("administration only");
    expect(mock.from).not.toHaveBeenCalled();
    mock.results.push([craig, employee]);
    await expect(
      command(reviewer, {
        op: "employee",
        employeeId: craig.id,
        enabled: true,
        payBasis: "hourly",
      }),
    ).rejects.toThrow("does not participate");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("allows reviewer-only Craig to approve an assigned employee's sheet", async () => {
    const craig = {
      ...employee,
      id: "craig",
      staff_person: "Craig",
      email: "craig@highdesertpm.com",
      enabled: false,
    };
    const s = {
      ...sheet(),
      state: "submitted" as const,
      review_manager_id: craig.id,
    };
    mock.results.push(s, []);
    await command(
      { email: craig.email, isAdmin: true, employee: craig },
      { op: "approve", sheetId: s.id, version: 1 },
    );
    expect(mock.rpc).toHaveBeenCalledWith(
      "timekeeping_apply",
      expect.objectContaining({
        p_actor: craig.email,
        p_request: expect.objectContaining({ op: "approve", sheetId: s.id }),
      }),
    );
  });
  it("rejects stale saves before writing", async () => {
    const s = sheet();
    mock.results.push({ ...s, version: 2 }, [s]);
    await expect(
      command(ctx, { op: "save", sheetId: s.id, version: 1, days: s.days }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin POSTs before invoking authentication or storage", async () => {
    const response = await POST(
      new Request("https://os.highdesertpm.com/api/timekeeping", {
        method: "POST",
        headers: { origin: "https://unrelated.example" },
        body: JSON.stringify({ op: "submit" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mock.auth).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

describe("private employee timecards", () => {
  it("rejects team-list requests by non-admins before reading any rows", async () => {
    await expect(listSheets(ctx)).rejects.toMatchObject({ status: 403 });
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("allows admins to list all timecards", async () => {
    mock.results.push([sheet()]);
    expect(await listSheets({ ...ctx, isAdmin: true })).toEqual([sheet()]);
  });
  it("blocks assigned managers from reading history or approving another employee's timecard", async () => {
    const manager = { ...ctx, employee: { ...employee, id: 'manager' } };
    const submitted = { ...sheet(), state: 'submitted' as const };
    mock.results.push(submitted, []);
    await expect(history(manager, submitted.id)).rejects.toMatchObject({status:403});
    mock.results.push(submitted, []);
    await expect(command(manager, {op:'approve',sheetId:submitted.id,version:1})).rejects.toMatchObject({status:403});
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalledWith('timekeeping_event');
  });
});

it("bootstraps a non-admin with only their own timecard and no team access", async () => {
  mock.results.push([], null, {employee_id: employee.id, version:1, shift:null});
  const result = await bootstrap({...ctx, employee:{...employee,enabled:false}});
  expect(result.canReview).toBe(false);
  expect(result.employees).toEqual([]);
  expect(mock.from).not.toHaveBeenCalledWith('timekeeping_employee');
  expect(mock.filter).not.toHaveBeenCalledWith('timekeeping_sheet','eq','review_manager_id',expect.anything());
});
