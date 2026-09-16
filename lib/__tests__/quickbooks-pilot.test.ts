import { describe, expect, it, vi } from "vitest";
import {
  createPilotClient,
  pilotConfig,
  pilotEntry,
  pilotStatus,
  verifyPilotEntry,
} from "../quickbooks-pilot.mjs";

const input = { employeeId: "12", date: "2026-09-16", minutes: 75, runId: "trial-1" };
const config = { environment: "sandbox", realmId: "12345", accessToken: "secret-token" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("QuickBooks Accounting API pilot", () => {
  it("defaults to sandbox and reports setup without disclosing credentials", () => {
    expect(pilotConfig({}).environment).toBe("sandbox");
    expect(JSON.stringify(pilotStatus(config))).not.toContain("secret-token");
    expect(pilotStatus(config).productionWritesEnabled).toBe(false);
    expect(() => pilotConfig({ QBO_PILOT_ENVIRONMENT: "prod" })).toThrow();
    expect(() => pilotConfig({ QBO_PILOT_ENVIRONMENT: "__proto__" })).toThrow();
  });

  it("builds a nonbillable test entry without assigning pay categories or rates", () => {
    const entry = pilotEntry(input);
    expect(entry).toMatchObject({ Hours: 1, Minutes: 15, BillableStatus: "NotBillable" });
    expect(entry).not.toHaveProperty("PayrollItemRef");
    expect(entry).not.toHaveProperty("HourlyRate");
    expect(entry).not.toHaveProperty("CostRate");
  });

  it.each([
    { employeeId: "12' or 1=1" },
    { date: "2026-02-30" },
    { date: "09/16/2026" },
    { minutes: 0 },
    { minutes: -1 },
    { minutes: 1.5 },
    { minutes: 481 },
    { runId: "" },
    { runId: "some person's payroll" },
  ])("rejects invalid inputs %j", (overrides) => {
    expect(() => pilotEntry({ ...input, ...overrides })).toThrow();
  });

  it("blocks every production write before making any network requests", async () => {
    const fetcher = vi.fn();
    const client = createPilotClient({ ...config, environment: "production" }, fetcher);
    await expect(client.createSandboxEntry(input, config.realmId)).rejects.toThrow("Production writes");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires the sandbox company to match before making requests", async () => {
    const fetcher = vi.fn();
    await expect(createPilotClient(config, fetcher).createSandboxEntry(input, "999"))
      .rejects.toThrow("confirm-company");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks the employee, creates one entry, and verifies it with a separate GET", async () => {
    const entry = pilotEntry(input);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Employee: { Id: "12", Active: true } }))
      .mockResolvedValueOnce(response({ TimeActivity: { Id: "98" } }))
      .mockResolvedValueOnce(response({ TimeActivity: { ...entry, Id: "98" } }));
    const result = await createPilotClient(config, fetcher).createSandboxEntry(input, config.realmId);
    expect(result.apiWriteVerified).toBe(true);
    expect(result.payrollPreviewVerified).toBe(false);
    expect(fetcher.mock.calls.map((call) => call[1].method)).toEqual(["GET", "POST", "GET"]);
    const [url, options] = fetcher.mock.calls[1];
    expect(url.origin).toBe("https://sandbox-quickbooks.api.intuit.com");
    expect(url.searchParams.get("requestid")).toHaveLength(32);
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toEqual(entry);
    expect(JSON.stringify(result)).not.toContain(config.accessToken);
  });

  it("uses the same request ID for an exact retry", async () => {
    const requestIds: string[] = [];
    const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      const options = args[1];
      if (url.pathname.endsWith("employee/12")) return response({ Employee: { Id: "12", Active: true } });
      if (options?.method === "POST") {
        requestIds.push(url.searchParams.get("requestid")!);
        return response({ TimeActivity: { Id: "98" } });
      }
      return response({ TimeActivity: { ...pilotEntry(input), Id: "98" } });
    });
    const client = createPilotClient(config, fetcher);
    await client.createSandboxEntry(input, config.realmId);
    await client.createSandboxEntry(input, config.realmId);
    expect(requestIds[0]).toBe(requestIds[1]);
  });

  it("does not write against an inactive employee", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ Employee: { Id: "12", Active: false } }));
    await expect(createPilotClient(config, fetcher).createSandboxEntry(input, config.realmId))
      .rejects.toThrow("active employee");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a created ID if read-back fails, so the operator can reconcile", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Employee: { Id: "12", Active: true } }))
      .mockResolvedValueOnce(response({ TimeActivity: { Id: "98" } }))
      .mockResolvedValueOnce(response({}, 503));
    await expect(createPilotClient(config, fetcher).createSandboxEntry(input, config.realmId))
      .rejects.toThrow("activity 98 was created, but read-back failed");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not mistake changed hours, billable status, or pay categories for a successful test", () => {
    const entry = pilotEntry(input);
    expect(verifyPilotEntry(entry, { ...entry, Minutes: 0 })).toBe(false);
    expect(verifyPilotEntry(entry, { ...entry, BillableStatus: "Billable" })).toBe(false);
    expect(verifyPilotEntry(entry, { ...entry, PayrollItemRef: { value: "overtime" } })).toBe(false);
    expect(verifyPilotEntry(entry, entry)).toBe(true);
  });

  it("redacts upstream errors and does not retry a failed write automatically", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: "secret-token private payload" }, 401));
    await expect(createPilotClient(config, fetcher).readActivity("98"))
      .rejects.toThrow("authorization expired");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows production read-only probing without claiming payroll integration works", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ CompanyInfo: { CompanyName: "Test business" } }))
      .mockResolvedValueOnce(response({ QueryResponse: { Employee: [{ Id: "12", DisplayName: "Employee", SSN: "never return" }] } }));
    const result = await createPilotClient({ ...config, environment: "production" }, fetcher).probe();
    expect(result.employees).toEqual([{ id: "12", name: "Employee" }]);
    expect(result.payrollPreviewVerified).toBe(false);
    expect(fetcher.mock.calls.every(([url, options]) => url.origin === "https://quickbooks.api.intuit.com" && options.method === "GET")).toBe(true);
  });
});
