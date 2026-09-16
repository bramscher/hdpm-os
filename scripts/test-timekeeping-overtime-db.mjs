import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = await PGlite.create();
let passed = 0;
const check = (value, message) => {
  assert.ok(value, message);
  passed++;
};
const reject = async (fn, pattern) => {
  await assert.rejects(fn, pattern);
  passed++;
};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE staff(person text primary key,name text,email text,active boolean default true,access_role text default 'staff');
    INSERT INTO staff(person,name,email,access_role) VALUES ('Admin','Admin','admin@example.test','admin'),('Employee','Employee','employee@example.test','staff');`);
  for (const name of [
    "20260915_timekeeping.sql",
    "20260916_timekeeping_overtime.sql",
    "20260916_timekeeping_overtime.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  passed++;
  await db.exec(`INSERT INTO timekeeping_employee(staff_person,name,email,pay_basis,starts_on)
    SELECT person,name,email,'salary','2026-01-01' FROM staff;
    INSERT INTO timekeeping_period VALUES ('2026-01-01','2026-01-15','hdpm'),('2025-12-16','2025-12-31','hdpm');`);
  const employee = (
    await db.query(
      "SELECT * FROM timekeeping_employee WHERE staff_person='Employee'",
    )
  ).rows[0];
  check(
    employee.overtime_status === "non_exempt",
    "salary defaults to overtime eligible",
  );
  await db.query(
    `INSERT INTO timekeeping_sheet(employee_id,period_start,period_end,employee_name,state,employee_signed_at,days)
    VALUES($1,'2026-01-01','2026-01-15','Employee','approved',now(),'[]')`,
    [employee.id],
  );
  const setup = async (actor, body) =>
    (
      await db.query("SELECT timekeeping_payroll_setup($1,$2::jsonb) result", [
        actor,
        JSON.stringify({ employeeId: employee.id, ...body }),
      ])
    ).rows[0].result;
  const saveOpening = (overrides = {}) =>
    setup("admin@example.test", {
      setting: "opening",
      period: "2026-01-01",
      version: 0,
      workedMinutes: 960,
      reason: "Prior payroll approved hours Dec 28-31",
      ...overrides,
    });
  const exportPayroll = async () =>
    (
      await db.query(
        'SELECT timekeeping_apply(\'admin@example.test\', \'{"op":"export","period":"2026-01-01"}\') result',
      )
    ).rows[0].result;
  await reject(exportPayroll, /Confirm opening hours/);
  await reject(
    () =>
      setup("employee@example.test", {
        setting: "eligibility",
        version: 1,
        overtimeStatus: "exempt",
        reason: "Test",
      }),
    /FORBIDDEN/,
  );
  await reject(() => saveOpening({ reason: "" }), /source or reason/);
  await reject(
    () => saveOpening({ workedMinutes: -1 }),
    /opening worked hours/,
  );
  await reject(
    () => saveOpening({ workedMinutes: 6000 }),
    /opening worked hours/,
  );
  await reject(() => saveOpening({ version: null }), /CONFLICT/);
  const opening = await saveOpening();
  check(
    opening.worked_minutes === 960 && opening.version === 1,
    "opening hours stored with version",
  );
  await reject(() => saveOpening(), /CONFLICT/);
  const first = await exportPayroll();
  check(
    first.snapshot.overtime.version === 1,
    "new export includes versioned overtime context",
  );
  check(
    first.snapshot.overtime.openings[0].worked_minutes === 960,
    "opening hours frozen into export",
  );
  await setup("admin@example.test", {
    setting: "eligibility",
    version: 1,
    overtimeStatus: "exempt",
    reason: "Verified applicable duties and pay tests",
  });
  await reject(
    () =>
      setup("admin@example.test", {
        setting: "eligibility",
        version: 1,
        overtimeStatus: "non_exempt",
        reason: "Stale",
      }),
    /CONFLICT/,
  );
  const saved = (
    await db.query("SELECT snapshot FROM timekeeping_export WHERE id=$1", [
      first.id,
    ])
  ).rows[0].snapshot;
  check(
    saved.overtime.employees.find((e) => e.id === employee.id)
      .overtime_status === "non_exempt",
    "later settings do not rewrite saved exports",
  );
  const emergencyDay = [
    {
      date: "2026-01-01",
      off: false,
      emergency: true,
      shifts: [
        {
          id: "emergency",
          start: "2026-01-02T01:00:00Z",
          end: "2026-01-02T02:00:00Z",
          source: "manual",
          breaks: [],
        },
      ],
      leave: [],
      miles: 0,
      note: "",
    },
  ];
  await db.query(
    "UPDATE timekeeping_sheet SET days=$1::jsonb WHERE employee_id=$2 AND period_start='2026-01-01'",
    [JSON.stringify(emergencyDay), employee.id],
  );
  await reject(exportPayroll, /Identify after-hours emergency intervals/);
  emergencyDay[0].shifts[0].emergencyAfterHours = true;
  await db.query(
    "UPDATE timekeeping_sheet SET days=$1::jsonb WHERE employee_id=$2 AND period_start='2026-01-01'",
    [JSON.stringify(emergencyDay), employee.id],
  );
  check(
    (await exportPayroll()).snapshot.sheets[0].days[0].shifts[0]
      .emergencyAfterHours,
    "marked emergency intervals export",
  );
  const priorDays = [28, 29, 30, 31].map((n) => ({
    date: `2025-12-${n}`,
    off: true,
    shifts: [],
    leave: [],
    miles: 0,
    note: "",
  }));
  await db.query(
    `INSERT INTO timekeeping_sheet(employee_id,period_start,period_end,employee_name,state,employee_signed_at,days)
    VALUES($1,'2025-12-16','2025-12-31','Employee','approved',now(),$2::jsonb)`,
    [employee.id, JSON.stringify(priorDays)],
  );
  const latest = await exportPayroll();
  check(
    latest.snapshot.overtime.precedingSheets.length === 1 &&
      latest.snapshot.overtime.openings.length === 0,
    "approved prior records supersede manual opening hours",
  );
  await reject(() => saveOpening({ version: 1 }), /Approved prior timecards/);
  check(
    (
      await db.query(
        "SELECT count(*)::int n FROM timekeeping_event WHERE action LIKE 'payroll_%'",
      )
    ).rows[0].n === 2,
    "setting changes are audited",
  );
  await reject(
    () =>
      db.query("UPDATE timekeeping_export SET snapshot='{}' WHERE id=$1", [
        first.id,
      ]),
    /append-only/,
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    await reject(
      () => db.query("SELECT timekeeping_payroll_context('2026-01-01')"),
      /permission denied/,
    );
    await reject(
      () => db.query("SELECT * FROM timekeeping_week_opening"),
      /permission denied/,
    );
    await reject(() => saveOpening(), /permission denied/);
    await db.exec("RESET ROLE");
  }
  console.log(`Timekeeping overtime PostgreSQL checks: ${passed} passed.`);
} finally {
  await db.close();
}
