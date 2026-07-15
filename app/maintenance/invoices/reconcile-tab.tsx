"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Wallet,
  Plus,
  ArrowLeft,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HdmsInvoice } from "@/lib/invoices";
import type { Payment, PaymentWithInvoices } from "@/lib/payments";
import { InvoiceList } from "./invoice-list";
import { CapturePaymentModal } from "./capture-payment-modal";

function formatCurrency(amount: number): string {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount)) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
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
  const [mode, setMode] = useState<"ledger" | "new">("ledger");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentWithInvoices | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);

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

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments, reloadToken]);

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

      {showCapture && (
        <CapturePaymentModal
          onClose={() => setShowCapture(false)}
          onCaptured={fetchPayments}
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
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Billed</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Received</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Variance</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const variance = Math.round((Number(p.amount) - Number(p.invoice_total)) * 100) / 100;
                  const balanced = Math.abs(variance) < 0.01;
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
                        <td className="px-3 py-2.5 text-right text-xs font-medium text-charcoal-800">{formatCurrency(Number(p.invoice_total))}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-semibold text-charcoal-900">{formatCurrency(Number(p.amount))}</td>
                        <td className="px-3 py-2.5 text-right">
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
                            <button
                              onClick={() => setConfirmDelete(p.id)}
                              title="Unreconcile (delete payment, invoices revert to unpaid)"
                              className="text-charcoal-300 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-charcoal-50/40">
                          <td />
                          <td colSpan={10} className="px-3 py-3">
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
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.invoices.map((inv) => (
                                      <tr key={inv.id} className="border-t border-charcoal-100/60">
                                        <td className="py-1 font-mono text-charcoal-700">{inv.invoice_code}</td>
                                        <td className="py-1 text-charcoal-600 truncate max-w-[220px]">{inv.property_name}</td>
                                        <td className="py-1 text-right text-charcoal-800">{formatCurrency(inv.total_amount)}</td>
                                      </tr>
                                    ))}
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
