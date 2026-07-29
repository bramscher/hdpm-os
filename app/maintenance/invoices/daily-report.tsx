"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Download, CalendarDays, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HdmsInvoice, LineItem, lineMarkup, TECHNICIANS, normalizeTechnician } from "@/lib/invoices";

// ============================================
// Daily Labor & Markup report (ADMIN ONLY)
//
// One row per day: billable labor hours, labor billed, and markup captured on
// materials/appliance lines. Contains profit information — the dashboard only
// renders this for admin users (ADMIN_EMAILS), same gate as the KPI dashboard.
// ============================================

/** Fallback hourly rate when a labor line has no qty and no unit price. */
const DEFAULT_LABOR_RATE = 95;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatCurrency(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatHours(h: number): string {
  return h.toFixed(1);
}

/** The day an invoice is counted against: completed date, falling back to created. */
function invoiceDay(inv: HdmsInvoice): string | null {
  const raw = inv.completed_date || inv.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function isWeekend(key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

/** Every day in [from, to] descending (bounded to a year as a safety cap). */
function allDaysDesc(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  const days: string[] = [];
  for (let d = new Date(end); d >= start && days.length < 366; d.setDate(d.getDate() - 1)) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push(`${d.getFullYear()}-${mm}-${dd}`);
  }
  return days;
}

/** Billable hours on a labor line: qty, else amount ÷ rate (estimated). */
function laborHours(li: LineItem): { hours: number; estimated: boolean } {
  if (li.qty && li.qty > 0) return { hours: li.qty, estimated: false };
  const amount = li.amount || 0;
  if (li.unit_price && li.unit_price > 0) return { hours: amount / li.unit_price, estimated: true };
  return { hours: amount / DEFAULT_LABOR_RATE, estimated: true };
}

interface DayRow {
  day: string; // YYYY-MM-DD
  invoices: number;
  laborHours: number;
  laborBilled: number;
  estimatedHours: number; // portion of laborHours derived from $ instead of qty
  materialsMarkup: number;
  applianceMarkup: number;
}

function todayInput(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * MS_PER_DAY);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

type TechFilter = "all" | (typeof TECHNICIANS)[number] | "Unassigned";
const TECH_FILTERS: TechFilter[] = ["all", ...TECHNICIANS, "Unassigned"];

export function DailyReport() {
  const [invoices, setInvoices] = useState<HdmsInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [from, setFrom] = useState(() => todayInput(-29));
  const [to, setTo] = useState(() => todayInput());
  const [tech, setTech] = useState<TechFilter>("all");

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/invoices?limit=5000");
      const data = await res.json();
      if (res.ok) setInvoices(data.invoices || []);
    } catch (err) {
      console.error("Failed to fetch invoices for daily report:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const rows = useMemo(() => {
    // Bucket a labor line for the tech filter ('' → Unassigned).
    const lineBucket = (li: LineItem): TechFilter => normalizeTechnician(li.technician) || "Unassigned";

    const byDay = new Map<string, DayRow>();
    const emptyRow = (day: string): DayRow => ({
      day,
      invoices: 0,
      laborHours: 0,
      laborBilled: 0,
      estimatedHours: 0,
      materialsMarkup: 0,
      applianceMarkup: 0,
    });

    for (const inv of invoices) {
      if (inv.status === "void") continue;
      const day = invoiceDay(inv);
      if (!day || day < from || day > to) continue;

      const items: LineItem[] = inv.line_items || [];
      const laborLines = items.filter((li) => (li.type || "labor") === "labor");
      // Tech filter: include an invoice when it has a labor line in the bucket
      // (legacy no-line-item invoices count as Unassigned).
      const invBuckets = new Set<TechFilter>(
        items.length > 0 ? laborLines.map(lineBucket) : ["Unassigned"]
      );
      if (tech !== "all" && !invBuckets.has(tech)) continue;

      let row = byDay.get(day);
      if (!row) {
        row = emptyRow(day);
        byDay.set(day, row);
      }
      row.invoices++;

      if (items.length > 0) {
        for (const li of items) {
          const type = li.type || "labor";
          if (type === "labor") {
            if (tech !== "all" && lineBucket(li) !== tech) continue;
            const { hours, estimated } = laborHours(li);
            row.laborHours += hours;
            row.laborBilled += li.amount || 0;
            if (estimated) row.estimatedHours += hours;
          } else if (type === "materials") {
            row.materialsMarkup += lineMarkup(li);
          } else if (type === "appliance") {
            row.applianceMarkup += lineMarkup(li);
          }
        }
      } else {
        // Legacy invoice — labor column only, hours estimated at the default rate.
        const amount = inv.labor_amount || 0;
        row.laborBilled += amount;
        row.laborHours += amount / DEFAULT_LABOR_RATE;
        row.estimatedHours += amount / DEFAULT_LABOR_RATE;
      }
    }

    // Every calendar day in range, so zero-invoice weekdays are visible.
    return allDaysDesc(from, to).map((day) => byDay.get(day) ?? emptyRow(day));
  }, [invoices, from, to, tech]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          invoices: t.invoices + r.invoices,
          laborHours: t.laborHours + r.laborHours,
          laborBilled: t.laborBilled + r.laborBilled,
          estimatedHours: t.estimatedHours + r.estimatedHours,
          materialsMarkup: t.materialsMarkup + r.materialsMarkup,
          applianceMarkup: t.applianceMarkup + r.applianceMarkup,
        }),
        { invoices: 0, laborHours: 0, laborBilled: 0, estimatedHours: 0, materialsMarkup: 0, applianceMarkup: 0 }
      ),
    [rows]
  );

  function handleExportCsv() {
    const header = ["Date", "Invoices", "Labor Hours", "Labor Billed", "Materials Markup", "Appliance Markup", "Total Markup", "Flag"];
    const body = rows.map((r) => [
      r.day,
      String(r.invoices),
      r.laborHours.toFixed(1),
      r.laborBilled.toFixed(2),
      r.materialsMarkup.toFixed(2),
      r.applianceMarkup.toFixed(2),
      (r.materialsMarkup + r.applianceMarkup).toFixed(2),
      !isWeekend(r.day) && r.laborHours < 0.05
        ? "NO HOURS (weekday)"
        : isWeekend(r.day) && r.laborHours >= 0.05
        ? "weekend worked"
        : "",
    ]);
    const footer = [
      [
        "TOTAL",
        String(totals.invoices),
        totals.laborHours.toFixed(1),
        totals.laborBilled.toFixed(2),
        totals.materialsMarkup.toFixed(2),
        totals.applianceMarkup.toFixed(2),
        (totals.materialsMarkup + totals.applianceMarkup).toFixed(2),
        "",
      ],
    ];
    const csv = [header, ...body, ...footer]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-labor-markup-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totalMarkup = totals.materialsMarkup + totals.applianceMarkup;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-charcoal-800">Daily Labor & Markup</h2>
          <p className="text-xs text-charcoal-400">
            Billable labor hours and materials/appliance markup per day. Internal — admin only.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            {TECH_FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTech(t)}
                className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                  tech === t
                    ? "bg-terra-500 text-white"
                    : "bg-charcoal-100/60 text-charcoal-500 hover:bg-charcoal-200/60"
                }`}
              >
                {t === "all" ? "All techs" : t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-charcoal-500">
            <CalendarDays className="h-3.5 w-3.5 text-charcoal-400" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 rounded-md border border-sand-300 bg-white px-2 text-xs text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-400"
            />
            <span className="text-charcoal-300">–</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 rounded-md border border-sand-300 bg-white px-2 text-xs text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-400"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={rows.length === 0} className="text-xs h-8">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchInvoices} disabled={isLoading} className="text-xs h-8">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Range totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Labor Hours", value: formatHours(totals.laborHours), color: "text-blue-600" },
          { label: "Labor Billed", value: formatCurrency(totals.laborBilled), color: "text-blue-600" },
          { label: "Materials Markup", value: formatCurrency(totals.materialsMarkup), color: "text-orange-600" },
          { label: "Total Markup", value: formatCurrency(totalMarkup), color: "text-charcoal-900" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-sand-200 shadow-card p-4">
            <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">{c.label}</p>
            <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Questionable-day flags */}
      {!isLoading && (
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          {(() => {
            const zeroWeekdays = rows.filter((r) => !isWeekend(r.day) && r.laborHours < 0.05).length;
            const weekendWorked = rows.filter((r) => isWeekend(r.day) && r.laborHours >= 0.05).length;
            return (
              <>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-medium ${
                    zeroWeekdays > 0 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                  }`}
                >
                  {zeroWeekdays > 0 && <AlertTriangle className="h-3 w-3" />}
                  {zeroWeekdays} weekday{zeroWeekdays === 1 ? "" : "s"} with no billable hours
                </span>
                {weekendWorked > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                    {weekendWorked} weekend day{weekendWorked === 1 ? "" : "s"} with billable hours
                  </span>
                )}
              </>
            );
          })()}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-charcoal-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Loading invoices…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-12 text-center text-charcoal-400 text-xs">
          Invalid date range.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-100/80 bg-charcoal-50/40">
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Date</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Inv.</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Labor Hrs</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Labor $</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Materials Markup</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Appliance Markup</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Total Markup</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const weekend = isWeekend(r.day);
                  const zeroHours = r.laborHours < 0.05;
                  // Weekday with no hours = questionable; weekend with hours = notable.
                  const rowClass = weekend
                    ? zeroHours
                      ? "bg-charcoal-50/40 text-charcoal-300"
                      : "bg-blue-50/40"
                    : zeroHours
                    ? "bg-amber-50/70"
                    : "";
                  return (
                    <tr key={r.day} className={`border-b border-charcoal-50/80 hover:bg-charcoal-50/60 ${rowClass}`}>
                      <td className="px-4 py-2.5 text-xs font-medium text-charcoal-800 whitespace-nowrap">
                        {dayLabel(r.day)}
                        {!weekend && zeroHours && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] text-amber-600 font-semibold uppercase">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            no hours
                          </span>
                        )}
                        {weekend && !zeroHours && (
                          <span className="ml-1.5 text-[9px] text-blue-600 font-semibold uppercase">weekend</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-charcoal-500">{r.invoices || "—"}</td>
                      <td className={`px-4 py-2.5 text-right text-xs ${!weekend && zeroHours ? "font-semibold text-amber-700" : "text-blue-600"}`}>
                        {formatHours(r.laborHours)}
                        {r.estimatedHours > 0.05 && <span className="text-charcoal-300 ml-0.5">≈</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-blue-600">{formatCurrency(r.laborBilled)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-orange-600">{formatCurrency(r.materialsMarkup)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-terra-600">{formatCurrency(r.applianceMarkup)}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-charcoal-800">
                        {formatCurrency(r.materialsMarkup + r.applianceMarkup)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-charcoal-200 bg-charcoal-50/60">
                  <td className="px-4 py-2.5 text-xs font-semibold text-charcoal-700">
                    Totals ({rows.filter((r) => r.invoices > 0).length} of {rows.length} days active)
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-charcoal-700">{totals.invoices}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-blue-700">{formatHours(totals.laborHours)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-blue-700">{formatCurrency(totals.laborBilled)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-orange-700">{formatCurrency(totals.materialsMarkup)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-terra-700">{formatCurrency(totals.applianceMarkup)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-charcoal-900">{formatCurrency(totalMarkup)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {totals.estimatedHours > 0.05 && (
        <p className="text-[10px] text-charcoal-400">
          ≈ {formatHours(totals.estimatedHours)} of {formatHours(totals.laborHours)} hours are estimated from labor
          dollars (lines without an hours quantity, at the line rate or ${DEFAULT_LABOR_RATE}/hr default).
        </p>
      )}
      <p className="text-[10px] text-charcoal-400">
        Days are the invoice&rsquo;s completed date (falling back to created) — a flagged weekday can mean no work
        was invoiced that day, not necessarily that no work was done. Batch-invoicing several days at once shows up
        as one big day surrounded by zero days.
      </p>
      {tech !== "all" && (
        <p className="text-[10px] text-charcoal-400">
          Tech filter: hours and labor $ count only {tech} labor lines; markup columns reflect the full invoices
          that contain {tech}&rsquo;s labor (materials aren&rsquo;t attributed to a tech).
        </p>
      )}
    </div>
  );
}
