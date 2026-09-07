"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HDMS_RECON_CATEGORIES,
  HDMS_RECON_LABELS,
  type HdmsReconciliation,
  type HdmsReconCategory,
  type HdmsReconRow,
} from "@/lib/maintenance/hdms-reconcile";

// ============================================
// HDMS Billing Reconciliation (ADMIN ONLY)
//
// Every HDMS work order should convert into an invoice once it's done. This
// report scopes work orders to the in-house crew and flags the mismatches:
// done-but-not-billed (revenue leak), billed-but-not-done, and still-in-flight.
// ============================================

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function formatDate(d: string | null): string {
  return d ? d.slice(0, 10) : "—";
}

// Visual weight per category — the leak reads hottest.
const CATEGORY_STYLE: Record<HdmsReconCategory, { tile: string; label: string; badge: string }> = {
  done_unbilled: {
    tile: "bg-red-50 border-red-200",
    label: "text-red-600",
    badge: "bg-red-100 text-red-700",
  },
  billed_not_done: {
    tile: "bg-amber-50 border-amber-200",
    label: "text-amber-600",
    badge: "bg-amber-100 text-amber-700",
  },
  not_done: {
    tile: "bg-white border-sand-200",
    label: "text-blue-600",
    badge: "bg-blue-100 text-blue-700",
  },
  done_billed: {
    tile: "bg-white border-sand-200",
    label: "text-emerald-600",
    badge: "bg-emerald-100 text-emerald-700",
  },
  canceled: {
    tile: "bg-white border-sand-200",
    label: "text-charcoal-500",
    badge: "bg-charcoal-100 text-charcoal-500",
  },
};

function toCsv(rows: HdmsReconRow[]): string {
  const header = [
    "category",
    "wo_number",
    "unit",
    "property",
    "description",
    "appfolio_status",
    "assigned_tech",
    "owner",
    "completed_date",
    "invoice_code",
    "invoice_status",
    "invoice_total",
    "appfolio_link",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      HDMS_RECON_LABELS[r.category],
      r.wo_number,
      r.unit_name,
      r.property_name,
      r.description,
      r.appfolio_status,
      r.assigned_tech,
      r.owner_name,
      r.completed_date,
      r.invoice_code,
      r.invoice_status,
      r.invoice_total,
      r.appfolio_link,
    ]
      .map(esc)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export function HdmsReconReport() {
  const [data, setData] = useState<HdmsReconciliation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(180);
  const [filter, setFilter] = useState<HdmsReconCategory | "all">("all");

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/hdms-reconcile?windowDays=${windowDays}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Reconciliation failed");
      setData(json.reconciliation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconciliation failed");
    } finally {
      setIsLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    const rows = filter === "all" ? data.rows : data.rows.filter((r) => r.category === filter);
    // Leaks first, then premature bills, then in-flight, then healthy/canceled.
    const order = new Map(HDMS_RECON_CATEGORIES.map((c, i) => [c, i]));
    return [...rows].sort(
      (a, b) =>
        (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) ||
        (a.completed_date ?? "").localeCompare(b.completed_date ?? "")
    );
  }, [data, filter]);

  const downloadCsv = useCallback(() => {
    if (!data) return;
    const blob = new Blob([toCsv(data.rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hdms-billing-recon-${windowDays}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, windowDays]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-charcoal-800">HDMS Billing Reconciliation</h2>
          <p className="text-xs text-charcoal-400">
            Every High Desert Maintenance Services work order vs. its invoice — done-but-not-billed
            leaks, premature bills, and jobs still in flight. Admin only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="h-8 rounded-md border border-sand-300 bg-white px-2 text-xs text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-400"
          >
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
            <option value={365}>Last 365 days</option>
          </select>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading} className="text-xs h-8">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Run
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={!data || data.rows.length === 0}
            className="text-xs h-8"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {isLoading && !data && (
        <div className="flex items-center justify-center py-16 text-charcoal-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Scoping HDMS work orders and joining invoices…</span>
        </div>
      )}

      {data && (
        <>
          {/* Summary tiles — one per category, click to filter */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`text-left bg-white rounded-xl border shadow-card p-4 transition-colors ${
                filter === "all" ? "border-terra-400 ring-1 ring-terra-300" : "border-sand-200"
              }`}
            >
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">All HDMS WOs</p>
              <p className="text-xl font-bold text-charcoal-900">{data.rows.length.toLocaleString()}</p>
              <p className="text-[10px] text-charcoal-400 mt-0.5">last {data.windowDays} days</p>
            </button>
            {HDMS_RECON_CATEGORIES.map((cat) => {
              const b = data.summary[cat];
              const s = CATEGORY_STYLE[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFilter(filter === cat ? "all" : cat)}
                  className={`text-left rounded-xl border shadow-card p-4 transition-colors ${s.tile} ${
                    filter === cat ? "ring-1 ring-terra-300" : ""
                  }`}
                >
                  <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${s.label}`}>
                    {HDMS_RECON_LABELS[cat]}
                  </p>
                  <p className="text-xl font-bold text-charcoal-900">{b.count.toLocaleString()}</p>
                  <p className="text-[10px] text-charcoal-400 mt-0.5">
                    {b.invoicedTotal > 0 ? formatCurrency(b.invoicedTotal) + " invoiced" : "—"}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Detail table */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-sand-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-charcoal-700">
                {filter === "all" ? "All work orders" : HDMS_RECON_LABELS[filter]}
              </span>
              <span className="text-[10px] text-charcoal-400">{visibleRows.length.toLocaleString()} rows</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-100/80 bg-charcoal-50/40">
                    {["Status", "WO #", "Unit / Property", "Description", "AppFolio", "Tech", "Completed", "Invoice", "Amount", ""].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider whitespace-nowrap"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r, i) => {
                    const s = CATEGORY_STYLE[r.category];
                    return (
                      <tr key={`${r.wo_id ?? r.invoice_code ?? "x"}-${i}`} className="border-b border-charcoal-50 hover:bg-sand-50/40">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.badge}`}>
                            {HDMS_RECON_LABELS[r.category]}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-charcoal-700">{r.wo_number ?? "—"}</td>
                        <td className="px-3 py-2 text-charcoal-600">
                          <div className="max-w-[16rem] truncate">{r.unit_name || r.property_name || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-charcoal-500">
                          <div className="max-w-[20rem] truncate">{r.description || "—"}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-charcoal-500">{r.appfolio_status ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-charcoal-500">{r.assigned_tech ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-charcoal-500">{formatDate(r.completed_date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-charcoal-500">
                          {r.invoice_code ? (
                            <span>
                              {r.invoice_code}
                              {r.invoice_status ? <span className="text-charcoal-300"> · {r.invoice_status}</span> : null}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right text-charcoal-600">
                          {r.invoice_total != null ? formatCurrency(r.invoice_total) : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.appfolio_link ? (
                            <a
                              href={r.appfolio_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-terra-500 hover:text-terra-600"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-sm text-charcoal-400">
                        No work orders in this bucket.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[10px] text-charcoal-400">
            &ldquo;Done&rdquo; = AppFolio-Completed <em>or</em> HDPM-verified. A work order is
            &ldquo;billed&rdquo; when a non-void HDMS invoice (not a credit memo) links to it by
            work-order id or WO reference. Amounts are <code>hdms_invoices.total_amount</code> — AppFolio&rsquo;s
            v0 API exposes no estimate/bill dollar fields. Generated {formatDate(data.generatedAt)}.
          </p>
        </>
      )}
    </div>
  );
}
