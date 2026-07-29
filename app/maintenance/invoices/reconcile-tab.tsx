"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Wallet,
  Plus,
  ArrowLeft,
  Loader2,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Receipt,
  Link2,
  Unlink,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HdmsInvoice } from "@/lib/invoices";
import type { Payment, PaymentWithInvoices } from "@/lib/payments";
import type { AfBillWithInvoice, AfBillSummary, SyncResult } from "@/lib/af-bills";
import { InvoiceList } from "./invoice-list";
import { CapturePaymentModal } from "./capture-payment-modal";

function formatCurrency(amount: number | null): string {
  if (amount == null) return "—";
  const n = typeof amount === "number" ? amount : parseFloat(String(amount)) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  // Parse a YYYY-MM-DD date as LOCAL (not UTC) so e.g. "2026-07-10" doesn't
  // render as Jul 9 in negative-offset timezones.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface ReconcileTabProps {
  invoices: HdmsInvoice[];
  isLoadingInvoices: boolean;
  onRefreshInvoices: () => void;
  onEdit: (invoice: HdmsInvoice) => void;
  onReconcile: (invoices: HdmsInvoice[]) => void;
  /** Bump to force a re-fetch of the payments ledger (e.g. after recording). */
  reloadToken: number;
}

export function ReconcileTab({
  invoices,
  isLoadingInvoices,
  onRefreshInvoices,
  onEdit,
  onReconcile,
  reloadToken,
}: ReconcileTabProps) {
  const [mode, setMode] = useState<"ledger" | "new" | "billing">("ledger");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentWithInvoices | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);

  // AppFolio bill snapshot (billing check)
  const [afBills, setAfBills] = useState<AfBillWithInvoice[]>([]);
  const [afSummary, setAfSummary] = useState<AfBillSummary | null>(null);
  const [afSyncing, setAfSyncing] = useState(false);
  const [afSyncMessage, setAfSyncMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load payments");
      setPayments(data.payments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAfBills = useCallback(async () => {
    try {
      const res = await fetch("/api/af-bills");
      const data = await res.json();
      if (res.ok) {
        setAfBills(data.bills);
        setAfSummary(data.summary);
      }
    } catch (err) {
      console.error("Failed to fetch AppFolio bills:", err);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
    fetchAfBills();
  }, [fetchPayments, fetchAfBills, reloadToken]);

  async function handleAfSync() {
    setAfSyncing(true);
    setAfSyncMessage(null);
    try {
      const res = await fetch("/api/af-bills/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const r: SyncResult = data.result;
      setAfSyncMessage(
        `Synced ${r.hdms_bills} HDMS bills (${r.auto_matched} newly matched, ${r.unmatched} unmatched)`
      );
      await fetchAfBills();
      onRefreshInvoices();
    } catch (err) {
      setAfSyncMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setAfSyncing(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await fetch("/api/payments/import-appfolio", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const r = data.result as {
        created: number;
        adopted: number;
        existing: number;
        attachedTotal: number;
        disbursements: Array<{ unmatchedRefs: string[]; conflicts: string[] }>;
      };
      const unmatched = r.disbursements.reduce((s, d) => s + d.unmatchedRefs.length, 0);
      const conflicts = r.disbursements.reduce((s, d) => s + d.conflicts.length, 0);
      setImportMessage(
        `${r.created} new, ${r.adopted} adopted, ${r.existing} already imported · ` +
          `${r.attachedTotal} invoices attached` +
          (unmatched ? ` · ${unmatched} bill refs unmatched` : "") +
          (conflicts ? ` · ${conflicts} conflicts` : "")
      );
      await fetchPayments();
      onRefreshInvoices();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  // Decorated invoices by id — payment detail rows come from the API without
  // AF decoration, so look the fields up from the dashboard's invoice set.
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  // Invoice-side billing stats for the summary strip (non-void only).
  const nonVoid = invoices.filter((i) => i.status !== "void");
  const invoicedTotal = nonVoid.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const afUnbilledCount = nonVoid.filter((i) => i.af_bill_status === "unbilled").length;
  const afMismatchCount = nonVoid.filter((i) => i.af_bill_status === "mismatch").length;

  async function toggleExpand(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/payments/${id}`);
      const data = await res.json();
      if (res.ok) setDetail(data.payment);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/payments/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConfirmDelete(null);
        setExpanded(null);
        setDetail(null);
        await fetchPayments();
        onRefreshInvoices();
      }
    } finally {
      setDeleting(null);
    }
  }

  // ── New reconciliation: reuse the invoice list with the reconcile action ──
  if (mode === "new") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("ledger")}
            className="text-charcoal-500 hover:text-charcoal-700 text-xs h-8"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to payments
          </Button>
          <span className="text-xs text-charcoal-400">
            Filter to the payment&rsquo;s period, select the invoices it covered, then
            &ldquo;Reconcile payment&rdquo;.
          </span>
        </div>
        <InvoiceList
          invoices={invoices}
          onRefresh={onRefreshInvoices}
          onEdit={onEdit}
          onReconcile={onReconcile}
          isLoading={isLoadingInvoices}
        />
      </div>
    );
  }

  // ── AppFolio billing check: every HDMS bill in AppFolio vs our invoices ──
  if (mode === "billing") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("ledger")}
            className="text-charcoal-500 hover:text-charcoal-700 text-xs h-8"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to payments
          </Button>
          <div className="flex items-center gap-2">
            {afSyncMessage && (
              <span className="text-[11px] text-charcoal-400">{afSyncMessage}</span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAfSync}
              disabled={afSyncing}
              className="text-xs h-8"
            >
              {afSyncing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Sync AppFolio bills
            </Button>
          </div>
        </div>
        <BillingView
          bills={afBills}
          invoices={invoices}
          onChanged={async () => {
            await fetchAfBills();
            onRefreshInvoices();
          }}
        />
      </div>
    );
  }

  // ── Ledger of recorded payments ──
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-charcoal-800">Recorded payments</h2>
          <p className="text-xs text-charcoal-400">
            Trust-account payments (ACH/check) reconciled to HDMS invoices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleImport}
            disabled={importing}
            title="Pull HDMS disbursements from the AppFolio check register and attach the invoices their bills covered"
            className="text-xs h-9"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Import from AppFolio
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("billing")}
            className="text-xs h-9"
          >
            <Receipt className="h-3.5 w-3.5 mr-1.5" />
            AppFolio billing
            {afSummary && afSummary.unmatched_count > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                {afSummary.unmatched_count}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCapture(true)}
            className="text-xs h-9"
          >
            <Wallet className="h-3.5 w-3.5 mr-1.5" />
            Capture ACH payment
          </Button>
          <Button
            size="sm"
            onClick={() => setMode("new")}
            className="bg-terra-500 hover:bg-terra-600 text-white text-xs h-9"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New reconciliation
          </Button>
        </div>
      </div>

      {importMessage && (
        <p className="text-[11px] text-charcoal-500 bg-charcoal-50/80 border border-sand-200 rounded-lg px-3 py-2">
          {importMessage}
        </p>
      )}

      {/* Billing check strip: our invoiced total vs what AppFolio has billed */}
      <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-[10px] text-charcoal-400 uppercase tracking-wider">Invoiced (HDMS)</p>
            <p className="text-sm font-semibold text-charcoal-900">{formatCurrency(invoicedTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] text-charcoal-400 uppercase tracking-wider">Billed in AppFolio</p>
            <p className="text-sm font-semibold text-charcoal-900">
              {afSummary ? formatCurrency(afSummary.billed_total) : "—"}
              {afSummary && (
                <span className="ml-1.5 text-[10px] font-normal text-charcoal-400">
                  {afSummary.bill_count} bills
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-charcoal-400 uppercase tracking-wider">Not billed in AF</p>
            <p className={`text-sm font-semibold ${afUnbilledCount > 0 ? "text-red-600" : "text-green-600"}`}>
              {afUnbilledCount} invoice{afUnbilledCount === 1 ? "" : "s"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-charcoal-400 uppercase tracking-wider">Amount mismatches</p>
            <p className={`text-sm font-semibold ${afMismatchCount > 0 ? "text-amber-600" : "text-green-600"}`}>
              {afMismatchCount}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-charcoal-400 uppercase tracking-wider">Unmatched AF bills</p>
            <p className={`text-sm font-semibold ${afSummary && afSummary.unmatched_count > 0 ? "text-amber-600" : "text-green-600"}`}>
              {afSummary ? afSummary.unmatched_count : "—"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {afSyncMessage && (
              <span className="text-[11px] text-charcoal-400">{afSyncMessage}</span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAfSync}
              disabled={afSyncing}
              className="text-xs h-8"
            >
              {afSyncing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Sync AppFolio bills
            </Button>
          </div>
        </div>
      </div>

      {showCapture && (
        <CapturePaymentModal
          onClose={() => setShowCapture(false)}
          onSaved={fetchPayments}
        />
      )}
      {editingPayment && (
        <CapturePaymentModal
          payment={editingPayment}
          onClose={() => setEditingPayment(null)}
          onSaved={() => {
            fetchPayments();
            onRefreshInvoices();
          }}
        />
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-charcoal-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Loading payments…</span>
        </div>
      ) : payments.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-12 text-center">
          <Wallet className="h-8 w-8 text-charcoal-300 mx-auto mb-3" />
          <p className="text-sm text-charcoal-500 mb-1">No payments recorded yet</p>
          <p className="text-xs text-charcoal-400">
            Record a reconciliation to match a trust-account ACH to your invoices.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-100/80 bg-charcoal-50/40">
                  <th className="w-8" />
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Date</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Payee</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Reference</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Inv.</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Labor</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Materials</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Appliances</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Billed</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Received</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Variance</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const amt = p.amount == null ? null : Number(p.amount);
                  const variance =
                    amt == null ? null : Math.round((amt - Number(p.invoice_total)) * 100) / 100;
                  const balanced = variance != null && Math.abs(variance) < 0.01;
                  const isOpen = expanded === p.id;
                  const isConfirming = confirmDelete === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr
                        className="border-b border-charcoal-50/80 hover:bg-charcoal-50/60 cursor-pointer"
                        onClick={() => toggleExpand(p.id)}
                      >
                        <td className="px-2 py-2.5 text-charcoal-400">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-medium text-charcoal-800 whitespace-nowrap">
                          {formatDate(p.paid_on)}
                          <span className="block text-[10px] text-charcoal-400 uppercase">{p.method}</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-charcoal-600 truncate max-w-[160px]">
                          {p.payee}
                          {p.source === "appfolio" && (
                            <span className="ml-1 text-[9px] text-terra-500 uppercase">AF</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-charcoal-600 truncate max-w-[140px]">
                          {p.reference || <span className="text-charcoal-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-charcoal-600">{p.invoice_count}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-blue-600">{formatCurrency(Number(p.labor_total))}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-amber-600">{formatCurrency(Number(p.materials_total))}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-terra-600">{formatCurrency(Number(p.appliance_total ?? 0))}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-medium text-charcoal-800">{formatCurrency(Number(p.invoice_total))}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-semibold text-charcoal-900">{formatCurrency(amt)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {amt == null ? (
                            <span className="text-[11px] text-charcoal-300">no amount</span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                                balanced ? "text-green-600" : "text-amber-600"
                              }`}
                            >
                              {balanced ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5" />
                              )}
                              {balanced ? "Balanced" : formatCurrency(variance)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          {isConfirming ? (
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => handleDelete(p.id)}
                                disabled={deleting === p.id}
                                className="text-[10px] text-red-600 hover:text-red-700 font-medium"
                              >
                                {deleting === p.id ? "…" : "Confirm"}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="text-[10px] text-charcoal-400 hover:text-charcoal-600"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setEditingPayment(p)}
                                title="Edit payment (date, amount, reference)"
                                className="text-charcoal-300 hover:text-terra-600 transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDelete(p.id)}
                                title="Unreconcile (delete payment, invoices revert to unpaid)"
                                className="text-charcoal-300 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-charcoal-50/40">
                          <td />
                          <td colSpan={11} className="px-3 py-3">
                            {detailLoading ? (
                              <div className="flex items-center text-charcoal-400 text-xs py-2">
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                                Loading invoices…
                              </div>
                            ) : detail && detail.id === p.id ? (
                              <div className="space-y-2">
                                {p.memo && (
                                  <p className="text-[11px] text-charcoal-500 italic">{p.memo}</p>
                                )}
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-charcoal-400">
                                      <th className="text-left font-medium py-1">Invoice</th>
                                      <th className="text-left font-medium py-1">Property</th>
                                      <th className="text-right font-medium py-1">Total</th>
                                      <th className="text-right font-medium py-1">AF billed</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.invoices.map((inv) => {
                                      const dec = invoiceById.get(inv.id);
                                      return (
                                        <tr key={inv.id} className="border-t border-charcoal-100/60">
                                          <td className="py-1 font-mono text-charcoal-700">{inv.invoice_code}</td>
                                          <td className="py-1 text-charcoal-600 truncate max-w-[220px]">{inv.property_name}</td>
                                          <td className="py-1 text-right text-charcoal-800">{formatCurrency(inv.total_amount)}</td>
                                          <td className="py-1 text-right">
                                            {dec?.af_bill_status === "match" && (
                                              <span className="text-green-600">{formatCurrency(dec.af_billed_total ?? 0)} ✓</span>
                                            )}
                                            {dec?.af_bill_status === "mismatch" && (
                                              <span className="text-amber-600">{formatCurrency(dec.af_billed_total ?? 0)}</span>
                                            )}
                                            {dec?.af_bill_status === "unbilled" && (
                                              <span className="text-red-500">not billed</span>
                                            )}
                                            {(!dec || !dec.af_bill_status) && (
                                              <span className="text-charcoal-300">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-charcoal-400 py-2">No linked invoices found.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// AppFolio billing check view
// ============================================

type BillingFilter = "all" | "unmatched" | "mismatched";

function BillingView({
  bills,
  invoices,
  onChanged,
}: {
  bills: AfBillWithInvoice[];
  invoices: HdmsInvoice[];
  onChanged: () => Promise<void> | void;
}) {
  const [filter, setFilter] = useState<BillingFilter>("all");
  const [matching, setMatching] = useState<string | null>(null); // bill id with picker open
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Amount agreement is judged per INVOICE (a match can span multiple bills,
  // e.g. 40844-1 + 40844-2), so read the decorated status off the invoice.
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const isMismatch = (b: AfBillWithInvoice) =>
    !!b.hdms_invoice_id && invoiceById.get(b.hdms_invoice_id)?.af_bill_status === "mismatch";

  const filtered = bills.filter((b) => {
    if (filter === "unmatched") return !b.hdms_invoice_id;
    if (filter === "mismatched") return isMismatch(b);
    return true;
  });

  const counts = {
    all: bills.length,
    unmatched: bills.filter((b) => !b.hdms_invoice_id).length,
    mismatched: bills.filter(isMismatch).length,
  };

  async function handleMatch(billId: string, invoiceId: string) {
    setBusy(billId);
    try {
      const res = await fetch(`/api/af-bills/${billId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      if (res.ok) {
        setMatching(null);
        setSearch("");
        await onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleUnmatch(billId: string) {
    setBusy(billId);
    try {
      const res = await fetch(`/api/af-bills/${billId}/match`, { method: "DELETE" });
      if (res.ok) await onChanged();
    } finally {
      setBusy(null);
    }
  }

  // Candidate invoices for the manual-match picker: non-void, filtered by the
  // search text, exact-amount matches first.
  function candidates(bill: AfBillWithInvoice): HdmsInvoice[] {
    const q = search.trim().toLowerCase();
    return invoices
      .filter((i) => i.status !== "void")
      .filter(
        (i) =>
          !q ||
          i.invoice_code.toLowerCase().includes(q) ||
          (i.wo_reference || "").toLowerCase().includes(q) ||
          i.property_name.toLowerCase().includes(q) ||
          String(i.total_amount).includes(q)
      )
      .sort((a, b) => {
        const aExact = Math.abs(Number(a.total_amount) - Number(bill.total_amount)) < 0.005 ? 0 : 1;
        const bExact = Math.abs(Number(b.total_amount) - Number(bill.total_amount)) < 0.005 ? 0 : 1;
        return aExact - bExact || b.invoice_number - a.invoice_number;
      })
      .slice(0, 8);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-charcoal-800">AppFolio bills (HDMS)</h2>
          <p className="text-xs text-charcoal-400">
            Every bill entered in AppFolio for HDMS, matched to its internal invoice.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(["all", "unmatched", "mismatched"] as BillingFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                filter === f
                  ? "bg-terra-500 text-white"
                  : "bg-charcoal-100/60 text-charcoal-500 hover:bg-charcoal-200/60"
              }`}
            >
              {f === "all" ? "All" : f === "unmatched" ? "Unmatched" : "Mismatched"} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-12 text-center">
          <Receipt className="h-8 w-8 text-charcoal-300 mx-auto mb-3" />
          <p className="text-sm text-charcoal-500 mb-1">No AppFolio bills synced yet</p>
          <p className="text-xs text-charcoal-400">
            Run &ldquo;Sync AppFolio bills&rdquo; to pull the HDMS vendor bills.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-100/80 bg-charcoal-50/40">
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Date</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Reference</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Description</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Bill amount</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Invoice</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Invoice amount</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const mismatch = isMismatch(b);
                  const isPicking = matching === b.id;
                  return (
                    <React.Fragment key={b.id}>
                      <tr className="border-b border-charcoal-50/80 hover:bg-charcoal-50/60">
                        <td className="px-3 py-2.5 text-xs text-charcoal-800 whitespace-nowrap">
                          {formatDate(b.invoice_date)}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-mono text-charcoal-600">
                          {b.reference || <span className="text-charcoal-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-charcoal-500 truncate max-w-[220px]">
                          {b.description || <span className="text-charcoal-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-semibold text-charcoal-900">
                          {formatCurrency(Number(b.total_amount))}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {b.invoice ? (
                            <span className="font-mono text-charcoal-700">
                              {b.invoice.invoice_code}
                              {b.match_method === "manual" && (
                                <span className="ml-1 text-[9px] text-terra-500 uppercase">manual</span>
                              )}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-600 font-medium text-[11px]">
                              <AlertTriangle className="h-3 w-3" />
                              Unmatched
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs">
                          {b.invoice ? (
                            <span className={mismatch ? "text-amber-600 font-medium" : "text-green-600"}>
                              {formatCurrency(Number(b.invoice.total_amount))}
                              {!mismatch && " ✓"}
                            </span>
                          ) : (
                            <span className="text-charcoal-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">
                          {b.invoice ? (
                            <button
                              onClick={() => handleUnmatch(b.id)}
                              disabled={busy === b.id}
                              title="Unmatch this bill from its invoice"
                              className="inline-flex items-center gap-1 text-[10px] text-charcoal-300 hover:text-red-600 transition-colors"
                            >
                              <Unlink className="h-3 w-3" />
                              {busy === b.id ? "…" : "Unmatch"}
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setMatching(isPicking ? null : b.id);
                                setSearch("");
                              }}
                              className="inline-flex items-center gap-1 text-[10px] text-terra-600 hover:text-terra-700 font-medium"
                            >
                              <Link2 className="h-3 w-3" />
                              Match…
                            </button>
                          )}
                        </td>
                      </tr>
                      {isPicking && (
                        <tr className="bg-charcoal-50/40">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="space-y-2 max-w-xl">
                              <input
                                autoFocus
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search invoices by code, WO#, property, or amount…"
                                className="w-full text-xs px-3 py-2 rounded-lg border border-sand-300 focus:outline-none focus:ring-1 focus:ring-terra-400"
                              />
                              <div className="divide-y divide-charcoal-100/60 rounded-lg border border-sand-200 bg-white">
                                {candidates(b).map((inv) => {
                                  const exact =
                                    Math.abs(Number(inv.total_amount) - Number(b.total_amount)) < 0.005;
                                  return (
                                    <button
                                      key={inv.id}
                                      onClick={() => handleMatch(b.id, inv.id)}
                                      disabled={busy === b.id}
                                      className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-terra-50 transition-colors text-left"
                                    >
                                      <span className="flex items-center gap-2 min-w-0">
                                        <span className="font-mono text-charcoal-700 shrink-0">{inv.invoice_code}</span>
                                        {inv.wo_reference && (
                                          <span className="text-[10px] text-charcoal-400 font-mono shrink-0">
                                            WO#{inv.wo_reference}
                                          </span>
                                        )}
                                        <span className="text-charcoal-500 truncate">{inv.property_name}</span>
                                      </span>
                                      <span className={`shrink-0 ml-3 font-medium ${exact ? "text-green-600" : "text-charcoal-700"}`}>
                                        {formatCurrency(inv.total_amount)}
                                        {exact && " ✓"}
                                      </span>
                                    </button>
                                  );
                                })}
                                {candidates(b).length === 0 && (
                                  <p className="px-3 py-2 text-xs text-charcoal-400">No matching invoices.</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
