// The 20261044 running-clock migration, run the way Craig runs it: pasted whole into the Supabase SQL
// Editor, or one statement at a time, each twice, on fresh PGlite databases that already hold the
// earlier timekeeping migrations. PGlite has no Supabase roles or staff table, so this harness (not
// the migration) creates them.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const dir = path.resolve(__dirname, "../../../supabase/migrations");
const FILE = "20261044_timekeeping_running_clock.sql";
const migration = readFileSync(path.join(dir, FILE), "utf8");

/** Split a script into statements: `;` ends one, except inside quotes, dollar quotes and comments. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let buf = "",
    i = 0,
    dollar: string | null = null,
    quote = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        buf += dollar;
        i += dollar.length;
        dollar = null;
      } else buf += sql[i++];
      continue;
    }
    if (quote) {
      buf += ch;
      i++;
      if (ch === "'") quote = false;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (ch === "'") {
      quote = true;
      buf += ch;
      i++;
      continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (tag) {
      dollar = tag[0];
      buf += dollar;
      i += dollar.length;
      continue;
    }
    if (ch === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function base(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE staff(person text primary key,name text,email text,active boolean default true,access_role text default 'staff');
    INSERT INTO staff(person,name,email,access_role) VALUES
      ('Admin','Test Admin','admin@example.test','admin'),
      ('Reviewer','Test Reviewer','reviewer@example.test','manager'),
      ('Worker','Test Worker','worker@example.test','staff'),
      ('Other','Other Worker','other@example.test','staff');`);
  for (const name of readdirSync(dir)
    .filter((f) => f.includes("timekeeping") && f.endsWith(".sql") && f !== FILE)
    .sort())
    await db.exec(readFileSync(path.join(dir, name), "utf8"));
  return db;
}

type Row = Record<string, unknown>;
const CHECK = [
  {
    function_name: "timekeeping_admin_clock",
    security_definer: true,
    has_running_clock_fixes: true,
  },
  {
    function_name: "timekeeping_apply",
    security_definer: true,
    has_running_clock_fixes: true,
  },
];

describe("20261044 running-clock migration in PGlite", () => {
  let db: PGlite;
  const ids: Record<string, string> = {};
  let sheetId = "",
    lockedId = "",
    today = "";

  beforeAll(async () => {
    // Whole script, twice: the last result set is the read-only check.
    db = await base();
    for (let run = 0; run < 2; run++) {
      const results = await db.exec(migration);
      expect(results.at(-1)!.rows).toEqual(CHECK);
    }
    for (const r of (await db.query<Row>("SELECT id, staff_person FROM timekeeping_employee")).rows)
      ids[String(r.staff_person)] = String(r.id);
    if (!ids.Worker) {
      await db.exec(
        `INSERT INTO timekeeping_employee(staff_person,name,email,starts_on) SELECT person,name,email,'2026-01-01' FROM staff`,
      );
      for (const r of (await db.query<Row>("SELECT id, staff_person FROM timekeeping_employee")).rows)
        ids[String(r.staff_person)] = String(r.id);
    }
    await db.query(
      `UPDATE timekeeping_employee SET enabled = true, manager_id = $1 WHERE staff_person IN ('Worker','Other','Admin')`,
      [ids.Reviewer],
    );
    today = String(
      (await db.query<Row>(`SELECT ((now() AT TIME ZONE 'America/Los_Angeles')::date)::text AS d`)).rows[0].d,
    );
    const [y, m, d] = today.split("-").map(Number);
    const start = `${today.slice(0, 7)}-${d <= 15 ? "01" : "16"}`;
    const end =
      d <= 15
        ? `${today.slice(0, 7)}-15`
        : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO timekeeping_period(start_date,end_date) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [start, end],
    );
    sheetId = String(
      (
        await db.query<Row>(
          `INSERT INTO timekeeping_sheet(employee_id,period_start,period_end,employee_name,days) VALUES($1,$2,$3,'Test Worker','[]') RETURNING id`,
          [ids.Worker, start, end],
        )
      ).rows[0].id,
    );
    lockedId = String(
      (
        await db.query<Row>(
          `INSERT INTO timekeeping_sheet(employee_id,period_start,period_end,employee_name,days,state) VALUES($1,$2,$3,'Other Worker','[]','approved') RETURNING id`,
          [ids.Other, start, end],
        )
      ).rows[0].id,
    );
  }, 120_000);

  it("runs statement by statement on a fresh database, twice, with the same check result", async () => {
    const fresh = await base();
    const parts = statements(migration);
    expect(parts.length).toBe(8);
    for (let run = 0; run < 2; run++) {
      let last: Row[] = [];
      for (const sql of parts) last = (await fresh.query<Row>(sql)).rows;
      expect(last).toEqual(CHECK);
    }
    await fresh.close();
  }, 120_000);

  const apply = async (actor: string, request: Row) =>
    (
      await db.query<{ r: Row }>("SELECT timekeeping_apply($1,$2::jsonb) AS r", [
        actor,
        JSON.stringify(request),
      ])
    ).rows[0].r;
  const admin = async (actor: string, request: Row) =>
    (
      await db.query<{ r: Row }>("SELECT timekeeping_admin_clock($1,$2::jsonb) AS r", [
        actor,
        JSON.stringify(request),
      ])
    ).rows[0].r;
  const clock = async (who: string) =>
    (await db.query<Row>("SELECT * FROM timekeeping_clock WHERE employee_id = $1", [ids[who]])).rows[0];
  // Events written in one transaction share created_at, and quick calls can tie, so filter by action.
  const lastEvents = async (n: number, action: string) =>
    (
      await db.query<Row>(
        "SELECT actor, action, reason, sheet_id, before_data, after_data FROM timekeeping_event WHERE action = $2 ORDER BY created_at DESC, id LIMIT $1",
        [n, action],
      )
    ).rows;
  const shift = (id: string, start: string) => ({
    id,
    start,
    end: null,
    source: "clocked",
    breaks: [],
  });
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
  const sheetVersion = async (id: string) =>
    Number((await db.query<Row>("SELECT version FROM timekeeping_sheet WHERE id = $1", [id])).rows[0].version);

  it("keeps the code before this PR working: a clock request without clockAction", async () => {
    const c = await apply("worker@example.test", {
      op: "clock",
      clockVersion: 1,
      shift: shift("w1", ago(60)),
      sheets: [],
    });
    expect((c.shift as Row).id).toBe("w1");
    const [event] = await lastEvents(1, "clock");
    expect(event).toMatchObject({ actor: "worker@example.test", action: "clock", sheet_id: null });
  });

  it("worker fix-start needs a reason, keeps the same entry, and is logged under the sheet", async () => {
    const v = Number((await clock("Worker")).version);
    await expect(
      apply("worker@example.test", { op: "clock", clockAction: "fix_start", clockVersion: v, shift: shift("w1", ago(90)), reason: " " }),
    ).rejects.toThrow(/reason/);
    await expect(
      apply("worker@example.test", { op: "clock", clockAction: "fix_start", clockVersion: v, shift: shift("other", ago(90)), reason: "Started early" }),
    ).rejects.toThrow(/same running entry/);
    const fixed = ago(90);
    const c = await apply("worker@example.test", {
      op: "clock",
      clockAction: "fix_start",
      clockVersion: v,
      shift: shift("w1", fixed),
      reason: "Started early",
    });
    expect((c.shift as Row).start).toBe(fixed);
    const [event] = await lastEvents(1, "clock_fix_start");
    expect(event).toMatchObject({
      actor: "worker@example.test",
      action: "clock_fix_start",
      reason: "Started early",
      sheet_id: sheetId,
    });
    expect(((event.before_data as Row).shift as Row).id).toBe("w1");
  });

  it("worker cancel clears the entry, saves the restored days and logs both with the reason", async () => {
    const v = Number((await clock("Worker")).version);
    const sv = await sheetVersion(sheetId);
    await expect(
      apply("worker@example.test", { op: "clock", clockAction: "cancel", clockVersion: v, shift: shift("w1", ago(90)), reason: "Mistake" }),
    ).rejects.toThrow(/no running entry/);
    const c = await apply("worker@example.test", {
      op: "clock",
      clockAction: "cancel",
      clockVersion: v,
      shift: null,
      reason: "Clocked in by mistake",
      sheets: [{ id: sheetId, version: sv, days: [{ date: today, restored: true }] }],
    });
    expect(c.shift).toBeNull();
    const events = await lastEvents(5, "clock_cancel");
    expect(events.length).toBe(2);
    for (const e of events)
      expect(e).toMatchObject({ actor: "worker@example.test", reason: "Clocked in by mistake", sheet_id: sheetId });
    // Nothing is hard-deleted: the cancelled entry is in the event's before_data.
    const clockEvent = events.find((e) => "shift" in (e.before_data as Row))!;
    expect(((clockEvent.before_data as Row).shift as Row).id).toBe("w1");
    await expect(
      apply("worker@example.test", { op: "clock", clockAction: "cancel", clockVersion: v + 1, shift: null, reason: "again" }),
    ).rejects.toThrow(/not running/);
  });

  it("the event log can't be changed or deleted", async () => {
    await expect(db.query("DELETE FROM timekeeping_event")).rejects.toThrow(/append-only/);
    await expect(db.query("UPDATE timekeeping_event SET reason = ''")).rejects.toThrow(/append-only/);
  });

  it("admin clock fixes: admins only, a reason, someone else's running clock", async () => {
    let v = Number((await clock("Worker")).version);
    await apply("worker@example.test", { op: "clock", clockAction: "in", clockVersion: v, shift: shift("w2", ago(30)), sheets: [] });
    v++;
    const request = { employeeId: ids.Worker, clockAction: "fix_start", clockVersion: v, shift: shift("w2", ago(45)), reason: "Forgot to clock in" };
    await expect(admin("reviewer@example.test", request)).rejects.toThrow(/FORBIDDEN/);
    await expect(admin("worker@example.test", request)).rejects.toThrow(/FORBIDDEN/);
    await expect(admin("admin@example.test", { ...request, reason: "" })).rejects.toThrow(/reason/);
    await expect(admin("admin@example.test", { ...request, clockAction: "in" })).rejects.toThrow(/Unknown clock action/);
    await expect(admin("admin@example.test", { ...request, employeeId: ids.Admin })).rejects.toThrow(/own clock/);
    await expect(admin("admin@example.test", { ...request, employeeId: ids.Other })).rejects.toThrow(/not clocked in/);
    await expect(admin("admin@example.test", { ...request, clockVersion: v - 1 })).rejects.toThrow(/CONFLICT/);
    const c = await admin("admin@example.test", request);
    expect((c.shift as Row).start).toBe(request.shift.start);
    expect(await lastEvents(5, "admin_clock_fix_start")).toMatchObject([
      { actor: "admin@example.test", action: "admin_clock_fix_start", reason: "Forgot to clock in", sheet_id: sheetId },
    ]);
  });

  it("admin stop and cancel write sheets only for that employee's editable sheets", async () => {
    const v = Number((await clock("Worker")).version);
    await expect(
      admin("admin@example.test", { employeeId: ids.Worker, clockAction: "stop", clockVersion: v, shift: null, reason: "Left early", sheets: [{ id: lockedId, version: 1, days: [] }] }),
    ).rejects.toThrow(/locked timesheet/);
    const sv = await sheetVersion(sheetId);
    const c = await admin("admin@example.test", {
      employeeId: ids.Worker,
      clockAction: "stop",
      clockVersion: v,
      shift: null,
      reason: "Left at 3, phone died",
      sheets: [{ id: sheetId, version: sv, days: [{ date: today, stopped: true }] }],
    });
    expect(c.shift).toBeNull();
    const events = await lastEvents(5, "admin_clock_stop");
    expect(events.map((e) => [e.actor, e.action, e.reason, e.sheet_id])).toEqual([
      ["admin@example.test", "admin_clock_stop", "Left at 3, phone died", sheetId],
      ["admin@example.test", "admin_clock_stop", "Left at 3, phone died", sheetId],
    ]);
    expect(
      (await db.query<Row>("SELECT days FROM timekeeping_sheet WHERE id = $1", [sheetId])).rows[0].days,
    ).toEqual([{ date: today, stopped: true }]);
  });

  it("admin cancel clears a running clock with a reason", async () => {
    let v = Number((await clock("Worker")).version);
    await apply("worker@example.test", { op: "clock", clockAction: "in", clockVersion: v, shift: shift("w3", ago(5)), sheets: [] });
    v++;
    await expect(
      admin("admin@example.test", { employeeId: ids.Worker, clockAction: "cancel", clockVersion: v, shift: shift("w3", ago(5)), reason: "Mistake" }),
    ).rejects.toThrow(/no running entry/);
    const c = await admin("admin@example.test", { employeeId: ids.Worker, clockAction: "cancel", clockVersion: v, shift: null, reason: "Pocket tap" });
    expect(c.shift).toBeNull();
    const events = await lastEvents(5, "admin_clock_cancel");
    expect(events.length).toBe(1);
    const [event] = events;
    expect(event).toMatchObject({ actor: "admin@example.test", action: "admin_clock_cancel", reason: "Pocket tap", sheet_id: sheetId });
    expect(((event.before_data as Row).shift as Row).id).toBe("w3");
  });
  // Review of 0f32dae: a clock-only request (no changed sheets) must still respect the lock on the
  // sheet under the running shift's start and the corrected start. A refusal changes nothing.
  describe("locked sheets under the running shift", () => {
    const snapshot = async (who: string, sheet: string) => ({
      clock: await clock(who),
      sheet: (await db.query<Row>("SELECT state, version, days FROM timekeeping_sheet WHERE id = $1", [sheet])).rows[0],
      events: Number((await db.query<Row>("SELECT count(*)::int AS n FROM timekeeping_event")).rows[0].n),
    });

    it("refuses worker and admin cancel with no changed sheets when the origin sheet is approved", async () => {
      // Seeded state: Other's running clock starts on their approved current sheet.
      await db.query(
        `INSERT INTO timekeeping_clock(employee_id, version, shift) VALUES($1, 3, $2::jsonb)
         ON CONFLICT (employee_id) DO UPDATE SET version = 3, shift = EXCLUDED.shift`,
        [ids.Other, JSON.stringify(shift("o1", ago(20)))],
      );
      const before = await snapshot("Other", lockedId);
      await expect(
        apply("other@example.test", { op: "clock", clockAction: "cancel", clockVersion: 3, shift: null, reason: "Mistake", sheets: [] }),
      ).rejects.toThrow(/locked timesheet; ask your manager to reopen it/);
      await expect(
        admin("admin@example.test", { employeeId: ids.Other, clockAction: "cancel", clockVersion: 3, shift: null, reason: "Pocket tap", sheets: [] }),
      ).rejects.toThrow(/locked timesheet; reopen it first/);
      await expect(
        apply("other@example.test", { op: "clock", clockAction: "fix_start", clockVersion: 3, shift: shift("o1", ago(30)), reason: "Earlier", sheets: [] }),
      ).rejects.toThrow(/locked timesheet/);
      expect(await snapshot("Other", lockedId)).toEqual(before);
    });

    it("allows a same-day fix start on a draft sheet with no changed sheets", async () => {
      const v = Number((await clock("Worker")).version);
      await apply("worker@example.test", { op: "clock", clockAction: "in", clockVersion: v, shift: shift("w4", ago(10)), sheets: [] });
      const fixed = ago(15);
      const c = await apply("worker@example.test", { op: "clock", clockAction: "fix_start", clockVersion: v + 1, shift: shift("w4", fixed), reason: "Same day", sheets: [] });
      expect((c.shift as Row).start).toBe(fixed);
    });

    it("refuses a cross-period fix start onto a locked, empty earlier day", async () => {
      await db.query(`INSERT INTO timekeeping_period(start_date,end_date) VALUES('2026-01-01','2026-01-15') ON CONFLICT DO NOTHING`);
      const earlier = String(
        (
          await db.query<Row>(
            `INSERT INTO timekeeping_sheet(employee_id,period_start,period_end,employee_name,days,state)
             VALUES($1,'2026-01-01','2026-01-15','Test Worker','[]','approved') RETURNING id`,
            [ids.Worker],
          )
        ).rows[0].id,
      );
      const v = Number((await clock("Worker")).version);
      const before = await snapshot("Worker", earlier);
      const draftBefore = await snapshot("Worker", sheetId);
      await expect(
        admin("admin@example.test", { employeeId: ids.Worker, clockAction: "fix_start", clockVersion: v, shift: shift("w4", "2026-01-15T18:00:00.000Z"), reason: "Earlier", sheets: [] }),
      ).rejects.toThrow(/locked timesheet; reopen it first/);
      await expect(
        apply("worker@example.test", { op: "clock", clockAction: "fix_start", clockVersion: v, shift: shift("w4", "2026-01-15T18:00:00.000Z"), reason: "Earlier", sheets: [] }),
      ).rejects.toThrow(/locked timesheet/);
      expect(await snapshot("Worker", earlier)).toEqual(before);
      expect((await snapshot("Worker", sheetId)).sheet).toEqual(draftBefore.sheet);
      // A version conflict is still reported as a conflict.
      await expect(
        admin("admin@example.test", { employeeId: ids.Worker, clockAction: "cancel", clockVersion: v - 1, shift: null, reason: "x" }),
      ).rejects.toThrow(/CONFLICT/);
    });
  });
});
