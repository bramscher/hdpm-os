"use client";

import { useEffect, useState } from "react";
import type { TimekeepingApi } from "@/lib/timekeeping/client";
import { addDays, hours, type Employee } from "@/lib/timekeeping/model";
import {
  weekStart,
  type OvertimeContext,
  type payrollHours,
} from "@/lib/timekeeping/overtime";

type Review = {
  overtime: OvertimeContext;
  reports: ReturnType<typeof payrollHours>[];
};
export default function PayrollReview({
  request,
  period,
  employees,
  onSaved,
  onReady,
}: {
  request: TimekeepingApi;
  period: string;
  employees: Employee[];
  onSaved: () => Promise<unknown>;
  onReady: (ready: boolean) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    onReady(false);
    try {
      const next = await request<Review>(
        `?view=payroll-check&period=${period}`,
      );
      setReview(next);
      onReady(
        next.reports.length > 0 && next.reports.every((r) => !r.issues.length),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check payroll.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [period]);
  return (
    <section className="tk-panel" aria-label="Overtime and payroll setup">
      <div className="tk-section-heading">
        <h2>Overtime &amp; payroll setup</h2>
        <button disabled={busy} onClick={() => void refresh()}>
          Refresh calculations
        </button>
      </div>
      <p>
        Sunday–Saturday · Weekly overtime after 40 worked hours · After-hours
        emergency work at 1.5×.
      </p>
      <p>
        Holiday, sick and vacation hours do not count toward 40. Premium hours
        below are included in worked time, not added hours.
      </p>
      <p>
        Carrying the emergency phone is a separate stipend record. Only actual
        after-hours emergency work entered as an eligible interval receives the
        emergency premium.
      </p>
      {busy && <p role="status">Checking payroll hours…</p>}
      {error && (
        <p role="alert" className="tk-alert">
          {error}
        </p>
      )}
      {review && (
        <>
          <div className="tk-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Regular hours</th>
                  <th>Weekly overtime</th>
                  <th>Additional emergency</th>
                  <th>Payroll check</th>
                </tr>
              </thead>
              <tbody>
                {review.reports.map((r) => (
                  <tr key={r.employeeId}>
                    <td>{r.name}</td>
                    <td>
                      {r.issues.length
                        ? "Needs review"
                        : hours(r.summary.regular)}
                    </td>
                    <td>
                      {r.issues.length ? "—" : hours(r.summary.weeklyOvertime)}
                    </td>
                    <td>
                      {r.issues.length
                        ? "—"
                        : hours(r.summary.emergencyAdditional)}
                    </td>
                    <td>
                      {r.issues.length ? r.issues[0] : "Hours reconciled"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Payroll applies wage rates and any required bonus or differential
            adjustments. A salary does not by itself establish exemption.
          </p>
          {review.reports.map((report) => {
            const employee = employees.find((e) => e.id === report.employeeId);
            if (!employee) return null;
            return (
              <PayrollEmployee
                key={`${employee.id}:${employee.version}`}
                employee={employee}
                report={report}
                period={period}
                context={review.overtime}
                save={async (body) => {
                  onReady(false);
                  await request("", {
                    op: "payrollSetup",
                    employeeId: employee.id,
                    ...body,
                  });
                  await onSaved();
                  await refresh();
                }}
              />
            );
          })}
        </>
      )}
    </section>
  );
}

function PayrollEmployee({
  employee,
  report,
  period,
  context,
  save,
}: {
  employee: Employee;
  report: Review["reports"][number];
  period: string;
  context: OvertimeContext;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  const opening = context.openings.find((o) => o.employee_id === employee.id);
  const missing = report.weeks[0]?.openingMissing;
  const [status, setStatus] = useState(
    employee.overtime_status || "non_exempt",
  );
  const [reason, setReason] = useState("");
  const [openingHours, setOpeningHours] = useState(
    opening ? String(opening.worked_minutes / 60) : "",
  );
  const [openingNote, setOpeningNote] = useState(opening?.note || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await save(body);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save payroll setup.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="tk-employee" open={report.issues.length > 0}>
      <summary>
        <strong>{employee.name}</strong> ·{" "}
        {status === "exempt" ? "Confirmed exempt" : "Weekly overtime eligible"}
        {report.issues.length > 0 ? " · Needs payroll review" : ""}
      </summary>
      {error && <p role="alert">{error}</p>}
      {!!report.issues.length && (
        <ul>
          {report.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {(missing || opening) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit({
              setting: "opening",
              period,
              version: opening?.version || 0,
              workedMinutes: Number(openingHours) * 60,
              reason: openingNote,
            });
          }}
        >
          <h3>Opening workweek hours</h3>
          <p>
            Enter actual hours worked from {weekStart(period)} through{" "}
            {addDays(period, -1)} from the prior payroll record. These establish
            the 40-hour counter and will not be paid again. Enter 0 only after
            confirming no work occurred.
          </p>
          <label>
            Prior worked hours
            <input
              required
              type="number"
              min="0"
              max="144"
              step="0.0001"
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
            />
          </label>
          <label>
            Source or confirmation
            <textarea
              required
              maxLength={2000}
              value={openingNote}
              onChange={(e) => setOpeningNote(e.target.value)}
            />
          </label>
          <button disabled={busy}>Save opening hours</button>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            setting: "eligibility",
            version: employee.version,
            overtimeStatus: status,
            reason,
          });
        }}
      >
        <label>
          Overtime eligibility
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="non_exempt">
              Eligible for weekly overtime (default)
            </option>
            <option value="exempt">Confirmed legally exempt</option>
          </select>
        </label>
        <label>
          Reason / exemption basis
          <textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p>
          Only select exempt after confirming the applicable Oregon and federal
          duties and pay tests. The emergency premium still applies to marked
          intervals.
        </p>
        <button disabled={busy}>Save eligibility</button>
      </form>
    </details>
  );
}
