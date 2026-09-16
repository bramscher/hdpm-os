import { displayTime } from "./presentation";
import * as XLSX from "xlsx";
import { payrollHours, type OvertimeContext } from "./overtime";
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
  overtime?: OvertimeContext;
};
const round = (n: number) => Math.round(n * 10000) / 10000;
export function payrollWorkbook(snapshot: PayrollSnapshot): Uint8Array {
  const summary: Record<string, string | number>[] = [],
    daily: Record<string, string | number>[] = [],
    intervals: Record<string, string | number>[] = [],
    weekly: Record<string, string | number>[] = [];
  const legacyLeave = snapshot.sheets.some((s) =>
    s.days.some((d) => d.leave.some((l) => l.kind.startsWith("loa_"))),
  );
  for (const sheet of snapshot.sheets) {
    const pay = snapshot.overtime ? payrollHours(snapshot, sheet) : null;
    if (pay?.issues.length)
      throw new Error(`${sheet.employee_name}: ${pay.issues.join(" ")}`);
    const payColumns = (p: NonNullable<typeof pay>["summary"]) => ({
      "Regular worked hours (1x)": round(p.regular / 60),
      "Weekly overtime hours (1.5x)": round(p.weeklyOvertime / 60),
      "Additional emergency hours (1.5x)": round(p.emergencyAdditional / 60),
      "Total hours at 1.5x (included)": round(p.premium / 60),
    });
    for (const week of pay?.weeks || [])
      weekly.push({
        "Employee ID": sheet.payroll_id || sheet.employee_id,
        Employee: sheet.employee_name,
        "Overtime eligibility":
          pay!.status === "exempt" ? "CONFIRMED EXEMPT" : "NON-EXEMPT",
        "Week start (Sunday)": week.start,
        "Week end (Saturday)": week.end,
        "Prior-period worked hours (not payable again)": round(
          week.priorWorked / 60,
        ),
        "This-period worked hours": round(week.worked / 60),
        "Week worked hours through period end": round(week.totalWorked / 60),
        ...payColumns(week),
        "Emergency hours (included)": round(week.emergency / 60),
        "Emergency / weekly OT overlap (included)": round(week.overlap / 60),
        "Week status": week.continues
          ? "Continues next pay period"
          : "Complete through Saturday",
        "Opening hours source": week.openingNote || "Approved timecards",
      });
    const employeeRows = sheet.days.map((day) => {
      const t = totals([day]);
      return {
        "Employee ID": sheet.payroll_id || sheet.employee_id,
        Employee: sheet.employee_name,
        "Pay basis": sheet.pay_basis === "salary" ? "SALARY" : "HOURLY",
        Date: day.date,
        "Worked hours": round(t.worked / 60),
        ...(pay
          ? {
              "Workweek starts": pay.days.find((d) => d.date === day.date)!
                .weekStart,
              ...payColumns(pay.days.find((d) => d.date === day.date)!),
            }
          : {}),
        "Unpaid break hours": round(t.unpaidBreak / 60),
        "Paid break hours (included)": round(t.paidBreak / 60),
        "Vacation hours": round(t.vacation / 60),
        "Sick hours": round(t.sick / 60),
        "Holiday hours": round(t.holiday / 60),
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
      ...(pay
        ? {
            "Overtime eligibility":
              pay.status === "exempt" ? "CONFIRMED EXEMPT" : "NON-EXEMPT",
            ...payColumns(pay.summary),
          }
        : {}),
      "Vacation hours": sum("Vacation hours"),
      "Sick hours": sum("Sick hours"),
      "Holiday hours": sum("Holiday hours"),
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
          ...(pay
            ? {
                "After-hours emergency (1.5x)": shift.emergencyAfterHours
                  ? "Yes"
                  : "No",
              }
            : {}),
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
    ...(snapshot.overtime ? [["Weekly overtime", weekly]] : []),
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
          Value: snapshot.overtime
            ? "Salary alone does not establish overtime exemption. Eligibility is separately recorded. This report allocates hours; payroll must apply the legally required regular rate, salary agreement, bonuses, multiple rates and other earnings. Dollar wages, taxes and reimbursements are not calculated here."
            : "Legacy export: overtime was not calculated. Create a new export for regular, weekly overtime and emergency-premium hours. SALARY identifies pay basis, not an overtime exemption.",
        },
        ...(snapshot.overtime
          ? [
              {
                Item: "Workweek",
                Value:
                  "Sunday 12:00 AM through Saturday 11:59:59 PM, America/Los_Angeles. Weekly overtime is actual worked time above 40 hours for non-exempt employees. Paid breaks count; unpaid breaks and paid leave do not.",
              },
              {
                Item: "Emergency policy",
                Value:
                  "Identified after-hours emergency work, including active emergency phone work, earns 1.5x even below 40 weekly hours. Use separate work intervals for eligible time. Mere on-call availability is not automatically an emergency-work interval. Payroll must separately assess compensable restricted on-call time.",
              },
              {
                Item: "No duplicate pay",
                Value:
                  "Worked hours = regular worked hours + weekly overtime hours + additional emergency hours. Total hours at 1.5x is the sum of the two premium categories and is already included in worked hours. Do not add it again. Emergency time already in weekly overtime earns one 1.5x rate, not stacked premiums.",
              },
              {
                Item: "Pay-period boundaries",
                Value:
                  "Prior-period hours establish the weekly 40-hour counter only; do not pay them again. Only this-period worked hours are allocated here. A week ending after this period continues in the next payroll package. Payroll must finalize the full-week regular rate and any monetary adjustments when the week closes.",
              },
              {
                Item: "Regular rate",
                Value:
                  "1.5x means the applicable regular rate, not necessarily the base hourly rate. Include required bonuses and differentials. Confirm whether the company's emergency premium qualifies for exclusion from the regular rate under federal premium-pay rules; this report does not offset emergency hours against separate weekly overtime hours.",
              },
              {
                Item: "Oregon source",
                Value:
                  "Oregon BOLI overtime guidance, researched 2026-09-16: https://www.oregon.gov/boli/employers/pages/overtime.aspx",
              },
              {
                Item: "Federal sources",
                Value:
                  "https://www.dol.gov/agencies/whd/fact-sheets/23-flsa-overtime-pay ; https://www.dol.gov/agencies/whd/fact-sheets/56a-regular-rate",
              },
            ]
          : []),
        {
          Item: "Paid breaks",
          Value:
            "Already included in worked time; do not add paid break hours again.",
        },
        {
          Item: "Leave categories",
          Value: (legacyLeave
            ? Object.values(LEAVE_LABELS)
            : [LEAVE_LABELS.vacation, LEAVE_LABELS.sick, LEAVE_LABELS.holiday]
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
      wch: Math.max(
        snapshot.overtime ? k.length + 2 : 0,
        k.includes("Notes") || k.includes("notes") || k === "Value"
          ? 65
          : k.includes("timestamp")
            ? 28
            : 22,
      ),
    }));
    if (rows.length) ws["!autofilter"] = { ref: ws["!ref"]! };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
