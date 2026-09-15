import { displayTime } from "./presentation";
import * as XLSX from "xlsx";
import {
  breakMinutes,
  LEAVE_LABELS,
  localTime,
  totals,
  type Sheet,
} from "./model";

export type PayrollSnapshot = {
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  createdBy: string;
  version: number;
  sheets: Sheet[];
};
const round = (n: number) => Math.round(n * 10000) / 10000;
export function payrollWorkbook(snapshot: PayrollSnapshot): Uint8Array {
  const summary: Record<string, string | number>[] = [],
    daily: Record<string, string | number>[] = [],
    intervals: Record<string, string | number>[] = [];
  const legacyLeave = snapshot.sheets.some((s) =>
    s.days.some((d) => d.leave.some((l) => l.kind.startsWith("loa_"))),
  );
  for (const sheet of snapshot.sheets) {
    const employeeRows = sheet.days.map((day) => {
      const t = totals([day]);
      return {
        "Employee ID": sheet.payroll_id || sheet.employee_id,
        Employee: sheet.employee_name,
        "Pay basis": sheet.pay_basis === "salary" ? "SALARY" : "HOURLY",
        Date: day.date,
        "Worked hours": round(t.worked / 60),
        "Unpaid break hours": round(t.unpaidBreak / 60),
        "Paid break hours (included)": round(t.paidBreak / 60),
        "Vacation hours": round(t.vacation / 60),
        "Sick hours": round(t.sick / 60),
        ...(legacyLeave
          ? {
              "Paid LOA hours": round(t.loa_paid / 60),
              "Unpaid LOA hours": round(t.loa_unpaid / 60),
            }
          : {}),
        Miles: t.miles,
        "No work": day.off ? "Yes" : "",
        Notes: day.note,
        "Emergency work": day.emergency ? "Yes" : "",
        "Emergency phone management": day.emergencyPhone ? "Yes" : "",
      };
    });
    daily.push(...employeeRows);
    const sum = (key: keyof (typeof employeeRows)[number]) =>
      round(employeeRows.reduce((s, r) => s + Number(r[key] || 0), 0));
    summary.push({
      "Employee ID": sheet.payroll_id || sheet.employee_id,
      Employee: sheet.employee_name,
      "Pay basis": sheet.pay_basis === "salary" ? "SALARY" : "HOURLY",
      "Period start": snapshot.periodStart,
      "Period end": snapshot.periodEnd,
      "Worked hours": sum("Worked hours"),
      "Vacation hours": sum("Vacation hours"),
      "Sick hours": sum("Sick hours"),
      ...(legacyLeave
        ? {
            "Paid LOA hours": sum("Paid LOA hours"),
            "Unpaid LOA hours": sum("Unpaid LOA hours"),
          }
        : {}),
      Miles: sum("Miles"),
      "Emergency work days": sheet.days.filter((d) => d.emergency).length,
      "Emergency phone management days": sheet.days.filter(
        (d) => d.emergencyPhone,
      ).length,
      Status: sheet.state,
      "Employee signed by": sheet.employee_signed_by || "",
      "Employee signed name": sheet.employee_signed_name || "",
      "Employee signed at (UTC)": sheet.employee_signed_at
        ? new Date(sheet.employee_signed_at).toISOString()
        : "",
      "Employee signed version": sheet.employee_signed_version || "",
      "Employee attestation": sheet.employee_attestation || "",
      "Sign-in method": sheet.employee_signed_at
        ? "Microsoft company account"
        : "",
      "Approved by": sheet.approved_by || "",
      "Approved at": sheet.approved_at || "",
      "Period notes": sheet.note,
      "Timesheet version": sheet.version,
    });
    for (const day of sheet.days)
      for (const shift of day.shifts) {
        intervals.push({
          Employee: sheet.employee_name,
          Date: day.date,
          "Record type": "Shift",
          "Start (Pacific)": displayTime(localTime(shift.start)),
          "End (Pacific)": shift.end ? displayTime(localTime(shift.end)) : "",
          "Start timestamp": shift.start,
          "End timestamp": shift.end || "",
          Source: shift.source,
        });
        for (const b of shift.breaks)
          intervals.push({
            Employee: sheet.employee_name,
            Date: day.date,
            "Record type": b.paid ? "Paid break (included)" : "Unpaid break",
            "Start (Pacific)": b.start ? displayTime(localTime(b.start)) : "",
            "End (Pacific)": b.end ? displayTime(localTime(b.end)) : "",
            "Start timestamp": b.start || "",
            "End timestamp": b.end || "",
            Minutes: round(breakMinutes(b)),
            Source: shift.source,
          });
      }
  }
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: `HDPM Payroll ${snapshot.periodStart} to ${snapshot.periodEnd}`,
    Author: snapshot.createdBy,
    CreatedDate: new Date(snapshot.generatedAt),
  };
  for (const [name, rows] of [
    ["Summary", summary],
    ["Daily detail", daily],
    ["Shifts and breaks", intervals],
    [
      "Report notes",
      [
        {
          Item: "Period",
          Value: `${snapshot.periodStart} through ${snapshot.periodEnd}`,
        },
        { Item: "Version", Value: String(snapshot.version) },
        { Item: "Generated at", Value: snapshot.generatedAt },
        {
          Item: "Time precision",
          Value:
            "Hours shown to four decimals per day/category. Summary adds these daily figures. Exact timestamps are retained in Shifts and breaks.",
        },
        {
          Item: "Salary",
          Value:
            "SALARY identifies the employee pay basis. Time is still recorded and approved; this report does not calculate salary, wages, overtime, tax or reimbursement amounts.",
        },
        {
          Item: "Paid breaks",
          Value:
            "Already included in worked time; do not add paid break hours again.",
        },
        {
          Item: "Leave categories",
          Value: (legacyLeave
            ? Object.values(LEAVE_LABELS)
            : [LEAVE_LABELS.vacation, LEAVE_LABELS.sick]
          ).join(", "),
        },
        {
          Item: "Corrections",
          Value:
            "A new export version supersedes prior versions for this period. Retain the previously sent package for comparison.",
        },
      ],
    ],
  ] as [string, Record<string, string | number>[]][]) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({
      wch:
        k.includes("Notes") || k.includes("notes") || k === "Value"
          ? 65
          : k.includes("timestamp")
            ? 28
            : 22,
    }));
    if (rows.length) ws["!autofilter"] = { ref: ws["!ref"]! };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
