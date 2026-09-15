import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isCompanyEmail } from "@/lib/require-role";
import {
  addDays,
  buildDays,
  canReadSheet,
  confirmDays,
  currentSheet,
  localDate,
  periodFor,
  splitShift,
  validateDays,
  validateSchedule,
  validDate,
  type Clock,
  type Day,
  type Employee,
  type Sheet,
  type Shift,
} from "./model";

export class TimeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function checked<T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): T {
  if (result.error) {
    const msg = result.error.message;
    if (
      result.error.code === "42P01" ||
      result.error.code === "PGRST205" ||
      result.error.code === "PGRST202"
    )
      throw new TimeError(
        "Timekeeping setup is not complete. An administrator needs to apply the timekeeping database migration.",
        503,
      );
    throw new TimeError(
      msg,
      msg.includes("FORBIDDEN") ? 403 : msg.includes("CONFLICT") ? 409 : 400,
    );
  }
  return result.data;
}
export type Context = { email: string; isAdmin: boolean; employee: Employee };
export async function context(): Promise<Context> {
  const session = await auth();
  if (!isCompanyEmail(session?.user?.email))
    throw new TimeError("Please sign in with your company account.", 401);
  const email = session!.user!.email!.toLowerCase();
  const db = getSupabaseAdmin();
  const staff = checked(
    await db
      .from("staff")
      .select("person,name,email,access_role")
      .eq("active", true)
      .ilike("email", email),
  );
  if (staff?.length !== 1)
    throw new TimeError(
      "Your account needs a unique active staff-directory entry. Please contact an administrator.",
      403,
    );
  const person = staff[0];
  checked(
    await db
      .from("timekeeping_employee")
      .upsert(
        {
          staff_person: person.person,
          email,
          name: person.name || person.person,
        },
        { onConflict: "staff_person", ignoreDuplicates: true },
      ),
  );
  const employee = checked(
    await db
      .from("timekeeping_employee")
      .select("*")
      .eq("staff_person", person.person)
      .single(),
  ) as Employee;
  if (employee.email !== email)
    throw new TimeError(
      "Your staff email changed. Ask an administrator to reconcile your timekeeping account.",
      403,
    );
  return { email, isAdmin: person.access_role === "admin", employee };
}
async function directory() {
  const db = getSupabaseAdmin();
  const staff =
    checked(
      await db
        .from("staff")
        .select("person,name,email")
        .eq("active", true)
        .not("email", "is", null),
    ) ?? [];
  const emails = staff.map((s) => s.email.toLowerCase());
  if (new Set(emails).size !== emails.length)
    throw new TimeError(
      "Resolve duplicate staff email addresses before enrolling employees.",
    );
  if (staff.length)
    checked(
      await db.from("timekeeping_employee").upsert(
        staff.map((s) => ({
          staff_person: s.person,
          name: s.name || s.person,
          email: s.email.toLowerCase(),
        })),
        { onConflict: "staff_person", ignoreDuplicates: true },
      ),
    );
}
export async function employees(): Promise<Employee[]> {
  return checked(
    await getSupabaseAdmin()
      .from("timekeeping_employee")
      .select("*")
      .order("name"),
  ) as Employee[];
}
export async function ensureSheets(
  employee: Employee,
  through = localDate(),
): Promise<void> {
  if (!employee.enabled && !employee.ends_on) return;
  const end =
    employee.ends_on && employee.ends_on < through ? employee.ends_on : through;
  if (employee.starts_on > end) return;
  const db = getSupabaseAdmin();
  // Generate missing periods only; changes to defaults never rewrite saved sheets.
  const existing =
    checked(
      await db
        .from("timekeeping_sheet")
        .select("period_start")
        .eq("employee_id", employee.id),
    ) ?? [];
  const found = new Set(existing.map((s) => s.period_start));
  let start = periodFor(employee.starts_on).start,
    count = 0;
  while (start <= end) {
    const p = periodFor(start);
    if (!found.has(start)) {
      if (++count > 120)
        throw new TimeError(
          "More than five years of sheets need backfilling. Open again to continue, or check the enrollment date.",
        );
      checked(
        await db
          .from("timekeeping_period")
          .upsert(
            { start_date: p.start, end_date: p.end },
            { onConflict: "start_date", ignoreDuplicates: true },
          ),
      );
      checked(
        await db
          .from("timekeeping_sheet")
          .upsert(
            {
              employee_id: employee.id,
              period_start: p.start,
              period_end: p.end,
              review_manager_id: employee.manager_id,
              employee_name: employee.name,
              payroll_id: employee.payroll_id,
              pay_basis: employee.pay_basis,
              days: buildDays(employee, p.start, p.end),
            },
            { onConflict: "employee_id,period_start", ignoreDuplicates: true },
          ),
      );
    }
    start = addDays(p.end, 1);
  }
}
export async function ownSheets(employeeId: string): Promise<Sheet[]> {
  return checked(
    await getSupabaseAdmin()
      .from("timekeeping_sheet")
      .select("*")
      .eq("employee_id", employeeId)
      .order("period_start"),
  ) as Sheet[];
}
export async function getClock(employeeId: string): Promise<Clock> {
  const db = getSupabaseAdmin();
  checked(
    await db
      .from("timekeeping_clock")
      .upsert(
        { employee_id: employeeId },
        { onConflict: "employee_id", ignoreDuplicates: true },
      ),
  );
  return checked(
    await db
      .from("timekeeping_clock")
      .select("*")
      .eq("employee_id", employeeId)
      .single(),
  ) as Clock;
}
export async function authorizedSheet(
  ctx: Context,
  id: string,
): Promise<Sheet> {
  const s = checked(
    await getSupabaseAdmin()
      .from("timekeeping_sheet")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  ) as Sheet | null;
  const current = currentSheet(await ownSheets(ctx.employee.id), localDate());
  if (!s || !canReadSheet(s, ctx.employee.id, ctx.isAdmin, current?.id))
    throw new TimeError("Timesheet not available to this account.", 403);
  return s;
}
async function apply(ctx: Context, request: Record<string, unknown>) {
  return checked(
    await getSupabaseAdmin().rpc("timekeeping_apply", {
      p_actor: ctx.email,
      p_request: request,
    }),
  );
}
export async function bootstrap(ctx: Context) {
  if (ctx.isAdmin) await directory();
  const all = await employees();
  const assigned = checked(
    await getSupabaseAdmin()
      .from("timekeeping_sheet")
      .select("id")
      .eq("review_manager_id", ctx.employee.id)
      .neq("employee_id", ctx.employee.id)
      .limit(1),
  );
  const canReview =
    !!assigned?.length ||
    all.some(
      (e) => e.manager_id === ctx.employee.id && e.id !== ctx.employee.id,
    );
  const managed = all.filter(
    (e) =>
      ctx.isAdmin ||
      e.id === ctx.employee.id ||
      e.manager_id === ctx.employee.id,
  );
  for (const e of managed) await ensureSheets(e);
  const own = currentSheet(await ownSheets(ctx.employee.id), localDate());
  return {
    employee: ctx.employee,
    isAdmin: ctx.isAdmin,
    canReview,
    sheet: own ?? null,
    clock: await getClock(ctx.employee.id),
    today: localDate(),
    employees: ctx.isAdmin ? all : [],
  };
}
export async function listSheets(ctx: Context, period?: string) {
  if (period && (!validDate(period) || periodFor(period).start !== period))
    throw new TimeError("Choose a valid pay period.");
  const rows: Sheet[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = getSupabaseAdmin()
      .from("timekeeping_sheet")
      .select("*")
      .order("period_start", { ascending: false })
      .order("id");
    if (!ctx.isAdmin)
      query = query
        .eq("review_manager_id", ctx.employee.id)
        .neq("employee_id", ctx.employee.id);
    if (period) query = query.eq("period_start", period);
    const page = checked(await query.range(offset, offset + 499)) as Sheet[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export async function history(ctx: Context, id: string) {
  await authorizedSheet(ctx, id);
  return checked(
    await getSupabaseAdmin()
      .from("timekeeping_event")
      .select("id,actor,action,reason,created_at,before_data,after_data")
      .eq("sheet_id", id)
      .order("created_at", { ascending: false }),
  );
}
const noteText = (value: unknown, max = 2000): string => {
  if (typeof value !== "string" || value.length > max)
    throw new TimeError(`Notes must be under ${max} characters.`);
  return value;
};
const version = (value: unknown): number => {
  if (!Number.isInteger(value) || Number(value) < 1)
    throw new TimeError("A saved version is required. Reload the page.");
  return Number(value);
};

export async function command(ctx: Context, body: Record<string, unknown>) {
  const op = body.op;
  if (op === "schedule") {
    const schedule = validateSchedule(body.schedule);
    return apply(ctx, {
      op,
      employeeId: ctx.employee.id,
      version: version(body.version),
      schedule,
    });
  }
  if (op === "employee") {
    if (!ctx.isAdmin) throw new TimeError("Admin access required.", 403);
    const all = await employees(),
      employee = all.find((e) => e.id === body.employeeId);
    if (
      !employee ||
      typeof body.enabled !== "boolean" ||
      !["hourly", "salary"].includes(String(body.payBasis))
    )
      throw new TimeError("Choose an employee and Hourly or Salary.");
    const manager = all.find((e) => e.id === body.managerId);
    if (body.enabled && (!manager || manager.id === employee.id))
      throw new TimeError("Choose another employee as the reviewer.");
    const staff = manager
      ? checked(
          await getSupabaseAdmin()
            .from("staff")
            .select("active")
            .eq("person", manager.staff_person)
            .single(),
        )
      : null;
    if (body.enabled && !staff?.active)
      throw new TimeError("The reviewer must have an active staff account.");
    if (
      !validDate(String(body.startsOn)) ||
      (body.endsOn &&
        (!validDate(String(body.endsOn)) ||
          String(body.endsOn) < String(body.startsOn)))
    )
      throw new TimeError("Check enrollment dates.");
    if (employee.enabled && !body.enabled && !body.endsOn)
      throw new TimeError(
        "Set a last participating day when ending enrollment.",
      );
    if ((await getClock(employee.id)).shift && !body.enabled)
      throw new TimeError("Clock out before ending enrollment.");
    return apply(ctx, {
      op,
      employeeId: employee.id,
      version: version(body.version),
      payrollId: noteText(body.payrollId, 100),
      payBasis: body.payBasis,
      enabled: body.enabled,
      managerId: manager?.id ?? "",
      startsOn: body.startsOn,
      endsOn: body.endsOn || "",
    });
  }
  if (op === "export") {
    if (!ctx.isAdmin) throw new TimeError("Admin access required.", 403);
    if (!validDate(String(body.period)))
      throw new TimeError("Choose a pay period.");
    for (const e of await employees()) await ensureSheets(e);
    return apply(ctx, { op, period: body.period });
  }
  if (op === "clock") return clockCommand(ctx, body);
  if (
    !["save", "submit", "approve", "return", "reopen", "refresh"].includes(
      String(op),
    )
  )
    throw new TimeError("Unknown action.");
  const sheet = await authorizedSheet(ctx, String(body.sheetId));
  if (sheet.version !== version(body.version))
    throw new TimeError(
      "Another change was saved. Reload before continuing.",
      409,
    );
  let days = sheet.days;
  const reason = noteText(body.reason ?? "");
  if (op === "save") {
    days = validateDays(body.days, sheet.period_start, sheet.period_end);
    // Any altered scheduled/clocked entry becomes a manual exception. Clients
    // cannot manufacture a clock source or retain scheduled status for future actuals.
    days = days.map((d) => ({
      ...d,
      exception:
        sheet.days.find((x) => x.date === d.date)?.exception ||
        JSON.stringify(sheet.days.find((x) => x.date === d.date)) !==
          JSON.stringify(d),
      shifts: d.shifts.map((s) => {
        const previous = sheet.days
          .find((x) => x.date === d.date)
          ?.shifts.find((x) => x.id === s.id);
        return previous && JSON.stringify(previous) === JSON.stringify(s)
          ? s
          : { ...s, source: "manual" as const };
      }),
    }));
    validateDays(days, sheet.period_start, sheet.period_end);
  }
  if (op === "refresh") {
    if (sheet.employee_id !== ctx.employee.id)
      throw new TimeError("Only your own schedule can be applied.", 403);
    const fresh = buildDays(ctx.employee, sheet.period_start, sheet.period_end);
    days = sheet.days.map((d, i) =>
      !d.exception &&
      !d.note &&
      !d.miles &&
      !d.leave.length &&
      d.shifts.every((s) => s.source === "scheduled")
        ? fresh[i]
        : d,
    );
    validateDays(days, sheet.period_start, sheet.period_end);
  }
  if (op === "submit") {
    if (body.attested !== true)
      throw new TimeError("Confirm your employee signature before submitting.");
    if ((await getClock(sheet.employee_id)).shift)
      throw new TimeError("Clock out before submitting.");
    validateDays(days, sheet.period_start, sheet.period_end, true);
    days = confirmDays(days);
  }
  if (op === "approve")
    validateDays(days, sheet.period_start, sheet.period_end, true);
  return apply(ctx, {
    op: op === "refresh" ? "save" : op,
    sheetId: sheet.id,
    version: sheet.version,
    days,
    reason,
    attested: op === "submit" && body.attested === true,
    note: op === "save" ? noteText(body.note ?? "") : sheet.note,
  });
}

async function clockCommand(ctx: Context, body: Record<string, unknown>) {
  if (!ctx.employee.enabled)
    throw new TimeError("Ask an administrator to enroll you first.", 403);
  const clock = await getClock(ctx.employee.id);
  if (clock.version !== version(body.clockVersion))
    throw new TimeError(
      "The clock changed on another device. Reload before continuing.",
      409,
    );
  const now = new Date(),
    at = now.toISOString(),
    today = localDate(now),
    changes: Sheet[] = [];
  await ensureSheets(ctx.employee, today);
  const own = await ownSheets(ctx.employee.id),
    current = currentSheet(own, today);
  let shift: Shift | null = clock.shift ? structuredClone(clock.shift) : null;
  const action = body.action;
  if (action === "in") {
    if (shift) throw new TimeError("You are already clocked in.");
    const sheet = own.find((s) => s.period_start === periodFor(today).start);
    if (
      !sheet ||
      sheet.id !== current?.id ||
      !["draft", "returned"].includes(sheet.state)
    )
      throw new TimeError(
        "Submit your unfinished prior sheet before clocking into this period.",
      );
    const day = sheet.days.find((d) => d.date === today)!;
    if (
      day.leave.length ||
      day.shifts.some(
        (s) =>
          s.source !== "scheduled" &&
          s.end &&
          Date.parse(s.end) > now.getTime(),
      )
    )
      throw new TimeError(
        "Resolve today’s leave or overlapping time before clocking in.",
      );
    const nextDay: Day = {
      ...day,
      off: false,
      exception: true,
      shifts: day.shifts.filter((s) => s.source !== "scheduled"),
    };
    // Remove the continuation of tonight's scheduled shift from tomorrow, too.
    const placeholderIds = new Set(
      day.shifts
        .filter((s) => s.source === "scheduled")
        .map((s) => s.id.split(":").slice(0, 2).join(":")),
    );
    for (const candidate of own) {
      const days = candidate.days.map((d) =>
        d.date === today
          ? nextDay
          : d.date < today
            ? d
            : {
                ...d,
                shifts: d.shifts.filter(
                  (s) =>
                    s.source !== "scheduled" ||
                    !placeholderIds.has(s.id.split(":").slice(0, 2).join(":")),
                ),
              },
      );
      if (JSON.stringify(days) !== JSON.stringify(candidate.days))
        changes.push({ ...candidate, days });
    }
    shift = {
      id: crypto.randomUUID(),
      start: at,
      end: null,
      source: "clocked",
      breaks: [],
    };
  } else {
    if (!shift) throw new TimeError("Clock in first.");
    const open = shift.breaks.find((b) => b.start && !b.end);
    if (action === "break") {
      if (open) throw new TimeError("You already have an open break.");
      if (typeof body.paid !== "boolean")
        throw new TimeError("Choose paid or unpaid break.");
      shift.breaks.push({
        id: crypto.randomUUID(),
        start: at,
        end: null,
        minutes: 0,
        paid: body.paid,
      });
    } else if (action === "resume") {
      if (!open) throw new TimeError("There is no open break.");
      open.end = at;
    } else if (action === "out" || action === "correct") {
      let ended = at;
      if (action === "correct") {
        if (
          !body.end ||
          !Number.isFinite(Date.parse(String(body.end))) ||
          Date.parse(String(body.end)) > now.getTime()
        )
          throw new TimeError("Enter a valid past clock-out time.");
        if (!noteText(body.reason ?? "").trim())
          throw new TimeError("Explain the clock correction.");
        ended = new Date(String(body.end)).toISOString();
      }
      if (open) open.end = ended;
      shift.end = ended;
      for (const part of splitShift(shift)) {
        await ensureSheets(ctx.employee, part.date);
        let sheet = changes.find(
          (s) => s.period_start === periodFor(part.date).start,
        );
        if (!sheet) {
          const found = (await ownSheets(ctx.employee.id)).find(
            (s) => s.period_start === periodFor(part.date).start,
          );
          if (!found)
            throw new TimeError(
              "No sheet for this clock interval. Contact an administrator.",
            );
          sheet = structuredClone(found);
          changes.push(sheet);
        }
        const d = sheet.days.find((x) => x.date === part.date)!;
        d.off = false;
        d.exception = true;
        d.shifts = [
          ...d.shifts.filter((s) => s.source !== "scheduled"),
          part.shift,
        ].sort((a, b) => a.start.localeCompare(b.start));
        validateDays(
          sheet.days,
          sheet.period_start,
          sheet.period_end,
          false,
          now,
        );
      }
      shift = null;
    } else throw new TimeError("Unknown clock action.");
  }
  return apply(ctx, {
    op: "clock",
    clockVersion: clock.version,
    shift,
    reason: action === "correct" ? noteText(body.reason) : "",
    sheets: changes.map((s) => ({
      id: s.id,
      version: s.version,
      days: s.days,
    })),
  });
}

export async function exportRows(ctx: Context, id?: string) {
  if (!ctx.isAdmin) throw new TimeError("Admin access required.", 403);
  if (id)
    return checked(
      await getSupabaseAdmin()
        .from("timekeeping_export")
        .select("*")
        .eq("id", id)
        .single(),
    );
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page =
      checked(
        await getSupabaseAdmin()
          .from("timekeeping_export")
          .select("id,period_start,version,created_at,created_by")
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499),
      ) ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
