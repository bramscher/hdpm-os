import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = await PGlite.create();
let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed++;
};
const reject = async (fn, pattern) => {
  await assert.rejects(fn, pattern);
  passed++;
};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE staff(person text primary key,name text,email text,active boolean default true,access_role text default 'staff');
    INSERT INTO staff(person,name,email,access_role) VALUES ('Admin','Admin','admin@example.test','admin'),('Manager','Manager','manager@example.test','manager'),('Employee','Employee','employee@example.test','staff'),('Other','Other','other@example.test','staff');`);
  const migration = await readFile(
    new URL("../supabase/migrations/20260915_timekeeping.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  const autoMigration = await readFile(
    new URL(
      "../supabase/migrations/20260915_timekeeping_auto_enroll.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(autoMigration);
  const adminScheduleMigration = await readFile(
    new URL(
      "../supabase/migrations/20260915_timekeeping_admin_schedule.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(adminScheduleMigration);
  await db.exec(adminScheduleMigration);

  await db.exec(autoMigration);

  passed++;
  await db.exec(
    `INSERT INTO timekeeping_employee(staff_person,name,email,starts_on) SELECT person,name,email,'2026-01-01' FROM staff;`,
  );
  const staff = (await db.query("SELECT * FROM timekeeping_employee")).rows;
  const find = (name) => staff.find((s) => s.staff_person === name);
  const admin = find("Admin"),
    manager = find("Manager"),
    employee = find("Employee"),
    other = find("Other");
  const call = async (actor, request) =>
    (
      await db.query("SELECT timekeeping_apply($1,$2::jsonb) AS result", [
        actor,
        JSON.stringify(request),
      ])
    ).rows[0].result;
  await call(admin.email, {
    op: "employee",
    employeeId: employee.id,
    version: 1,
    payrollId: "P-1",
    payBasis: "salary",
    enabled: true,
    managerId: manager.id,
    startsOn: "2026-01-01",
    endsOn: "",
  });
  await db.exec(
    `INSERT INTO timekeeping_period VALUES ('2026-01-01','2026-01-15','hdpm');`,
  );
  const created = (
    await db.query(
      `INSERT INTO timekeeping_sheet(employee_id,period_start,period_end,employee_name,review_manager_id,days) VALUES($1,'2026-01-01','2026-01-15','Employee',$2,'[]') RETURNING *`,
      [employee.id, manager.id],
    )
  ).rows[0];
  let s = created;
  await reject(
    () =>
      call(other.email, {
        op: "save",
        sheetId: s.id,
        version: s.version,
        days: [],
      }),
    /FORBIDDEN/,
  );
  s = await call(employee.email, {
    op: "save",
    sheetId: s.id,
    version: s.version,
    days: [],
    note: "Period notes",
  });
  check(s.note === "Period notes", "notes saved");
  await reject(
    () =>
      call(employee.email, {
        op: "save",
        sheetId: s.id,
        version: s.version - 1,
        days: [],
      }),
    /CONFLICT/,
  );
  await reject(
    () =>
      call(employee.email, {
        op: "submit",
        sheetId: s.id,
        version: s.version,
        days: [],
      }),
    /signature/,
  );
  s = await call(employee.email, {
    op: "submit",
    sheetId: s.id,
    version: s.version,
    days: [],
    attested: true,
  });
  check(
    s.employee_signed_by === employee.email &&
      s.employee_signed_name === "Employee" &&
      !!s.employee_signed_at &&
      s.employee_signed_version === s.version &&
      s.employee_attestation.includes("Microsoft"),
    "employee identity and server timestamp signature",
  );
  check(
    s.pay_basis === "salary" && s.state === "submitted",
    "salary snapshot and submission",
  );
  await reject(
    () =>
      call(employee.email, {
        op: "approve",
        sheetId: s.id,
        version: s.version,
      }),
    /FORBIDDEN/,
  );
  await reject(
    () =>
      call(admin.email, { op: "approve", sheetId: s.id, version: s.version }),
    /FORBIDDEN/,
  );
  await reject(
    () => call(admin.email, { op: "export", period: "2026-01-01" }),
    /approved sheet/,
  );
  await reject(
    () =>
      call(employee.email, {
        op: "save",
        sheetId: s.id,
        version: s.version,
        days: [],
      }),
    /FORBIDDEN|locked/,
  );
  s = await call(manager.email, {
    op: "return",
    sheetId: s.id,
    version: s.version,
    reason: "Check Tuesday",
  });
  check(
    s.state === "returned" && s.employee_signed_at === null,
    "manager returns and invalidates current signature",
  );
  s = await call(employee.email, {
    op: "submit",
    sheetId: s.id,
    version: s.version,
    days: [],
    attested: true,
  });
  s = await call(manager.email, {
    op: "approve",
    sheetId: s.id,
    version: s.version,
  });
  check(s.approved_by === manager.email, "actual reviewer attribution");
  const first = await call(admin.email, { op: "export", period: "2026-01-01" });
  check(
    first.snapshot.sheets[0].note === "Period notes" && first.version === 1,
    "snapshot contains detail",
  );
  await reject(
    () => call(other.email, { op: "export", period: "2026-01-01" }),
    /FORBIDDEN/,
  );
  s = await call(admin.email, {
    op: "reopen",
    sheetId: s.id,
    version: s.version,
    reason: "Correction",
  });
  s = await call(admin.email, {
    op: "save",
    sheetId: s.id,
    version: s.version,
    days: [],
    note: "Corrected note",
    reason: "Correction",
  });
  check(
    s.employee_signed_at === null,
    "admin correction cannot impersonate employee signature",
  );
  await reject(
    () =>
      call(admin.email, {
        op: "submit",
        sheetId: s.id,
        version: s.version,
        days: [],
        attested: true,
      }),
    /FORBIDDEN/,
  );
  s = await call(employee.email, {
    op: "submit",
    sheetId: s.id,
    version: s.version,
    days: [],
    attested: true,
  });
  s = await call(manager.email, {
    op: "approve",
    sheetId: s.id,
    version: s.version,
  });
  const second = await call(admin.email, {
    op: "export",
    period: "2026-01-01",
  });
  check(
    second.version === 2 && second.snapshot.sheets[0].note === "Corrected note",
    "versioned correction",
  );
  const original = (
    await db.query("SELECT snapshot FROM timekeeping_export WHERE id=$1", [
      first.id,
    ])
  ).rows[0].snapshot;
  check(
    original.sheets[0].employee_signed_by === employee.email &&
      original.sheets[0].note === "Period notes",
    "original snapshot unchanged",
  );
  await reject(
    () =>
      db.query("UPDATE timekeeping_export SET version=99 WHERE id=$1", [
        first.id,
      ]),
    /append-only/,
  );
  await reject(() => db.exec("DELETE FROM timekeeping_event"), /append-only/);
  const clock = await call(employee.email, {
    op: "clock",
    clockVersion: 1,
    shift: {
      id: "test",
      start: new Date().toISOString(),
      end: null,
      breaks: [],
      source: "clocked",
    },
    sheets: [],
  });
  await reject(
    () =>
      call(employee.email, {
        op: "clock",
        clockVersion: 1,
        shift: null,
        sheets: [],
      }),
    /CONFLICT/,
  );
  check(clock.version === 2, "one clock transition");
  await db.exec("SET ROLE anon");
  await reject(
    () => db.query("SELECT * FROM timekeeping_sheet"),
    /permission denied/,
  );
  await reject(
    () => call(admin.email, { op: "export", period: "2026-01-01" }),
    /permission denied/,
  );
  await db.exec("RESET ROLE; SET ROLE authenticated");
  await reject(
    () => db.query("SELECT * FROM timekeeping_export"),
    /permission denied/,
  );
  await db.exec("RESET ROLE");

  const enroll = async (actor, reviewer) =>
    (
      await db.query("SELECT timekeeping_auto_enroll($1,$2) AS result", [
        actor,
        reviewer,
      ])
    ).rows[0].result;
  let enrolled = await enroll(other.email, manager.staff_person);
  check(
    enrolled.enabled &&
      enrolled.manager_id === manager.id &&
      enrolled.version === 2,
    "first visit auto-enrolls with configured reviewer",
  );
  check(
    (await enroll(other.email, manager.staff_person)).version === 2,
    "repeated visits leave enrollment unchanged",
  );
  const enrollmentEvents = (
    await db.query(
      "SELECT * FROM timekeeping_event WHERE employee_id=$1 AND action='auto_enroll'",
      [other.id],
    )
  ).rows;
  check(
    enrollmentEvents.length === 1 && enrollmentEvents[0].actor === other.email,
    "one atomic enrollment event with employee actor",
  );
  check(
    !(await enroll(manager.email, manager.staff_person)).enabled,
    "default manager does not enroll as own reviewer",
  );
  await reject(
    () => enroll("unknown@example.test", manager.staff_person),
    /FORBIDDEN/,
  );
  enrolled = await call(admin.email, {
    op: "employee",
    employeeId: other.id,
    version: enrolled.version,
    payrollId: "",
    payBasis: "hourly",
    enabled: false,
    managerId: manager.id,
    startsOn: enrolled.starts_on,
    endsOn: enrolled.starts_on,
  });
  check(
    !(await enroll(other.email, manager.staff_person)).enabled,
    "ended enrollment is never reactivated on login",
  );
  await db.exec("SET ROLE anon");
  await reject(
    () => enroll(other.email, manager.staff_person),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
  const setSchedule = async (actor, employeeId, version, schedule) =>
    (
      await db.query(
        "SELECT timekeeping_admin_schedule($1,$2::uuid,$3,$4::jsonb) AS result",
        [actor, employeeId, version, JSON.stringify(schedule)],
      )
    ).rows[0].result;
  const scheduleTarget = (
    await db.query("SELECT * FROM timekeeping_employee WHERE id=$1", [
      employee.id,
    ])
  ).rows[0];
  const schedule = {
    weekdays: [1, 2, 3, 4, 5],
    start: "07:00",
    end: "16:30",
    lunch: { start: "12:00", end: "13:00" },
    unpaidBreak: 60,
    paidBreak: 20,
  };
  const payrollBefore = (
    await db.query(
      "SELECT id,version,days,state FROM timekeeping_sheet ORDER BY id",
    )
  ).rows;
  await reject(
    () =>
      setSchedule(manager.email, employee.id, scheduleTarget.version, schedule),
    /FORBIDDEN/,
  );
  await reject(
    () =>
      setSchedule(
        employee.email,
        employee.id,
        scheduleTarget.version,
        schedule,
      ),
    /FORBIDDEN/,
  );
  const updatedSchedule = await setSchedule(
    admin.email,
    employee.id,
    scheduleTarget.version,
    schedule,
  );
  check(
    updatedSchedule.version === scheduleTarget.version + 1 &&
      updatedSchedule.schedule.start === "07:00",
    "admin updates employee schedule atomically",
  );
  const scheduleEvent = (
    await db.query(
      "SELECT actor,before_data,after_data FROM timekeeping_event WHERE employee_id=$1 AND action='admin_schedule'",
      [employee.id],
    )
  ).rows;
  check(
    scheduleEvent.length === 1 &&
      scheduleEvent[0].actor === admin.email &&
      scheduleEvent[0].after_data.version === updatedSchedule.version,
    "admin schedule audit records actual administrator and versions",
  );
  await reject(
    () =>
      setSchedule(admin.email, employee.id, scheduleTarget.version, schedule),
    /CONFLICT/,
  );
  check(
    JSON.stringify(
      (
        await db.query(
          "SELECT id,version,days,state FROM timekeeping_sheet ORDER BY id",
        )
      ).rows,
    ) === JSON.stringify(payrollBefore),
    "schedule update does not rewrite any timesheet or approval",
  );
  await db.exec("SET ROLE anon");
  await reject(
    () =>
      setSchedule(admin.email, employee.id, updatedSchedule.version, schedule),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
  console.log(
    `Timekeeping PostgreSQL checks: ${passed} passed (migration replay, roles, CAS, approvals, history, exports, clock, private access).`,
  );
} catch (e) {
  console.error(
    `Timekeeping PostgreSQL test failed: ${e.message}\n${e.internalQuery || ""}`,
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
