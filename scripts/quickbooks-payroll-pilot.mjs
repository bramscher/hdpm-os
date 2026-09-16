import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { createPilotClient, pilotConfig, pilotEntry, pilotStatus } from "../lib/quickbooks-pilot.mjs";

// A separate ignored file avoids mixing sandbox and production app credentials.
dotenv.config({ path: ".env.quickbooks-pilot.local" });

const help = `QuickBooks payroll feasibility pilot (no production writes)

node scripts/quickbooks-payroll-pilot.mjs status
node scripts/quickbooks-payroll-pilot.mjs probe
node scripts/quickbooks-payroll-pilot.mjs preview --employee-id ID --date YYYY-MM-DD --minutes 75 --run-id trial-1
node scripts/quickbooks-payroll-pilot.mjs create-sandbox --employee-id ID --date YYYY-MM-DD --minutes 75 --run-id trial-1 --confirm-company REALM_ID
node scripts/quickbooks-payroll-pilot.mjs read --activity-id ID

status and preview are offline. probe and read only read QuickBooks.
create-sandbox creates ONE nonbillable test entry; it cannot write production.
Use the same run ID AND inputs on retries to avoid duplicate test entries.
See docs/quickbooks-payroll-pilot.md for credentials and success criteria.`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "employee-id": { type: "string" },
      date: { type: "string" },
      minutes: { type: "string" },
      "run-id": { type: "string" },
      "confirm-company": { type: "string" },
      "activity-id": { type: "string" },
      help: { type: "boolean" },
    },
  });
  const command = positionals[0] || "status";
  if (values.help) {
    console.log(help);
  } else {
    if (positionals.length > 1 || !["status", "probe", "preview", "create-sandbox", "read"].includes(command))
      throw new Error(help);
    const config = pilotConfig();
    const input = {
      employeeId: values["employee-id"],
      date: values.date,
      minutes: Number(values.minutes),
      runId: values["run-id"],
    };
    const result = command === "status" ? pilotStatus(config)
      : command === "preview" ? { ...pilotStatus(config), payload: pilotEntry(input), sent: false }
      : command === "probe" ? await createPilotClient(config).probe()
      : command === "read" ? { activity: await createPilotClient(config).readActivity(values["activity-id"]), payrollPreviewVerified: false }
      : await createPilotClient(config).createSandboxEntry(input, values["confirm-company"]);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "QuickBooks pilot failed.");
  process.exitCode = 1;
}
