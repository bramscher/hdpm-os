import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankDay, dates, type Employee, type Sheet } from "../model";

const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  results: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: mock.from, rpc: mock.rpc }),
}));
vi.mock("@/lib/require-role", () => ({
  isCompanyEmail: (email?: string) => email?.endsWith("@highdesertpm.com"),
}));
import { authorizedSheet, command, context, exportRows } from "../server";
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
  vi.clearAllMocks();
  mock.results = [];
  mock.from.mockImplementation(() => {
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
    ])
      chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => void) =>
      Promise.resolve({ data: mock.results.shift(), error: null }).then(
        resolve,
      );
    return chain;
  });
  mock.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});
describe("timekeeping server identity and signatures", () => {
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
  it("keeps explicit no-work exceptions when refreshing defaults", async () => {
    const s = sheet();
    s.days[0].exception = true;
    mock.results.push(s, [s]);
    await command(ctx, { op: "refresh", sheetId: s.id, version: 1 });
    const days = mock.rpc.mock.calls[0][1].p_request.days;
    expect(days[0].off).toBe(true);
    expect(days[0].shifts).toEqual([]);
    expect(days[1].shifts).toHaveLength(1);
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
