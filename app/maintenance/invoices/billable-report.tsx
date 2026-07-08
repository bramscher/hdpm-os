"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, RefreshCw, TrendingUp, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HdmsInvoice } from "@/lib/invoices";

// ============================================
// Helpers
// ============================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AVG_DAYS_PER_MONTH = 30.4375; // 365.25 / 12

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatCurrencyShort(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** The date a billable is counted against: completed date, falling back to created date. */
function billableDate(inv: HdmsInvoice): Date | null {
  const raw = inv.completed_date || inv.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Midnight (local) of the given date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Inclusive count of calendar days between two day-boundaries. */
function calendarDays(start: Date, end: Date): number {
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / MS_PER_DAY) + 1;
}

/** Inclusive count of weekdays (Mon–Fri) between two dates. */
function businessDays(start: Date, end: Date): number {
  let count = 0;
  const cur = startOfDay(start);
  const last = startOfDay(end);
  while (cur.getTime() <= last.getTime()) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ============================================
// Metric options
// ============================================

type Metric = "total" | "labor" | "materials";

const METRICS: { id: Metric; label: string }[] = [
  { id: "total", label: "Total" },
  { id: "labor", label: "Labor" },
  { id: "materials", label: "Materials" },
];

/** The amount an invoice contributes for the selected metric. */
function amountFor(inv: HdmsInvoice, metric: Metric): number {
  if (metric === "labor") return inv.labor_amount || 0;
  if (metric === "materials") return inv.materials_amount || 0;
  return inv.total_amount || 0;
}

// ============================================
// Period options
// ============================================

type PeriodId = "30d" | "90d" | "ytd" | "all" | "custom";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

/** Parse a YYYY-MM-DD input value into a local day-boundary date, or null if invalid. */
function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve a period into an inclusive [start, end] range.
 * `earliest` anchors the all-time start; `custom` supplies the manual range.
 */
function resolveRange(
  period: PeriodId,
  earliest: Date | null,
  custom: { start: Date | null; end: Date | null }
): { start: Date; end: Date } {
  const today = startOfDay(new Date());
  switch (period) {
    case "30d":
      return { start: new Date(today.getTime() - 29 * MS_PER_DAY), end: today };
    case "90d":
      return { start: new Date(today.getTime() - 89 * MS_PER_DAY), end: today };
    case "ytd":
      return { start: new Date(today.getFullYear(), 0, 1), end: today };
    case "all":
      return { start: earliest ? startOfDay(earliest) : today, end: today };
    case "custom": {
      const start = custom.start ? startOfDay(custom.start) : today;
      const end = custom.end ? startOfDay(custom.end) : today;
      // Guard against a reversed range so counts never go negative.
      return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start };
    }
  }
}

// ============================================
// Report
// ============================================

export function BillableReport() {
  const [invoices, setInvoices] = useState<HdmsInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodId>("90d");
  const [metric, setMetric] = useState<Metric>("total");
  const [customStart, setCustomStart] = useState(
    () => new Date(Date.now() - 89 * MS_PER_DAY).toISOString().split("T")[0]
  );
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split("T")[0]);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/invoices?limit=5000");
      const data = await res.json();
      if (res.ok) setInvoices(data.invoices || []);
    } catch (err) {
      console.error("Failed to fetch invoices for report:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Non-void invoices with a usable date, paired with their billable date.
  const billable = useMemo(() => {
    return invoices
      .filter((inv) => inv.status !== "void")
      .map((inv) => ({ inv, date: billableDate(inv) }))
      .filter((x): x is { inv: HdmsInvoice; date: Date } => x.date !== null);
  }, [invoices]);

  const earliest = useMemo(() => {
    if (billable.length === 0) return null;
    return billable.reduce((min, x) => (x.date < min ? x.date : min), billable[0].date);
  }, [billable]);

  const report = useMemo(() => {
    const custom = { start: parseDateInput(customStart), end: parseDateInput(customEnd) };
    const { start, end } = resolveRange(period, earliest, custom);
    const startMs = startOfDay(start).getTime();
    const endMs = startOfDay(end).getTime();

    const inRange = billable.filter((x) => {
      const t = startOfDay(x.date).getTime();
      return t >= startMs && t <= endMs;
    });

    // `metricTotal` drives the averages + monthly chart; labor/materials/total
    // are always summed for the totals strip regardless of the selected metric.
    let metricTotal = 0;
    let total = 0;
    let labor = 0;
    let materials = 0;
    const byMonth = new Map<string, { total: number; count: number }>();

    for (const { inv, date } of inRange) {
      const amt = amountFor(inv, metric);
      metricTotal += amt;
      total += inv.total_amount || 0;
      labor += inv.labor_amount || 0;
      materials += inv.materials_amount || 0;
      const key = monthKey(date);
      const bucket = byMonth.get(key) || { total: 0, count: 0 };
      bucket.total += amt;
      bucket.count += 1;
      byMonth.set(key, bucket);
    }

    const calDays = Math.max(0, calendarDays(start, end));
    const workDays = businessDays(start, end);
    const weeks = calDays / 7;
    const months = calDays / AVG_DAYS_PER_MONTH;

    const months_sorted = Array.from(byMonth.entries())
      .map(([key, v]) => ({ key, label: monthLabel(key), ...v }))
      .sort((a, b) => (a.key < b.key ? 1 : -1));

    return {
      start,
      end,
      count: inRange.length,
      metricTotal,
      total,
      labor,
      materials,
      calDays,
      workDays,
      perWorkDay: workDays > 0 ? metricTotal / workDays : 0,
      perWeek: weeks > 0 ? metricTotal / weeks : 0,
      perMonth: months > 0 ? metricTotal / months : 0,
      // Forecast: current daily run-rate extrapolated to a full year (= perMonth × 12).
      annualized: calDays > 0 ? (metricTotal / calDays) * 365.25 : 0,
      byMonth: months_sorted,
    };
  }, [billable, period, earliest, metric, customStart, customEnd]);

  const metricLabel = METRICS.find((m) => m.id === metric)?.label || "Total";

  function handleExportCsv() {
    const headers = ["Month", "Invoices", `${metricLabel} billable`];
    const rows = report.byMonth.map((m) => [m.label, String(m.count), m.total.toFixed(2)]);
    const summary = [
      [],
      ["Metric", metricLabel],
      ["Period", PERIODS.find((p) => p.id === period)?.label || ""],
      ["Range", `${report.start.toLocaleDateString()} – ${report.end.toLocaleDateString()}`],
      ["Invoices", String(report.count)],
      [`${metricLabel} billable`, report.metricTotal.toFixed(2)],
      ["Avg / work day", report.perWorkDay.toFixed(2)],
      ["Avg / week", report.perWeek.toFixed(2)],
      ["Avg / month", report.perMonth.toFixed(2)],
      ["Annualized (projected)", report.annualized.toFixed(2)],
    ];
    const all = [headers, ...rows, ...summary];
    const csv = all
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `billable-report-${metric}-${period}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rangeLabel = `${report.start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} – ${report.end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const maxMonth = Math.max(1, ...report.byMonth.map((m) => m.total));

  return (
    <div className="space-y-6">
      {/* Metric + period selectors */}
      <div className="bg-white rounded-xl border border-sand-200 shadow-card px-5 py-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-medium text-charcoal-400 uppercase mr-1">Metric:</span>
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetric(m.id)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all duration-200 ${
                  metric === m.id
                    ? "bg-terra-100/80 text-terra-700 ring-1 ring-terra-300 shadow-sm"
                    : "bg-charcoal-50 text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchInvoices}
            disabled={isLoading}
            className="text-charcoal-400 hover:text-charcoal-600 text-xs h-7"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-medium text-charcoal-400 uppercase mr-1">Period:</span>
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all duration-200 ${
                  period === p.id
                    ? "bg-terra-100/80 text-terra-700 ring-1 ring-terra-300 shadow-sm"
                    : "bg-charcoal-50 text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-charcoal-400">{rangeLabel}</span>
        </div>

        {/* Custom date range inputs */}
        {period === "custom" && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[10px] font-medium text-charcoal-400 uppercase">From:</span>
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 px-2 text-xs bg-white border border-sand-200 rounded-lg text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-300"
            />
            <span className="text-[10px] font-medium text-charcoal-400 uppercase">To:</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 px-2 text-xs bg-white border border-sand-200 rounded-lg text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-300"
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-terra-500 mx-auto" />
        </div>
      ) : (
        <>
          {/* Average cards — the headline of the report */}
          <p className="text-[11px] text-charcoal-400 -mb-2">
            Averages based on <span className="font-semibold text-terra-600">{metricLabel}</span> billable
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Avg / Work Day", value: report.perWorkDay, sub: `over ${report.workDays} business day${report.workDays !== 1 ? "s" : ""}`, forecast: false },
              { label: "Avg / Week", value: report.perWeek, sub: `over ${(report.calDays / 7).toFixed(1)} weeks`, forecast: false },
              { label: "Avg / Month", value: report.perMonth, sub: `over ${(report.calDays / AVG_DAYS_PER_MONTH).toFixed(1)} months`, forecast: false },
              { label: "Annualized", value: report.annualized, sub: "projected / year at this pace", forecast: true },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-xl p-5 shadow-card ${
                  card.forecast
                    ? "bg-terra-50/70 border border-dashed border-terra-300"
                    : "bg-white border border-sand-200"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className={`h-3.5 w-3.5 ${card.forecast ? "text-terra-600" : "text-terra-500"}`} />
                  <p className={`text-[11px] font-semibold uppercase tracking-wider ${card.forecast ? "text-terra-700" : "text-charcoal-400"}`}>
                    {card.label}
                  </p>
                </div>
                <p className={`text-3xl font-bold ${card.forecast ? "text-terra-700" : "text-charcoal-900"}`}>
                  {formatCurrencyShort(card.value)}
                </p>
                <p className={`text-[10px] mt-1 ${card.forecast ? "text-terra-500" : "text-charcoal-300"}`}>
                  {card.sub}
                </p>
              </div>
            ))}
          </div>

          {/* Totals strip — active metric is ringed */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`rounded-lg px-2 py-1 -mx-2 ${metric === "total" ? "ring-1 ring-terra-300 bg-terra-50/60" : ""}`}>
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-0.5">Total Billable</p>
              <p className="text-xl font-semibold text-charcoal-900">{formatCurrency(report.total)}</p>
            </div>
            <div className="px-2 py-1 -mx-2">
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-0.5">Invoices</p>
              <p className="text-xl font-semibold text-charcoal-900">{report.count}</p>
            </div>
            <div className={`rounded-lg px-2 py-1 -mx-2 ${metric === "labor" ? "ring-1 ring-terra-300 bg-terra-50/60" : ""}`}>
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-0.5">Labor</p>
              <p className="text-xl font-semibold text-blue-600">{formatCurrency(report.labor)}</p>
            </div>
            <div className={`rounded-lg px-2 py-1 -mx-2 ${metric === "materials" ? "ring-1 ring-terra-300 bg-terra-50/60" : ""}`}>
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-0.5">Materials</p>
              <p className="text-xl font-semibold text-amber-600">{formatCurrency(report.materials)}</p>
            </div>
          </div>

          {/* Monthly breakdown */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-sand-200">
              <span className="text-sm font-semibold text-charcoal-700">{metricLabel} Billable by Month</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportCsv}
                disabled={report.count === 0}
                className="text-charcoal-400 hover:text-charcoal-600 text-xs"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
            </div>
            {report.byMonth.length === 0 ? (
              <div className="px-5 py-10 text-center text-charcoal-400 text-xs">
                No billable invoices in this period.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-100/80">
                    <th className="text-left px-5 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Month</th>
                    <th className="text-right px-5 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider w-[90px]">Invoices</th>
                    <th className="text-right px-5 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider w-[140px]">{metricLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byMonth.map((m) => (
                    <tr key={m.key} className="border-b border-charcoal-50/80 hover:bg-charcoal-50 transition-colors">
                      <td className="px-5 py-2.5">
                        <span className="text-xs font-medium text-charcoal-800">{m.label}</span>
                        <div className="mt-1 h-1.5 rounded-full bg-charcoal-100 overflow-hidden">
                          <div
                            className="h-full bg-terra-400 rounded-full"
                            style={{ width: `${Math.max(3, (m.total / maxMonth) * 100)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right text-charcoal-500 text-xs">{m.count}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-charcoal-800 text-xs">
                        {formatCurrency(m.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-[10px] text-charcoal-300 text-center">
            Billables counted on completed date (falling back to created date). Void invoices excluded.
            Per-work-day average uses Mon–Fri business days. Annualized is a forecast — the current
            daily run-rate extrapolated to a full year, not booked revenue.
          </p>
        </>
      )}
    </div>
  );
}
