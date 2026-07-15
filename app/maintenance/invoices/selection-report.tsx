"use client";

import React, { useCallback, useEffect, useMemo } from "react";
import { X, Download, Printer, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HdmsInvoice } from "@/lib/invoices";
import { emptyGroup, analyze } from "@/lib/invoice-analysis";

// ============================================
// Helpers
// ============================================

function formatCurrency(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

/** The date an invoice is reported on: completed date, falling back to created. */
function invoiceDate(inv: HdmsInvoice): string | null {
  return inv.completed_date || inv.created_at || null;
}

// Analysis helpers (analyze / Group / Analysis / emptyGroup) live in
// @/lib/invoice-analysis so the payment reconciliation flow reuses them.

// ============================================
// Selection Report (modal)
// ============================================

interface SelectionReportProps {
  invoices: HdmsInvoice[];
  onClose: () => void;
}

export function SelectionReport({ invoices, onClose }: SelectionReportProps) {
  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const rows = useMemo(
    () =>
      invoices.map((inv) => ({ inv, a: analyze(inv) })).sort((x, y) => {
        const xd = invoiceDate(x.inv) || "";
        const yd = invoiceDate(y.inv) || "";
        return xd < yd ? 1 : xd > yd ? -1 : 0;
      }),
    [invoices]
  );

  const totals = useMemo(() => {
    const t = {
      count: rows.length,
      voidCount: 0,
      labor: 0,
      materials: emptyGroup(),
      appliance: emptyGroup(),
      other: 0,
      grand: 0,
    };
    for (const { inv, a } of rows) {
      if (inv.status === "void") t.voidCount++;
      t.labor += a.labor;
      t.other += a.other;
      t.grand += a.total;
      for (const key of ["cost", "markup", "charged", "missingCost"] as const) {
        t.materials[key] += a.materials[key];
        t.appliance[key] += a.appliance[key];
      }
    }
    return t;
  }, [rows]);

  const materialCost = totals.materials.cost + totals.appliance.cost;
  const markupTotal = totals.materials.markup + totals.appliance.markup;
  const missingCostCharged = totals.materials.missingCost + totals.appliance.missingCost;

  const dateRange = useMemo(() => {
    const dates = rows.map((r) => invoiceDate(r.inv)).filter(Boolean) as string[];
    if (dates.length === 0) return "—";
    const sorted = [...dates].sort();
    return `${formatDate(sorted[0])} – ${formatDate(sorted[sorted.length - 1])}`;
  }, [rows]);

  // ── CSV export (internal — includes cost + markup) ──────────
  function handleExportCsv() {
    const header = [
      "Invoice",
      "Date",
      "Property",
      "Status",
      "Labor",
      "Material Cost",
      "Markup",
      "Materials Charged",
      "Appliance Cost",
      "Appliance Markup",
      "Other",
      "Total Charged",
    ];
    const body = rows.map(({ inv, a }) => [
      inv.invoice_code,
      formatDate(invoiceDate(inv)),
      inv.property_name,
      inv.status,
      a.labor.toFixed(2),
      a.materials.cost.toFixed(2),
      a.materials.markup.toFixed(2),
      a.materials.charged.toFixed(2),
      a.appliance.cost.toFixed(2),
      a.appliance.markup.toFixed(2),
      a.other.toFixed(2),
      a.total.toFixed(2),
    ]);
    const summary = [
      [],
      ["SUMMARY", ""],
      ["Invoices", String(totals.count)],
      ["Date range", dateRange],
      ["Labor", totals.labor.toFixed(2)],
      ["Material cost (materials + appliances)", materialCost.toFixed(2)],
      ["Markup captured", markupTotal.toFixed(2)],
      ["Other", totals.other.toFixed(2)],
      ["Total charged", totals.grand.toFixed(2)],
      [],
      ["Materials — cost", totals.materials.cost.toFixed(2)],
      ["Materials — markup", totals.materials.markup.toFixed(2)],
      ["Materials — charged", totals.materials.charged.toFixed(2)],
      ["Appliances — cost", totals.appliance.cost.toFixed(2)],
      ["Appliances — markup", totals.appliance.markup.toFixed(2)],
      ["Appliances — charged", totals.appliance.charged.toFixed(2)],
    ];
    const all = [header, ...body, ...summary];
    const csv = all
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `markup-report-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ── Printable summary (opens a clean window and prints) ──────────
  function handlePrint() {
    const rowsHtml = rows
      .map(
        ({ inv, a }) => `
          <tr>
            <td>${inv.invoice_code}</td>
            <td>${formatDate(invoiceDate(inv))}</td>
            <td>${escapeHtml(inv.property_name)}</td>
            <td class="num">${formatCurrency(a.labor)}</td>
            <td class="num">${formatCurrency(a.materials.cost + a.appliance.cost)}</td>
            <td class="num">${formatCurrency(a.materials.markup + a.appliance.markup)}</td>
            <td class="num">${formatCurrency(a.total)}</td>
          </tr>`
      )
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>Markup Report</title>
      <style>
        body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #222; margin: 32px; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e0e0e0; }
        th { text-transform: uppercase; font-size: 10px; color: #888; }
        td.num, th.num { text-align: right; }
        tfoot td { font-weight: bold; border-top: 2px solid #333; }
        .cards { display: flex; gap: 16px; margin: 16px 0 24px; }
        .card { flex: 1; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
        .card .label { font-size: 10px; text-transform: uppercase; color: #888; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 4px; }
        .note { color: #888; font-size: 10px; margin-top: 16px; }
      </style></head><body>
      <h1>HDMS Markup Report</h1>
      <div class="meta">${totals.count} invoice(s) · ${dateRange} · internal — not for owners</div>
      <div class="cards">
        <div class="card"><div class="label">Labor</div><div class="value">${formatCurrency(totals.labor)}</div></div>
        <div class="card"><div class="label">Material Cost</div><div class="value">${formatCurrency(materialCost)}</div></div>
        <div class="card"><div class="label">Markup</div><div class="value">${formatCurrency(markupTotal)}</div></div>
        <div class="card"><div class="label">Total Charged</div><div class="value">${formatCurrency(totals.grand)}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Invoice</th><th>Date</th><th>Property</th>
          <th class="num">Labor</th><th class="num">Mat. Cost</th><th class="num">Markup</th><th class="num">Total</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="3">Totals (${totals.count})</td>
          <td class="num">${formatCurrency(totals.labor)}</td>
          <td class="num">${formatCurrency(materialCost)}</td>
          <td class="num">${formatCurrency(markupTotal)}</td>
          <td class="num">${formatCurrency(totals.grand)}</td>
        </tr></tfoot>
      </table>
      ${missingCostCharged > 0
        ? `<div class="note">${formatCurrency(missingCostCharged)} of materials had no cost recorded — markup reflects only lines with a cost entered.</div>`
        : ""}
      </body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    // Give the new window a tick to render before printing.
    setTimeout(() => w.print(), 250);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-4xl h-[90vh] mx-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-charcoal-200/60 bg-charcoal-50/80">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-terra-600" />
            <div>
              <span className="font-semibold text-charcoal-900 text-sm">Markup Report</span>
              <span className="ml-2 text-xs text-charcoal-500">
                {totals.count} invoice{totals.count !== 1 ? "s" : ""} · {dateRange}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCsv} className="text-xs h-8">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} className="text-xs h-8">
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Print
            </Button>
            <button
              onClick={onClose}
              className="flex items-center justify-center h-8 w-8 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <p className="text-[11px] text-charcoal-400">
            Internal report — cost and markup are <strong>not</strong> shown to owners.
          </p>

          {/* Totals cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Labor", value: totals.labor, color: "text-blue-600" },
              { label: "Material Cost", value: materialCost, color: "text-amber-600" },
              { label: "Markup", value: markupTotal, color: "text-orange-600" },
              { label: "Total Charged", value: totals.grand, color: "text-charcoal-900" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-sand-200 shadow-card p-4">
                <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">
                  {c.label}
                </p>
                <p className={`text-xl font-bold ${c.color}`}>{formatCurrency(c.value)}</p>
              </div>
            ))}
          </div>

          {/* Appliances vs Materials split */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-sand-200">
              <span className="text-sm font-semibold text-charcoal-700">Materials vs Appliances</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-100/80">
                  <th className="text-left px-5 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="text-right px-5 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Cost</th>
                  <th className="text-right px-5 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Markup</th>
                  <th className="text-right px-5 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Charged</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Materials", g: totals.materials, mk: "25%" },
                  { label: "Appliances", g: totals.appliance, mk: "10%" },
                ].map((r) => (
                  <tr key={r.label} className="border-b border-charcoal-50/80">
                    <td className="px-5 py-2.5 text-xs font-medium text-charcoal-800">
                      {r.label}
                      <span className="ml-2 text-[10px] text-charcoal-300">default {r.mk}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs text-amber-600">{formatCurrency(r.g.cost)}</td>
                    <td className="px-5 py-2.5 text-right text-xs font-medium text-orange-600">{formatCurrency(r.g.markup)}</td>
                    <td className="px-5 py-2.5 text-right text-xs font-medium text-charcoal-800">{formatCurrency(r.g.charged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-invoice rows */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-sand-200">
              <span className="text-sm font-semibold text-charcoal-700">Per Invoice</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-100/80">
                    <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Invoice</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Property</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Labor</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Mat. Cost</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Markup</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ inv, a }) => (
                    <tr key={inv.id} className="border-b border-charcoal-50/80 hover:bg-charcoal-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-charcoal-700">{inv.invoice_code}</span>
                        {inv.status === "void" && (
                          <span className="ml-1.5 text-[9px] text-red-500 uppercase">void</span>
                        )}
                        <span className="block text-[10px] text-charcoal-400">{formatDate(invoiceDate(inv))}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal-600 truncate max-w-[160px]">{inv.property_name}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-blue-600">{formatCurrency(a.labor)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-amber-600">{formatCurrency(a.materials.cost + a.appliance.cost)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-orange-600">{formatCurrency(a.materials.markup + a.appliance.markup)}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-charcoal-800">{formatCurrency(a.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-charcoal-200 bg-charcoal-50/60">
                    <td className="px-4 py-2.5 text-xs font-semibold text-charcoal-700" colSpan={2}>
                      Totals ({totals.count})
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-blue-700">{formatCurrency(totals.labor)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-amber-700">{formatCurrency(materialCost)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-orange-700">{formatCurrency(markupTotal)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-charcoal-900">{formatCurrency(totals.grand)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {missingCostCharged > 0 && (
            <p className="text-[10px] text-charcoal-400">
              {formatCurrency(missingCostCharged)} of materials/appliances had no cost recorded — markup
              reflects only lines where a cost was entered. Older invoices show no markup.
            </p>
          )}
          {totals.other > 0 && (
            <p className="text-[10px] text-charcoal-400">
              Total charged includes {formatCurrency(totals.other)} of &ldquo;Other&rdquo; line items not
              broken out above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Minimal HTML escaper for the print window.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
