"use client";

import { invoiceReportPeriods } from "@/lib/invoice-report-periods";

export function ReportPeriodPresets({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const periods = invoiceReportPeriods();
  const selected = [...periods.payroll, ...periods.weeks].find(
    (p) => p.from === from && p.to === to,
  );
  return (
    <label className="flex items-center gap-2 text-xs text-charcoal-500 max-w-full">
      <span className="shrink-0">Period preset</span>
      <select
        aria-label="Invoice period preset"
        className="h-8 min-w-0 max-w-full rounded-md border border-sand-300 bg-white px-2 text-xs text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-400"
        value={selected ? `${selected.from}|${selected.to}` : ""}
        onChange={(e) => {
          const period = [...periods.payroll, ...periods.weeks].find(
            (p) => `${p.from}|${p.to}` === e.target.value,
          );
          if (period) onChange(period.from, period.to);
        }}
      >
        <option value="">Choose a period…</option>
        <optgroup label="Payroll periods · 1–15 / 16–month end">
          {periods.payroll.map((p) => (
            <option key={p.from} value={`${p.from}|${p.to}`}>
              {p.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Weeks · Monday–Sunday">
          {periods.weeks.map((p) => (
            <option key={p.from} value={`${p.from}|${p.to}`}>
              {p.label}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
