import {
  EMPLOYEE_ATTESTATION,
  addDays,
  buildDays,
  confirmDays,
  currentSheet,
  localDate,
  periodFor,
  splitShift,
  validateDays,
  validateSchedule,
  type Clock,
  type Employee,
  type Sheet,
} from "./model";
import type { TimekeepingApi, TimekeepingBoot } from "./client";
export type PreviewScenario = "first-visit" | "completed-period";

/** Per-preview, in-memory transport. No network, database, storage or real signatures. */
export function createEmployeePreview(
  scenario: PreviewScenario,
  now = () => new Date(),
): TimekeepingApi {
  const today = localDate(now()),
    currentPeriod = periodFor(today);
  const period =
    scenario === "completed-period"
      ? periodFor(addDays(currentPeriod.start, -1))
      : currentPeriod;
  const employee: Employee = {
    id: "preview-employee",
    staff_person: "Preview",
    name: "Taylor Example",
    email: "taylor@example.test",
    payroll_id: "DEMO-101",
    pay_basis: "hourly",
    manager_id: "preview-craig",
    enabled: true,
    starts_on: scenario === "first-visit" ? today : period.start,
    ends_on: null,
    schedule:
      scenario === "first-visit"
        ? null
        : {
            weekdays: [1, 2, 3, 4, 5],
            start: "07:00",
            end: "16:30",
            breakRule: "oregon_adult",
            unpaidBreak: 60,
            lunch: { start: "12:00", end: "13:00" },
            paidBreak: 20,
          },
    version: 1,
  };
  const makeSheet = (start: string): Sheet => {
    const p = periodFor(start);
    return {
      id: `preview-${start}`,
      employee_id: employee.id,
      employee_name: employee.name,
      payroll_id: employee.payroll_id,
      pay_basis: employee.pay_basis,
      period_start: p.start,
      period_end: p.end,
      state: "draft",
      days: buildDays(employee, p.start, p.end),
      note: "",
      reason: "",
      version: 1,
      review_manager_id: employee.manager_id,
      approved_by: null,
      approved_at: null,
    };
  };
  let sheets = [makeSheet(period.start)],
    clock: Clock = { employee_id: employee.id, version: 1, shift: null };
  const events: {
    id: string;
    sheet_id: string;
    actor: string;
    action: string;
    reason: string;
    created_at: string;
    before_data: unknown;
    after_data: unknown;
  }[] = [];
  if (scenario === "completed-period") {
    const sheet = sheets[0],
      workDays = sheet.days.filter((d) => d.shifts.length);
    workDays[0].miles = 12.5;
    workDays[0].note = "Example property visit";
    workDays[0].exception = true;
    if (workDays[1])
      Object.assign(workDays[1], {
        shifts: [],
        leave: [{ kind: "vacation", minutes: 480 }],
        exception: true,
      });
    sheet.note =
      "Fictional period for practicing employee review and sign-off.";
  }
  const boot = (): TimekeepingBoot => ({
    employee,
    isAdmin: false,
    canReview: false,
    sheet: currentSheet(sheets, localDate(now())) ?? null,
    clock,
    today: localDate(now()),
    employees: [],
  });
  const record = (sheet: Sheet, action: string, before: unknown) =>
    events.push({
      id: crypto.randomUUID(),
      sheet_id: sheet.id,
      actor: employee.email,
      action,
      reason: "Fictional preview only",
      created_at: now().toISOString(),
      before_data: before,
      after_data: structuredClone(sheet),
    });
  const handle = (path: string, body?: Record<string, unknown>): unknown => {
    if (!body) {
      if (!path) return boot();
      const params = new URLSearchParams(path.replace(/^\?/, ""));
      if (params.get("view") === "history")
        return events.filter((e) => e.sheet_id === params.get("id"));
      throw new Error("This preview contains only the employee screens.");
    }
    if (body.op === "schedule") {
      if (body.version !== employee.version)
        throw new Error("Reload before saving your defaults.");
      employee.schedule = validateSchedule(body.schedule);
      employee.version++;
      return employee;
    }
    if (body.op === "clock") {
      if (body.clockVersion !== clock.version)
        throw new Error("The clock changed. Reload before continuing.");
      const at = now().toISOString(),
        date = localDate(now()),
        active = currentSheet(sheets, date)!;
      if (body.action === "in") {
        if (clock.shift) throw new Error("You are already clocked in.");
        if (
          active.period_start !== periodFor(date).start ||
          !["draft", "returned"].includes(active.state)
        )
          throw new Error(
            "Submit your unfinished prior sheet before clocking into this period.",
          );
        const day = active.days.find((d) => d.date === date)!;
        if (day.leave.length)
          throw new Error("Resolve today’s leave before clocking in.");
        day.shifts = day.shifts.filter((s) => s.source !== "scheduled");
        day.off = false;
        day.exception = true;
        active.version++;
        clock.shift = {
          id: crypto.randomUUID(),
          start: at,
          end: null,
          breaks: [],
          source: "clocked",
        };
      } else {
        const shift = structuredClone(clock.shift);
        if (!shift) throw new Error("Clock in first.");
        const open = shift.breaks.find((b) => b.start && !b.end);
        if (body.action === "break") {
          if (open) throw new Error("End your current break first.");
          shift.breaks.push({
            id: crypto.randomUUID(),
            start: at,
            end: null,
            minutes: 0,
            paid: body.paid === true,
          });
          clock.shift = shift;
        } else if (body.action === "resume") {
          if (!open) throw new Error("There is no open break.");
          open.end = at;
          clock.shift = shift;
        } else if (body.action === "out" || body.action === "correct") {
          let end = at;
          if (body.action === "correct") {
            end = String(body.end);
            if (
              !String(body.reason || "").trim() ||
              !Number.isFinite(Date.parse(end)) ||
              Date.parse(end) > now().getTime()
            )
              throw new Error(
                "Enter a past clock-out time and correction reason.",
              );
          }
          shift.end = end;
          if (open) open.end = end;
          const next = structuredClone(sheets);
          for (const part of splitShift(shift)) {
            let s = next.find(
              (s) => s.period_start === periodFor(part.date).start,
            );
            if (!s) {
              s = makeSheet(part.date);
              next.push(s);
            }
            if (!["draft", "returned"].includes(s.state))
              throw new Error("This timesheet is locked.");
            const day = s.days.find((d) => d.date === part.date)!;
            day.off = false;
            day.exception = true;
            day.shifts = [
              ...day.shifts.filter((s) => s.source !== "scheduled"),
              part.shift,
            ].sort((a, b) => a.start.localeCompare(b.start));
            validateDays(s.days, s.period_start, s.period_end, false, now());
            s.version++;
          }
          sheets = next;
          clock.shift = null;
        } else throw new Error("Unknown preview clock action.");
      }
      clock.version++;
      return clock;
    }
    const sheet = sheets.find((s) => s.id === body.sheetId);
    if (!sheet || sheet.id !== currentSheet(sheets, localDate(now()))?.id)
      throw new Error("This sheet is not available in the employee preview.");
    if (body.version !== sheet.version)
      throw new Error("Another change was saved. Reload before continuing.");
    if (!["draft", "returned"].includes(sheet.state))
      throw new Error("This timesheet is locked.");
    if (clock.shift)
      throw new Error("Clock out before editing or submitting your sheet.");
    const before = structuredClone(sheet);
    if (body.op === "save") {
      const days = validateDays(
        body.days,
        sheet.period_start,
        sheet.period_end,
        false,
        now(),
      );
      if (typeof body.note !== "string" || body.note.length > 2000)
        throw new Error("Check your pay-period notes.");
      sheet.days = days.map((d) => ({
        ...d,
        exception:
          sheet.days.find((old) => old.date === d.date)?.exception ||
          JSON.stringify(sheet.days.find((old) => old.date === d.date)) !==
            JSON.stringify(d),
        shifts: d.shifts.map((s) => {
          const old = sheet.days
            .find((d) => d.date === localDate(new Date(s.start)))
            ?.shifts.find((old) => old.id === s.id);
          return old && JSON.stringify(old) === JSON.stringify(s)
            ? s
            : { ...s, source: "manual" as const };
        }),
      }));
      sheet.note = body.note;
    } else if (body.op === "refresh") {
      const fresh = buildDays(employee, sheet.period_start, sheet.period_end);
      sheet.days = sheet.days.map((d, i) =>
        !d.emergency &&
        !d.emergencyPhone &&
        !d.exception &&
        !d.note &&
        !d.miles &&
        !d.leave.length &&
        d.shifts.every((s) => s.source === "scheduled")
          ? fresh[i]
          : d,
      );
    } else if (body.op === "submit") {
      if (body.attested !== true)
        throw new Error("Confirm your employee signature before submitting.");
      if (sheet.period_end > localDate(now()))
        throw new Error("Submit at the end of the period.");
      validateDays(
        sheet.days,
        sheet.period_start,
        sheet.period_end,
        true,
        now(),
      );
      sheet.days = confirmDays(sheet.days);
      sheet.state = "submitted";
      sheet.employee_signed_by = employee.email;
      sheet.employee_signed_name = employee.name;
      sheet.employee_signed_at = now().toISOString();
      sheet.employee_signed_version = sheet.version + 1;
      sheet.employee_attestation = EMPLOYEE_ATTESTATION;
      if (
        sheet.period_start !== currentPeriod.start &&
        !sheets.some((s) => s.period_start === currentPeriod.start)
      )
        sheets.push(makeSheet(currentPeriod.start));
    } else
      throw new Error("This action is unavailable in the employee preview.");
    sheet.version++;
    record(sheet, body.op as string, before);
    return sheet;
  };
  return async <T>(path = "", body?: Record<string, unknown>): Promise<T> =>
    structuredClone(handle(path, body)) as T;
}
