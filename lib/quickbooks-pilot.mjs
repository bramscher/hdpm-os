/** A deliberately small, short-lived-token probe of the standard Accounting API. */
import { createHash } from "node:crypto";

const hosts = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
};

/** @param {Record<string, string | undefined>} env */
export function pilotConfig(env = process.env) {
  const environment = env.QBO_PILOT_ENVIRONMENT || "sandbox";
  if (!Object.hasOwn(hosts, environment))
    throw new Error("QBO_PILOT_ENVIRONMENT must be sandbox or production.");
  const realmId = env.QBO_PILOT_REALM_ID || "";
  if (realmId && !/^\d+$/.test(realmId))
    throw new Error("QBO_PILOT_REALM_ID must contain only digits.");
  return {
    environment,
    realmId,
    accessToken: env.QBO_PILOT_ACCESS_TOKEN || "",
  };
}

export function pilotStatus(config) {
  return {
    environment: config.environment,
    companyConfigured: !!config.realmId,
    accessTokenConfigured: !!config.accessToken,
    productionWritesEnabled: false,
    payrollPreviewVerified: false,
  };
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error(`${label} must be a QuickBooks numeric ID.`);
  return value;
}

export function pilotEntry({ employeeId, date, minutes, runId }) {
  identifier(employeeId, "Employee ID");
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  ) throw new Error("Date must be a valid YYYY-MM-DD date.");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480)
    throw new Error("Choose 1–480 whole minutes for this single-entry pilot.");
  if (typeof runId !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(runId))
    throw new Error("Run ID must be 1–40 letters, digits, underscores or hyphens.");
  return {
    TxnDate: date,
    NameOf: "Employee",
    EmployeeRef: { value: employeeId },
    Hours: Math.floor(minutes / 60),
    Minutes: minutes % 60,
    BillableStatus: "NotBillable",
    Description: `HDPM API PILOT sandbox only / ${runId}`,
  };
}

export function verifyPilotEntry(expected, actual) {
  return !!actual &&
    actual.NameOf === expected.NameOf &&
    actual.EmployeeRef?.value === expected.EmployeeRef.value &&
    actual.TxnDate === expected.TxnDate &&
    (actual.Hours ?? 0) === expected.Hours &&
    (actual.Minutes ?? 0) === expected.Minutes &&
    actual.BillableStatus === "NotBillable" &&
    actual.Description === expected.Description &&
    !actual.PayrollItemRef;
}

export function createPilotClient(config, fetchImpl = fetch) {
  // Validate again here so callers cannot supply an arbitrary API host/environment.
  if (!Object.hasOwn(hosts, config.environment))
    throw new Error("Unknown QuickBooks environment.");
  identifier(config.realmId, "Company ID");
  if (!config.accessToken) throw new Error("Configure QBO_PILOT_ACCESS_TOKEN first.");

  async function request(path, body, requestId) {
    if (body && config.environment !== "sandbox")
      throw new Error("Production writes are disabled in this pilot.");
    const url = new URL(`/v3/company/${config.realmId}/${path}`, hosts[config.environment]);
    if (requestId) url.searchParams.set("requestid", requestId);
    let response;
    try {
      response = await fetchImpl(url, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new Error(body
        ? "QuickBooks request interrupted. The entry may exist; retry the identical command and run ID, not a new run ID."
        : "QuickBooks request interrupted. Check network access and try again.");
    }
    if (!response.ok) {
      // Do not echo arbitrary upstream bodies, which may contain sensitive data.
      if (response.status === 401)
        throw new Error("QuickBooks authorization expired or is invalid. Obtain a new access token using Intuit's OAuth playground.");
      if (response.status === 403)
        throw new Error("QuickBooks denied access. Check the app scope, developer tier and connected company.");
      throw new Error(`QuickBooks returned HTTP ${response.status}. Inspect this request in Intuit's API tools.`);
    }
    try {
      const result = await response.json();
      if (result.Fault) throw new Error("fault");
      return result;
    } catch {
      throw new Error("QuickBooks returned an invalid API response. Do not assume the operation succeeded.");
    }
  }

  return {
    async probe() {
      const company = await request(`companyinfo/${config.realmId}`);
      if (!company.CompanyInfo?.CompanyName)
        throw new Error("QuickBooks did not return company information.");
      const employees = await request(`query?${new URLSearchParams({
        query: "select * from Employee where Active = true maxresults 100",
      })}`);
      return {
        ...pilotStatus(config),
        companyName: company.CompanyInfo.CompanyName,
        realmId: config.realmId,
        employeePageLimit: 100,
        employees: (employees.QueryResponse?.Employee || []).map((employee) => ({
          id: employee.Id,
          name: employee.DisplayName,
        })),
        result: "Accounting API read access works. Payroll transfer is not yet verified.",
      };
    },
    async readActivity(activityId) {
      const result = await request(`timeactivity/${identifier(activityId, "Time activity ID")}`);
      if (!result.TimeActivity) throw new Error("QuickBooks did not return a time activity.");
      return result.TimeActivity;
    },
    async createSandboxEntry(input, confirmedRealmId) {
      if (config.environment !== "sandbox")
        throw new Error("Production writes are disabled in this pilot.");
      if (confirmedRealmId !== config.realmId)
        throw new Error("--confirm-company must match the configured sandbox company ID.");
      const payload = pilotEntry(input);
      const employee = await request(`employee/${payload.EmployeeRef.value}`);
      if (employee.Employee?.Id !== payload.EmployeeRef.value || employee.Employee?.Active !== true)
        throw new Error("Choose an active employee from this sandbox company.");
      // Intuit request IDs make exact retries idempotent. Keep run ID and inputs unchanged.
      const requestId = createHash("sha256")
        .update(JSON.stringify([config.realmId, payload]))
        .digest("hex").slice(0, 32);
      const created = await request("timeactivity", payload, requestId);
      const id = identifier(created.TimeActivity?.Id, "Created time activity ID");
      let readBack;
      try {
        readBack = await this.readActivity(id);
      } catch {
        throw new Error(`Sandbox activity ${id} was created, but read-back failed. Use the read command to inspect it before retrying.`);
      }
      if (!verifyPilotEntry(payload, readBack))
        throw new Error(`Sandbox activity ${id} was created, but its fields did not match. Inspect it before proceeding.`);
      return {
        environment: config.environment,
        realmId: config.realmId,
        activityId: id,
        requestId,
        apiWriteVerified: true,
        payrollPreviewVerified: false,
        payload,
        result: "Sandbox time entry created and read back correctly. This does not establish payroll support.",
      };
    },
  };
}
