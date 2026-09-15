"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import TimeSelect from "./time-select";
import {
  displayTime,
  displayDate,
  displayPeriod,
} from "@/lib/timekeeping/presentation";
import { oregonScheduleBreaks } from "@/lib/timekeeping/break-defaults";
import type {
  TimekeepingApi,
  TimekeepingBoot as Boot,
} from "@/lib/timekeeping/client";
import {
  Clock3,
  Download,
  Users,
  CalendarDays,
  CheckCircle2,
  Settings2,
  ArrowLeft,
  Plus,
  Coffee,
} from "lucide-react";
import {
  EMPLOYEE_ATTESTATION,
  DEFAULT_SCHEDULE,
  addDays,
  blankDay,
  breakMinutes,
  duration,
  editDayShift,
  hours,
  LEAVE_LABELS,
  localDate,
  localTime,
  periodFor,
  totals,
  validateSchedule,
  wallTime,
  type Clock,
  type Day,
  type Employee,
  type Leave,
  type Schedule,
  type Sheet,
} from "@/lib/timekeeping/model";

type ExportRow = {
  id: string;
  period_start: string;
  version: number;
  created_at: string;
  created_by: string;
};
type EventRow = {
  id: string;
  actor: string;
  action: string;
  reason: string;
  created_at: string;
  before_data: unknown;
  after_data: unknown;
};
async function liveApi<T>(
  path = "",
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`/api/timekeeping${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Request failed. Please try again.");
  return data as T;
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong.";
const labelPeriod = (s: { period_start: string; period_end: string }) =>
  displayPeriod(s.period_start, s.period_end);

const ApiContext = createContext<TimekeepingApi>(liveApi);
export default function Timekeeping({
  request = liveApi,
}: {
  request?: TimekeepingApi;
}) {
  return (
    <ApiContext.Provider value={request}>
      <TimekeepingView />
    </ApiContext.Provider>
  );
}
function TimekeepingView() {
  const api = useContext(ApiContext);
  const [data, setData] = useState<Boot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [view, setView] = useState<"mine" | "review" | "payroll" | "settings">(
    "mine",
  );
  const [sheets, setSheets] = useState<Sheet[]>([]),
    [selected, setSelected] = useState<Sheet | null>(null),
    [exports, setExports] = useState<ExportRow[]>([]);
  const [period, setPeriod] = useState(""),
    [person, setPerson] = useState("");
  async function load() {
    const d = await api<Boot>();
    setData(d);
    return d;
  }
  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function navigate(next: typeof view) {
    if (dirty) {
      setError(
        "Save or discard your timesheet changes before switching views.",
      );
      return;
    }
    await perform(async () => {
      setSelected(null);
      setView(next);
      if (next === "review" || next === "payroll")
        setSheets(await api<Sheet[]>("?view=review"));
      if (next === "payroll")
        setExports(await api<ExportRow[]>("?view=exports"));
      if (next === "mine" || next === "settings") await load();
    });
  }
  const periods = [...new Set(sheets.map((s) => s.period_start))];
  const activePeriod = period || periods[0] || periodFor(localDate()).start;
  const filtered = sheets.filter(
    (s) =>
      (view !== "payroll" || s.period_start === activePeriod) &&
      (!person || s.employee_id === person),
  );
  return (
    <main className="tk-app">
      <header className="tk-heading">
        <div>
          <p className="tk-eyebrow">COMPANY / TIMEKEEPING</p>
          <h1>A clear record of your time.</h1>
          <p>Work, leave and miles. Reviewed once, ready for payroll.</p>
        </div>
        <span className="tk-period-chip">
          <CalendarDays size={17} /> 1–15 & 16–month end · Pacific time
        </span>
      </header>
      {data?.isAdmin && (
        <div className="tk-preview-entry">
          <Link href="/timekeeping/preview">Employee preview →</Link>
          <small>Try the employee screens with fictional data.</small>
        </div>
      )}
      {receipt && (
        <div className="tk-notice" role="status">
          {receipt}
        </div>
      )}
      {error && (
        <div className="tk-alert" role="alert">
          {error}
          <button
            disabled={dirty}
            onClick={() =>
              perform(async () => {
                await load();
              })
            }
          >
            Retry
          </button>
        </div>
      )}
      {!data ? (
        <p role="status">
          {error
            ? "Timekeeping will be available after setup is complete."
            : "Loading your timesheet…"}
        </p>
      ) : (
        <>
          <nav className="tk-nav" aria-label="Timekeeping views">
            <button
              disabled={busy}
              aria-current={view === "mine" ? "page" : undefined}
              onClick={() => navigate("mine")}
            >
              <Clock3 size={17} /> My time
            </button>
            {(data.canReview || data.isAdmin) && (
              <button
                disabled={busy}
                aria-current={view === "review" ? "page" : undefined}
                onClick={() => navigate("review")}
              >
                <CheckCircle2 size={17} /> Review
              </button>
            )}
            {data.isAdmin && (
              <button
                disabled={busy}
                aria-current={view === "payroll" ? "page" : undefined}
                onClick={() => navigate("payroll")}
              >
                <Download size={17} /> Payroll & history
              </button>
            )}
            <button
              disabled={busy}
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={17} />{" "}
              {data.isAdmin ? "People & defaults" : "My defaults"}
            </button>
          </nav>
          {view === "mine" && (
            <>
              {!data.employee.enabled ? (
                <div className="tk-panel">
                  <h2>Your timekeeping account is ready for setup.</h2>
                  <p>
                    An administrator needs to enroll you and assign a reviewer.
                    You can choose your usual hours in My defaults.
                  </p>
                  {data.isAdmin && (
                    <button
                      className="tk-primary"
                      onClick={() => navigate("settings")}
                    >
                      Set up employees
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <ClockPanel
                    clock={data.clock}
                    disabled={dirty}
                    onChange={async (body) => {
                      await api("", body);
                      await load();
                    }}
                  />
                  {!data.employee.schedule && (
                    <div className="tk-notice">
                      Set your usual days and hours in{" "}
                      <button onClick={() => navigate("settings")}>
                        My defaults
                      </button>{" "}
                      to prefill your sheet.
                    </div>
                  )}
                  {data.sheet ? (
                    <SheetEditor
                      key={`${data.sheet.id}:${data.sheet.version}`}
                      initial={data.sheet}
                      actorId={data.employee.id}
                      actorEmail={data.employee.email}
                      onNotice={setReceipt}
                      onSigned={(signed) =>
                        setReceipt(
                          `Signed and submitted ${labelPeriod(signed)} as ${signed.employee_signed_by} on ${new Date(signed.employee_signed_at!).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}. Your manager will review it.`,
                        )
                      }
                      isAdmin={false}
                      clockOpen={!!data.clock.shift}
                      onDirty={setDirty}
                      onComplete={async () => {
                        await load();
                      }}
                    />
                  ) : (
                    <p>Your first sheet opens on your enrollment date.</p>
                  )}
                </>
              )}
            </>
          )}
          {(view === "review" || view === "payroll") &&
            (selected ? (
              <>
                <button
                  className="tk-back"
                  disabled={dirty}
                  onClick={() => {
                    setSelected(null);
                    navigate(view);
                  }}
                >
                  <ArrowLeft size={16} /> Back to{" "}
                  {view === "review" ? "review" : "payroll"}
                </button>
                <SheetEditor
                  key={`${selected.id}:${selected.version}`}
                  initial={selected}
                  actorId={data.employee.id}
                  actorEmail={data.employee.email}
                  onNotice={setReceipt}
                  onSigned={(signed) =>
                    setReceipt(
                      `Signed and submitted ${labelPeriod(signed)} as ${signed.employee_signed_by} on ${new Date(signed.employee_signed_at!).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}. Your manager will review it.`,
                    )
                  }
                  isAdmin={data.isAdmin}
                  clockOpen={false}
                  onDirty={setDirty}
                  onComplete={async () => {
                    const rows = await api<Sheet[]>("?view=review");
                    setSheets(rows);
                    setSelected(rows.find((s) => s.id === selected.id) || null);
                  }}
                />
              </>
            ) : (
              <>
                <section className="tk-panel">
                  <div className="tk-section-heading">
                    <div>
                      <h2>
                        {view === "review"
                          ? "Timesheets to review"
                          : "Payroll periods"}
                      </h2>
                      <p>
                        {view === "review"
                          ? "Open the detail before approving. Returned sheets go back to the employee."
                          : "All employees, all retained periods. Final exports include approved sheets only."}
                      </p>
                    </div>
                    <div className="tk-toolbar">
                      {view === "payroll" && (
                        <label>
                          Pay period
                          <select
                            value={activePeriod}
                            onChange={(e) => setPeriod(e.target.value)}
                          >
                            {periods.map((p) => (
                              <option key={p} value={p}>
                                {p} – {periodFor(p).end}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {data.isAdmin && (
                        <label>
                          Employee
                          <select
                            value={person}
                            onChange={(e) => setPerson(e.target.value)}
                          >
                            <option value="">All employees</option>
                            {data.employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="tk-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Employee / period</th>
                          <th>Pay basis</th>
                          <th>Work / scheduled</th>
                          <th>Leave</th>
                          <th>Miles</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((s) => {
                          const t = totals(s.days);
                          return (
                            <tr key={s.id}>
                              <td>
                                <strong>{s.employee_name}</strong>
                                <small>{labelPeriod(s)}</small>
                              </td>
                              <td>
                                <span className="tk-basis">{s.pay_basis}</span>
                              </td>
                              <td>
                                {hours(t.worked)}h
                                <small>{hours(t.scheduled)}h scheduled</small>
                              </td>
                              <td>
                                {hours(
                                  t.vacation +
                                    t.sick +
                                    t.loa_paid +
                                    t.loa_unpaid,
                                )}
                                h
                              </td>
                              <td>{t.miles}</td>
                              <td>
                                <span className={`tk-badge ${s.state}`}>
                                  {s.state}
                                </span>
                              </td>
                              <td>
                                <button onClick={() => setSelected(s)}>
                                  Open detail →
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!filtered.length && (
                    <p className="tk-empty">
                      No timesheets to show. Enroll employees to generate their
                      periods.
                    </p>
                  )}
                  {view === "payroll" && (
                    <div className="tk-export-action">
                      <p>
                        Hourly and salary staff both require manager approval.
                        The report records hours and miles; payroll calculates
                        pay.
                      </p>
                      <button
                        className="tk-primary"
                        disabled={
                          busy ||
                          !sheets.some((s) => s.period_start === activePeriod)
                        }
                        onClick={() =>
                          perform(async () => {
                            const row = await api<ExportRow>("", {
                              op: "export",
                              period: activePeriod,
                            });
                            setExports(await api<ExportRow[]>("?view=exports"));
                            window.location.assign(
                              `/api/timekeeping/export?id=${row.id}`,
                            );
                          })
                        }
                      >
                        <Download size={17} /> Create Excel payroll summary
                      </button>
                    </div>
                  )}
                </section>
                {view === "payroll" && (
                  <section className="tk-panel">
                    <h2>Saved payroll packages</h2>
                    <p>
                      Every version stays available. Use the latest version when
                      a correction has been made.
                    </p>
                    {exports.length ? (
                      exports
                        .filter((e) => !period || e.period_start === period)
                        .map((e) => (
                          <div className="tk-export-row" key={e.id}>
                            <div>
                              <strong>
                                {displayPeriod(
                                  e.period_start,
                                  periodFor(e.period_start).end,
                                )}{" "}
                                · Version {e.version}
                              </strong>
                              <small>
                                {new Date(e.created_at).toLocaleString()} ·{" "}
                                {e.created_by}
                              </small>
                            </div>
                            <a href={`/api/timekeeping/export?id=${e.id}`}>
                              <Download size={16} /> Excel
                            </a>
                          </div>
                        ))
                    ) : (
                      <p>No payroll packages created yet.</p>
                    )}
                  </section>
                )}
              </>
            ))}
          {view === "settings" && (
            <>
              <ScheduleEditor employee={data.employee} onSaved={load} />
              {data.isAdmin && (
                <section className="tk-panel">
                  <div className="tk-section-heading">
                    <div>
                      <h2>
                        <Users size={19} /> Employee setup
                      </h2>
                      <p>
                        Choose Hourly or Salary, a payroll ID and an assigned
                        manager. All employees still enter time.
                      </p>
                    </div>
                  </div>
                  {data.employees.map((e) => (
                    <EmployeeEditor
                      key={`${e.id}:${e.version}`}
                      employee={e}
                      employees={data.employees}
                      onSaved={load}
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function ClockPanel({
  clock,
  disabled,
  onChange,
}: {
  clock: Clock;
  disabled: boolean;
  onChange: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [correct, setCorrect] = useState(false),
    [end, setEnd] = useState(""),
    [reason, setReason] = useState("");
  const openBreak = clock.shift?.breaks.some((b) => b.start && !b.end);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (disabled) {
      setError("Save your timesheet changes before using the clock.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onChange({
        op: "clock",
        action,
        clockVersion: clock.version,
        ...extra,
      });
      setCorrect(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tk-clock">
      <div>
        <span className={`tk-dot ${clock.shift ? "on" : ""}`} />
        <div>
          <strong>
            {openBreak
              ? "On a break"
              : clock.shift
                ? "Clocked in"
                : "Ready when you are"}
          </strong>
          <p>
            {clock.shift
              ? `Started ${localDate(new Date(clock.shift.start))} at ${displayTime(localTime(clock.shift.start))}`
              : "Use the clock, or enter an exception in your sheet below."}
          </p>
        </div>
      </div>
      <div className="tk-toolbar">
        {!clock.shift ? (
          <button
            className="tk-primary"
            disabled={busy}
            onClick={() => act("in")}
          >
            <Clock3 size={17} /> Clock in
          </button>
        ) : (
          <>
            {openBreak ? (
              <button disabled={busy} onClick={() => act("resume")}>
                End break
              </button>
            ) : (
              <>
                <button
                  disabled={busy}
                  onClick={() => act("break", { paid: false })}
                >
                  <Coffee size={15} /> Unpaid break
                </button>
                <button
                  disabled={busy}
                  onClick={() => act("break", { paid: true })}
                >
                  Paid break
                </button>
              </>
            )}
            <button
              className="tk-primary"
              disabled={busy}
              onClick={() => act("out")}
            >
              Clock out
            </button>
            <button disabled={busy} onClick={() => setCorrect(!correct)}>
              Missed clock-out?
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="tk-error" role="alert">
          {error}
        </p>
      )}
      {correct && (
        <form
          className="tk-correction"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const [date, time] = end.split("T");
              void act("correct", { end: wallTime(date, time), reason });
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          <label>
            Actual end date (Pacific)
            <input
              required
              type="date"
              value={end.split("T")[0] || ""}
              onChange={(e) =>
                setEnd(`${e.target.value}T${end.split("T")[1] || "12:00"}`)
              }
            />
          </label>
          <label>
            Actual end time (Pacific)
            <TimeSelect
              allowExact
              value={end.split("T")[1] || ""}
              onChange={(value) =>
                setEnd(`${end.split("T")[0] || localDate()}T${value}`)
              }
            />
          </label>
          <label>
            Correction reason
            <input
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={busy}>Record corrected clock-out</button>
        </form>
      )}
    </section>
  );
}

function ScheduleEditor({
  employee,
  onSaved,
}: {
  employee: Employee;
  onSaved: () => Promise<unknown>;
}) {
  const api = useContext(ApiContext);
  const [s, setS] = useState<Schedule>(
      employee.schedule || structuredClone(DEFAULT_SCHEDULE),
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  function setHours(field: "start" | "end", value: string) {
    const next = { ...s, [field]: value };
    if (next.breakRule === "oregon_adult" && next.start !== next.end)
      Object.assign(
        next,
        oregonScheduleBreaks(
          next.start,
          next.end,
          next.lunch ? next.unpaidBreak : undefined,
        ),
      );
    setS(next);
  }
  function setLunch(field: "start" | "end", value: string) {
    const lunch = { ...s.lunch!, [field]: value };
    const toMinutes = (time: string) =>
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const unpaidBreak =
      (toMinutes(lunch.end) - toMinutes(lunch.start) + 1440) % 1440;
    const next = { ...s, lunch, unpaidBreak };
    if (s.breakRule === "oregon_adult" && s.start !== s.end)
      Object.assign(next, oregonScheduleBreaks(s.start, s.end, unpaidBreak));
    setS(next);
  }
  return (
    <section className="tk-panel">
      <h2>Your usual week</h2>
      <p>
        These are draft defaults. You confirm them when submitting; exceptions
        and clock punches replace them.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            await api("", {
              op: "schedule",
              version: employee.version,
              schedule: validateSchedule(s),
            });
            await onSaved();
            setMessage(
              "Defaults saved. Open My time and apply them to untouched days.",
            );
          } catch (err) {
            setMessage(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="tk-weekdays">
          <legend>Scheduled workdays</legend>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, i) => (
            <label key={label}>
              <input
                type="checkbox"
                checked={s.weekdays.includes(i)}
                onChange={(e) =>
                  setS({
                    ...s,
                    weekdays: e.target.checked
                      ? [...s.weekdays, i]
                      : s.weekdays.filter((d) => d !== i),
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="tk-form-grid">
          <label>
            Usual start
            <TimeSelect
              value={s.start}
              onChange={(value) => setHours("start", value)}
            />
          </label>
          <label>
            Usual end
            <TimeSelect
              value={s.end}
              onChange={(value) => setHours("end", value)}
            />
          </label>
          {s.lunch && (
            <>
              <label>
                Usual lunch start
                <TimeSelect
                  value={s.lunch.start}
                  onChange={(value) => setLunch("start", value)}
                />
              </label>
              <label>
                Usual lunch end
                <TimeSelect
                  value={s.lunch.end}
                  onChange={(value) => setLunch("end", value)}
                />
              </label>
            </>
          )}
          <label>
            Unpaid break minutes
            <input
              min="0"
              max="240"
              type="number"
              required
              value={s.unpaidBreak}
              readOnly={!!s.lunch}
              onChange={(e) =>
                setS({
                  ...s,
                  unpaidBreak: Number(e.target.value),
                  breakRule: "custom",
                })
              }
            />
          </label>
          <label>
            Paid break minutes
            <input
              min="0"
              max="240"
              type="number"
              required
              value={s.paidBreak}
              onChange={(e) =>
                setS({
                  ...s,
                  paidBreak: Number(e.target.value),
                  breakRule: "custom",
                })
              }
            />
          </label>
        </div>
        <label className="tk-checkbox">
          <input
            type="checkbox"
            checked={!!s.lunch}
            onChange={(e) => {
              const next = {
                ...s,
                lunch: e.target.checked
                  ? { start: "12:00", end: "13:00" }
                  : undefined,
              };
              if (next.lunch) next.unpaidBreak = 60;
              if (next.breakRule === "oregon_adult" && next.start !== next.end)
                Object.assign(
                  next,
                  oregonScheduleBreaks(
                    next.start,
                    next.end,
                    next.lunch ? next.unpaidBreak : undefined,
                  ),
                );
              setS(next);
            }}
          />
          Set lunch start and end times
        </label>
        <label className="tk-checkbox">
          <input
            type="checkbox"
            checked={s.breakRule === "oregon_adult"}
            onChange={(e) => {
              if (e.target.checked) {
                try {
                  setS({
                    ...s,
                    ...oregonScheduleBreaks(
                      s.start,
                      s.end,
                      s.lunch ? s.unpaidBreak : undefined,
                    ),
                    breakRule: "oregon_adult",
                  });
                } catch (err) {
                  setMessage(errorText(err));
                }
              } else setS({ ...s, breakRule: "custom" });
            }}
          />
          Suggest paid rest breaks for my usual hours (Oregon adult baseline)
        </label>
        <p className="tk-help">
          Our starting schedule includes a one-hour unpaid lunch and two
          separate 10-minute paid rest breaks. Choose your own usual lunch
          window for staggered coverage, then adjust each day's entries to the
          breaks actually taken. Lunch minutes are calculated from its start and
          end. Suggested paid rest totals adjust to your hours. Paid breaks
          remain in worked time. Record any interrupted or working meal as paid
          time; do not deduct it. These draft allowances must match breaks
          actually taken.{" "}
          <a
            href="https://www.oregon.gov/boli/workers/pages/meals-and-breaks.aspx"
            target="_blank"
            rel="noreferrer"
          >
            Oregon BOLI guidance
          </a>
          . Adult, non-exempt baseline; exceptions need manager review. An end
          before the start means an overnight schedule.
        </p>
        <button className="tk-primary" disabled={busy}>
          Save my defaults
        </button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}

function EmployeeEditor({
  employee: e,
  employees,
  onSaved,
}: {
  employee: Employee;
  employees: Employee[];
  onSaved: () => Promise<unknown>;
}) {
  const api = useContext(ApiContext);
  const [form, setForm] = useState({
      enabled: e.enabled,
      payrollId: e.payroll_id,
      payBasis: e.pay_basis,
      managerId: e.manager_id || "",
      startsOn: e.starts_on,
      endsOn: e.ends_on || "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="tk-employee">
      <summary>
        <strong>{e.name}</strong>
        <span>
          {form.enabled ? "Enrolled" : "Not enrolled"} ·{" "}
          {e.pay_basis === "salary" ? "Salary" : "Hourly"}
        </span>
      </summary>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("", {
              op: "employee",
              employeeId: e.id,
              version: e.version,
              ...form,
            });
            await onSaved();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>{e.email}</p>
        <div className="tk-form-grid">
          <label>
            Pay basis
            <select
              value={form.payBasis}
              onChange={(ev) =>
                setForm({
                  ...form,
                  payBasis: ev.target.value as "hourly" | "salary",
                })
              }
            >
              <option value="hourly">Hourly</option>
              <option value="salary">Salary · time entry still required</option>
            </select>
          </label>
          <label>
            Payroll employee ID
            <input
              maxLength={100}
              value={form.payrollId}
              onChange={(ev) =>
                setForm({ ...form, payrollId: ev.target.value })
              }
            />
          </label>
          <label>
            Approving manager
            <select
              value={form.managerId}
              onChange={(ev) =>
                setForm({ ...form, managerId: ev.target.value })
              }
            >
              <option value="">Choose reviewer…</option>
              {employees
                .filter((p) => p.id !== e.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            First participating day
            <input
              required
              type="date"
              value={form.startsOn}
              onChange={(ev) => setForm({ ...form, startsOn: ev.target.value })}
            />
          </label>
          <label>
            Last participating day (optional)
            <input
              type="date"
              value={form.endsOn}
              onChange={(ev) => setForm({ ...form, endsOn: ev.target.value })}
            />
          </label>
          <label className="tk-checkbox">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(ev) =>
                setForm({ ...form, enabled: ev.target.checked })
              }
            />{" "}
            Enrolled in timekeeping
          </label>
        </div>
        <button disabled={busy} className="tk-primary">
          Save employee
        </button>
        {error && (
          <p className="tk-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}

function SheetEditor({
  initial,
  actorId,
  actorEmail,
  onSigned,
  onNotice,
  isAdmin,
  clockOpen,
  onComplete,
  onDirty,
}: {
  initial: Sheet;
  actorId: string;
  actorEmail: string;
  onSigned: (sheet: Sheet) => void;
  onNotice: (message: string) => void;
  isAdmin: boolean;
  clockOpen: boolean;
  onComplete: () => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  const api = useContext(ApiContext);
  const [draft, setDraft] = useState(initial),
    draftRef = useRef(initial),
    versionRef = useRef(initial.version),
    revision = useRef(0),
    saved = useRef(0),
    pending = useRef<Promise<void> | null>(null);
  const [tick, setTick] = useState(0),
    [status, setStatus] = useState("Saved"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [events, setEvents] = useState<EventRow[] | null>(null);
  const own = initial.employee_id === actorId,
    editable =
      (own || isAdmin) &&
      ["draft", "returned"].includes(initial.state) &&
      !clockOpen;
  const [confirmed, setConfirmed] = useState(false);
  const change = (next: Sheet) => {
    draftRef.current = next;
    setDraft(next);
    revision.current++;
    setTick(revision.current);
    setStatus("Unsaved");
    setError("");
    setConfirmed(false);
    onDirty(true);
  };
  async function save(): Promise<void> {
    if (pending.current) {
      await pending.current;
      if (saved.current < revision.current) return save();
      return;
    }
    if (saved.current === revision.current) return;
    const captured = revision.current,
      value = draftRef.current;
    if (isAdmin && !own && !reason.trim()) {
      setStatus("Unsaved");
      throw new Error(
        "Enter the correction reason before saving another employee’s sheet.",
      );
    }
    setStatus("Saving…");
    const request = (async () => {
      try {
        const next = await api<Sheet>("", {
          op: "save",
          sheetId: initial.id,
          version: versionRef.current,
          days: value.days,
          note: value.note,
          reason,
        });
        versionRef.current = next.version;
        saved.current = captured;
        const merged =
          revision.current === captured
            ? next
            : { ...draftRef.current, version: next.version };
        draftRef.current = merged;
        setDraft(merged);
        setStatus(saved.current === revision.current ? "Saved" : "Unsaved");
        onDirty(saved.current !== revision.current);
      } catch (e) {
        setStatus("Save failed");
        setError(errorText(e));
        throw e;
      } finally {
        pending.current = null;
      }
    })();
    pending.current = request;
    await request;
    if (saved.current < revision.current) return save();
  }
  useEffect(() => {
    if (!tick) return;
    const timer = setTimeout(() => {
      save().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [tick]); // refs serialize overlapping autosaves
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (saved.current < revision.current) {
        e.preventDefault();
      }
    };
    const linkGuard = (e: MouseEvent) => {
      if (
        saved.current < revision.current &&
        (e.target as HTMLElement).closest("a")
      ) {
        e.preventDefault();
        e.stopPropagation();
        setError("Save your timesheet changes before leaving this page.");
      }
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", linkGuard, true);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("click", linkGuard, true);
    };
  }, []);
  async function act(op: string) {
    setBusy(true);
    setError("");
    onNotice("");
    try {
      await save();
      const before = draftRef.current;
      const result = await api<Sheet>("", {
        op,
        sheetId: initial.id,
        version: versionRef.current,
        reason,
        attested: op === "submit" && confirmed,
      });
      if (op === "submit") onSigned(result);
      if (op === "refresh") {
        const changed = result.days.filter(
          (day, i) => JSON.stringify(day) !== JSON.stringify(before.days[i]),
        ).length;
        onNotice(
          changed
            ? `Defaults applied to ${changed} ${changed === 1 ? "day" : "days"}. Your manual entries, leave, notes and clocked time were kept.`
            : "No days needed updating. Existing entries and employee start/end dates were respected; untouched days already match your saved defaults.",
        );
      }
      await onComplete();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const t = totals(draft.days);
  function dayChange(day: Day) {
    change({
      ...draftRef.current,
      days: draftRef.current.days.map((d) => (d.date === day.date ? day : d)),
    });
  }
  return (
    <section className="tk-sheet">
      <div className="tk-section-heading">
        <div>
          <p className="tk-eyebrow">
            {own ? "MY TIMESHEET" : initial.employee_name.toUpperCase()}
          </p>
          <h2>{labelPeriod(initial)}</h2>
          <p>
            <span className="tk-basis">{initial.pay_basis}</span>{" "}
            <span className={`tk-badge ${initial.state}`}>{initial.state}</span>{" "}
            <span role="status">{status}</span>
          </p>
        </div>
        <div className="tk-toolbar">
          {editable && own && (
            <button disabled={busy} onClick={() => void act("refresh")}>
              {busy ? "Please wait…" : "Apply defaults to untouched days"}
            </button>
          )}
          {editable && (
            <button
              disabled={busy}
              onClick={() => {
                save().catch((e) => setError(errorText(e)));
              }}
            >
              Save now
            </button>
          )}
        </div>
      </div>
      {initial.reason && (
        <div className="tk-notice">
          <strong>Reviewer note:</strong> {initial.reason}
        </div>
      )}
      {clockOpen && (
        <div className="tk-notice">
          Your clock is running. Clock out before editing or submitting your
          sheet.
        </div>
      )}
      {error && (
        <div className="tk-alert" role="alert">
          {error}
          {status === "Save failed" && (
            <>
              <button onClick={() => save().catch(() => {})}>Retry save</button>
              <button
                disabled={!!pending.current}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Discard unsaved edits and reload the saved sheet?",
                    )
                  )
                    return;
                  const fresh = await api<Boot>();
                  const sheet =
                    fresh.sheet?.id === initial.id
                      ? fresh.sheet
                      : (await api<Sheet[]>("?view=review")).find(
                          (s) => s.id === initial.id,
                        );
                  if (!sheet) {
                    setError("Could not reload this sheet.");
                    return;
                  }
                  draftRef.current = sheet;
                  versionRef.current = sheet.version;
                  saved.current = revision.current;
                  setDraft(sheet);
                  setStatus("Saved");
                  setError("");
                  setConfirmed(false);
                  onDirty(false);
                  await onComplete();
                }}
              >
                Discard and reload
              </button>
            </>
          )}
        </div>
      )}
      <div className="tk-totals">
        <div>
          <small>Entered work</small>
          <strong>{duration(t.worked)}</strong>
        </div>
        <div>
          <small>Scheduled to confirm</small>
          <strong>{duration(t.scheduled)}</strong>
        </div>
        <div>
          <small>
            {t.loa_paid || t.loa_unpaid ? "Leave" : "Vacation / sick"}
          </small>
          <strong>
            {duration(t.vacation + t.sick + t.loa_paid + t.loa_unpaid)}
          </strong>
        </div>
        <div>
          <small>Business miles</small>
          <strong>{t.miles.toFixed(2)}</strong>
        </div>
      </div>
      <p className="tk-help">
        Defaults are draft time until you confirm them. Use an exception for
        leave, days off or different hours. Weekend days can include work too.
        All times are Pacific; 12:00 AM (next day) means midnight at the end of
        the day. Record actual breaks taken; use notes for leave of absence.
      </p>
      {isAdmin && !own && editable && (
        <label className="tk-correction">
          Correction reason
          <input
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you adjusting this sheet?"
          />
        </label>
      )}
      <fieldset disabled={!editable || busy} className="tk-days">
        {draft.days.map((day) => (
          <DayEditor key={day.date} day={day} onChange={dayChange} />
        ))}
      </fieldset>
      <label className="tk-period-note">
        Pay-period notes
        <textarea
          disabled={!editable || busy}
          maxLength={2000}
          value={draft.note}
          onChange={(e) =>
            change({ ...draftRef.current, note: e.target.value })
          }
          placeholder="Anything your manager or payroll person should know about this period."
        />
        <small>
          {draft.note.length}/2000 · Included in the payroll summary
        </small>
      </label>
      <div className="tk-submit">
        {editable && own && (
          <>
            <label className="tk-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              {EMPLOYEE_ATTESTATION}
            </label>
            <button
              className="tk-primary"
              disabled={busy || !confirmed || initial.period_end > localDate()}
              onClick={() => act("submit")}
            >
              Sign & submit to manager
            </button>
            <small>
              Signing as {actorEmail} through your Microsoft company sign-in.
              The approval date and time are recorded when you submit.
            </small>
            {initial.period_end > localDate() && (
              <small>
                Submission opens on {displayDate(initial.period_end)}. You can
                save time now.
              </small>
            )}
          </>
        )}
        {initial.state === "submitted" &&
          initial.review_manager_id === actorId &&
          !own && (
            <>
              <label>
                Return reason
                <textarea
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="tk-toolbar">
                <button
                  disabled={busy || !reason.trim()}
                  onClick={() => act("return")}
                >
                  Return for correction
                </button>
                <button
                  disabled={busy}
                  className="tk-primary"
                  onClick={() => act("approve")}
                >
                  Approve timesheet
                </button>
              </div>
            </>
          )}
        {isAdmin && ["submitted", "approved"].includes(initial.state) && (
          <>
            <label>
              Reopen reason
              <input
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !reason.trim()}
              onClick={() => act("reopen")}
            >
              Reopen for correction
            </button>
          </>
        )}
        {isAdmin && !own && editable && (
          <p>
            After corrections are saved, the employee must sign this sheet again
            before their manager can approve it.
          </p>
        )}
        {initial.employee_signed_at && (
          <p>
            <strong>Employee digitally approved:</strong>{" "}
            {initial.employee_signed_name} ({initial.employee_signed_by}) ·{" "}
            {new Date(initial.employee_signed_at).toLocaleString("en-US", {
              timeZone: "America/Los_Angeles",
              timeZoneName: "short",
            })}{" "}
            · Microsoft company sign-in · Signed version{" "}
            {initial.employee_signed_version}
          </p>
        )}
        {initial.approved_by && (
          <p>
            Manager approved by {initial.approved_by} ·{" "}
            {new Date(initial.approved_at!).toLocaleString()}
          </p>
        )}
      </div>
      <details
        className="tk-history"
        onToggle={(e) => {
          if (e.currentTarget.open)
            api<EventRow[]>(`?view=history&id=${initial.id}`)
              .then(setEvents)
              .catch((err) => setError(errorText(err)));
        }}
      >
        <summary>Change and approval history</summary>
        {events?.map((ev) => (
          <details key={ev.id}>
            <summary>
              {ev.action} · {ev.actor} ·{" "}
              {new Date(ev.created_at).toLocaleString()}
              {ev.reason ? ` — ${ev.reason}` : ""}
            </summary>
            <pre>
              {JSON.stringify(
                { before: ev.before_data, after: ev.after_data },
                null,
                2,
              )}
            </pre>
          </details>
        ))}
      </details>
    </section>
  );
}

function DayEditor({
  day,
  onChange,
}: {
  day: Day;
  onChange: (day: Day) => void;
}) {
  const [error, setError] = useState("");
  const t = totals([day]);
  const updateShift = (
    id: string,
    start: string,
    end: string,
    unpaid: number,
    paid: number,
  ) => {
    try {
      onChange(editDayShift(day, id, start, end, unpaid, paid));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  };
  function changeBreak(
    shiftId: string,
    breakId: string,
    field: "start" | "end",
    value: string,
  ) {
    try {
      const timestamp =
        value === "24:00"
          ? wallTime(addDays(day.date, 1), "00:00")
          : wallTime(day.date, value);
      onChange({
        ...day,
        shifts: day.shifts.map((s) =>
          s.id === shiftId
            ? {
                ...s,
                source: "manual",
                breaks: s.breaks.map((b) =>
                  b.id === breakId
                    ? { ...b, [field]: timestamp, minutes: 0 }
                    : b,
                ),
              }
            : s,
        ),
      });
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <details className={`tk-day ${day.off ? "off" : ""}`}>
      <summary>
        <span>
          <strong>
            {new Intl.DateTimeFormat("en-US", {
              weekday: "short",
              timeZone: "UTC",
            }).format(new Date(day.date + "T12:00:00Z"))}
          </strong>
          <small>{day.date}</small>
        </span>
        <span>
          {day.off
            ? "No work"
            : day.shifts.length
              ? day.shifts
                  .map(
                    (s) =>
                      `${displayTime(localTime(s.start))}–${s.end && localDate(new Date(s.end)) !== day.date ? "12:00 AM (next day)" : s.end ? displayTime(localTime(s.end)) : "open"}`,
                  )
                  .join(", ")
              : day.leave.length
                ? "Leave"
                : "Needs entry"}
          {day.leave.length > 0 && (
            <small>
              {day.leave
                .map((l) => `${LEAVE_LABELS[l.kind]} ${hours(l.minutes)}h`)
                .join(" · ")}
            </small>
          )}
        </span>
        <span>
          {duration(t.worked + t.scheduled)}
          {day.miles > 0 && <small>{day.miles} miles</small>}
        </span>
        <span className="tk-day-edit">
          {day.emergency && <small>Emergency work</small>}
          {day.emergencyPhone && <small>Emergency phone</small>}View day
        </span>
      </summary>
      <div className="tk-day-body">
        {error && (
          <p className="tk-error" role="alert">
            {error}
          </p>
        )}
        <label className="tk-checkbox">
          <input
            type="checkbox"
            checked={day.off}
            onChange={(e) => {
              if (
                e.target.checked &&
                (day.shifts.length || day.leave.length) &&
                !window.confirm(
                  "Mark this day as no work and clear its work/leave entries?",
                )
              )
                return;
              onChange({
                ...day,
                off: e.target.checked,
                shifts: e.target.checked ? [] : day.shifts,
                leave: e.target.checked ? [] : day.leave,
              });
            }}
          />{" "}
          No work this day
        </label>
        {day.shifts.map((s) => {
          const start = localTime(s.start),
            end = s.end
              ? localDate(new Date(s.end)) !== day.date
                ? "24:00"
                : localTime(s.end)
              : "";
          const unpaid = s.breaks
              .filter((b) => !b.paid)
              .reduce((n, b) => n + breakMinutes(b), 0),
            paid = s.breaks
              .filter((b) => b.paid)
              .reduce((n, b) => n + breakMinutes(b), 0);
          return (
            <div className="tk-shift" key={s.id}>
              <span className="tk-source">{s.source}</span>
              <label>
                Start
                <TimeSelect
                  allowExact
                  value={start}
                  onChange={(value) =>
                    updateShift(
                      s.id,
                      value,
                      end,
                      Math.round(unpaid),
                      Math.round(paid),
                    )
                  }
                />
              </label>
              <label>
                End
                <TimeSelect
                  label={`End time ${day.date}`}
                  allowExact
                  endOfDay
                  value={end}
                  onChange={(value) =>
                    updateShift(
                      s.id,
                      start,
                      value,
                      Math.round(unpaid),
                      Math.round(paid),
                    )
                  }
                />
              </label>
              <label>
                Unpaid break (min)
                <input
                  type="number"
                  min="0"
                  value={Math.round(unpaid)}
                  readOnly={s.breaks.some((b) => !b.paid && !!b.start)}
                  onChange={(e) =>
                    updateShift(
                      s.id,
                      start,
                      end,
                      Number(e.target.value),
                      Math.round(paid),
                    )
                  }
                />
              </label>
              <label>
                Paid break (min)
                <input
                  type="number"
                  min="0"
                  value={Math.round(paid)}
                  readOnly={s.breaks.some((b) => b.paid && !!b.start)}
                  onChange={(e) =>
                    updateShift(
                      s.id,
                      start,
                      end,
                      Math.round(unpaid),
                      Number(e.target.value),
                    )
                  }
                />
              </label>
              <div className="tk-lunch-entries">
                {s.breaks
                  .filter((b) => b.start && b.end)
                  .map((b) => (
                    <div className="tk-inline" key={b.id}>
                      <strong>
                        {b.paid ? "Paid break" : "Unpaid lunch / break"}
                      </strong>
                      <label>
                        Break start
                        <TimeSelect
                          label={`Break start ${day.date} ${b.id}`}
                          allowExact
                          value={localTime(b.start!)}
                          onChange={(value) =>
                            changeBreak(s.id, b.id, "start", value)
                          }
                        />
                      </label>
                      <label>
                        Break end
                        <TimeSelect
                          label={`Break end ${day.date} ${b.id}`}
                          allowExact
                          endOfDay
                          value={
                            localDate(new Date(b.end!)) !== day.date
                              ? "24:00"
                              : localTime(b.end!)
                          }
                          onChange={(value) =>
                            changeBreak(s.id, b.id, "end", value)
                          }
                        />
                      </label>
                      <span>{Math.round(breakMinutes(b))} minutes</span>
                      <button
                        onClick={() =>
                          onChange({
                            ...day,
                            shifts: day.shifts.map((x) =>
                              x.id === s.id
                                ? {
                                    ...x,
                                    source: "manual",
                                    breaks: x.breaks.filter(
                                      (y) => y.id !== b.id,
                                    ),
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        Remove break
                      </button>
                    </div>
                  ))}
                {!s.breaks.some((b) => !b.paid && b.start) && (
                  <button
                    onClick={() => {
                      const span =
                        (Date.parse(s.end!) - Date.parse(s.start)) / 60000;
                      const minutes = Math.min(
                        Math.round(unpaid) || 60,
                        Math.floor(span),
                      );
                      const from =
                        Date.parse(s.start) +
                        Math.floor((span - minutes) / 2) * 60000;
                      onChange({
                        ...day,
                        shifts: day.shifts.map((x) =>
                          x.id === s.id
                            ? {
                                ...x,
                                source: "manual",
                                breaks: [
                                  ...x.breaks.filter((b) => b.paid),
                                  {
                                    id: crypto.randomUUID(),
                                    paid: false,
                                    minutes: 0,
                                    start: new Date(from).toISOString(),
                                    end: new Date(
                                      from + minutes * 60000,
                                    ).toISOString(),
                                  },
                                ],
                              }
                            : x,
                        ),
                      });
                    }}
                  >
                    Set lunch start / end
                  </button>
                )}
              </div>
              <button
                className="tk-remove"
                onClick={() =>
                  onChange({
                    ...day,
                    shifts: day.shifts.filter((x) => x.id !== s.id),
                  })
                }
              >
                Remove shift
              </button>
            </div>
          );
        })}
        <button
          onClick={() => {
            try {
              const start = day.shifts.length
                ? localTime(day.shifts[day.shifts.length - 1].end!)
                : "07:00";
              const end = start < "16:30" ? "16:30" : "23:00";
              onChange({
                ...day,
                off: false,
                shifts: [
                  ...day.shifts,
                  {
                    id: crypto.randomUUID(),
                    source: "manual",
                    start: wallTime(day.date, start),
                    end: wallTime(day.date, end),
                    breaks: [],
                  },
                ],
              });
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          <Plus size={14} /> Add work interval
        </button>
        <fieldset className="tk-emergency-flags">
          <legend>Emergency activity</legend>
          <label className="tk-checkbox">
            <input
              type="checkbox"
              checked={day.emergency === true}
              onChange={(e) =>
                onChange({ ...day, emergency: e.target.checked })
              }
            />
            Emergency work
          </label>
          <label className="tk-checkbox">
            <input
              type="checkbox"
              checked={day.emergencyPhone === true}
              onChange={(e) =>
                onChange({ ...day, emergencyPhone: e.target.checked })
              }
            />
            Emergency phone management
          </label>
          <small>
            Flag the day and include any time worked in the intervals above. Add
            details in daily notes.
          </small>
        </fieldset>
        <div className="tk-leave">
          <h3>Leave</h3>
          {day.leave.map((l) => (
            <div className="tk-inline" key={l.kind}>
              <label>
                {LEAVE_LABELS[l.kind]} hours
                <input
                  type="number"
                  min="0.0167"
                  max="24"
                  step="0.25"
                  value={l.minutes / 60}
                  onChange={(e) =>
                    onChange({
                      ...day,
                      leave: day.leave.map((x) =>
                        x.kind === l.kind
                          ? {
                              ...x,
                              minutes: Math.round(Number(e.target.value) * 60),
                            }
                          : x,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  onChange({
                    ...day,
                    leave: day.leave.filter((x) => x.kind !== l.kind),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <label>
            Add leave
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const entered = window.prompt(
                  "How many leave hours for this day?",
                  t.scheduled ? String(t.scheduled / 60) : "",
                );
                if (entered === null) return;
                const leaveMinutes = Math.round(Number(entered) * 60);
                if (
                  !Number.isFinite(leaveMinutes) ||
                  leaveMinutes <= 0 ||
                  leaveMinutes > 1440
                ) {
                  setError(
                    "Enter leave hours greater than zero and no more than 24.",
                  );
                  return;
                }
                if (
                  day.shifts.some((s) => s.source === "scheduled") &&
                  !window.confirm(
                    "Replace scheduled work with leave? For a partial day, add the hours actually worked afterward.",
                  )
                )
                  return;
                onChange({
                  ...day,
                  off: false,
                  shifts: day.shifts.filter((s) => s.source !== "scheduled"),
                  leave: [
                    ...day.leave,
                    {
                      kind: e.target.value as Leave["kind"],
                      minutes: leaveMinutes,
                    },
                  ],
                });
              }}
            >
              <option value="">Choose a category…</option>
              {Object.entries(LEAVE_LABELS)
                .filter(
                  ([k]) =>
                    ["vacation", "sick"].includes(k) &&
                    !day.leave.some((l) => l.kind === k),
                )
                .map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <small>
            Adjust hours for partial days. Use daily or pay-period notes for
            leave of absence.
          </small>
        </div>
        <div className="tk-form-grid">
          <label>
            Business miles
            <input
              min="0"
              max="2000"
              step="0.01"
              type="number"
              value={day.miles}
              onChange={(e) =>
                onChange({ ...day, miles: Number(e.target.value) })
              }
            />
          </label>
          <label className="tk-wide">
            Daily notes
            <textarea
              maxLength={2000}
              value={day.note}
              onChange={(e) => onChange({ ...day, note: e.target.value })}
              placeholder="Emergency details, phone management, leave of absence, or other time notes."
            />
          </label>
        </div>
      </div>
    </details>
  );
}
