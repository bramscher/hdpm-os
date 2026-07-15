"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HdmsInvoice } from "@/lib/invoices";
import { aggregate, chargedSplit } from "@/lib/invoice-analysis";

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

function invoiceDate(inv: HdmsInvoice): string | null {
  return inv.completed_date || inv.created_at || null;
}

/** Today as YYYY-MM-DD, for the default payment date. */
function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface PaymentReconcileModalProps {
  invoices: HdmsInvoice[];
  onClose: () => void;
  onRecorded: () => void;
}

export function PaymentReconcileModal({
  invoices,
  onClose,
  onRecorded,
}: PaymentReconcileModalProps) {
  const [paidOn, setPaidOn] = useState(todayInput());
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("ach");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    },
    [onClose, saving]
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  // Live charged split (void invoices excluded by aggregate()).
  const split = useMemo(() => chargedSplit(aggregate(invoices)), [invoices]);
  const totals = useMemo(() => aggregate(invoices), [invoices]);

  // Invoices already reconciled to another payment block recording.
  const alreadyPaid = useMemo(() => invoices.filter((i) => i.payment_id), [invoices]);

  const parsedAmount = parseFloat(amount);
  const hasAmount = Number.isFinite(parsedAmount);
  const variance = hasAmount ? Math.round((parsedAmount - split.total) * 100) / 100 : 0;
  const balanced = hasAmount && Math.abs(variance) < 0.01;

  const canRecord =
    !saving && !!paidOn && hasAmount && invoices.length > 0 && alreadyPaid.length === 0;

  async function handleRecord() {
    if (!canRecord) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_on: paidOn,
          amount: parsedAmount,
          reference: reference.trim() || undefined,
          method,
          memo: memo.trim() || undefined,
          invoice_ids: invoices.map((i) => i.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record payment");
      onRecorded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
      setSaving(false);
    }
  }

  const varianceLabel = !hasAmount
    ? "Enter the payment amount"
    : balanced
    ? "Balanced"
    : variance > 0
    ? `Over by ${formatCurrency(variance)}`
    : `Short by ${formatCurrency(Math.abs(variance))}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={saving ? undefined : onClose} />

      <div className="relative w-full max-w-3xl h-[90vh] mx-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-charcoal-200/60 bg-charcoal-50/80">
          <div className="flex items-center gap-3">
            <Wallet className="h-5 w-5 text-terra-600" />
            <div>
              <span className="font-semibold text-charcoal-900 text-sm">Reconcile Payment</span>
              <span className="ml-2 text-xs text-charcoal-500">
                {totals.count - totals.voidCount} invoice
                {totals.count - totals.voidCount !== 1 ? "s" : ""}
                {totals.voidCount > 0 && ` · ${totals.voidCount} void excluded`}
              </span>
            </div>
          </div>
          <button
            onClick={saving ? undefined : onClose}
            className="flex items-center justify-center h-8 w-8 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {alreadyPaid.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {alreadyPaid.length} of these invoices are already reconciled to another payment
                ({alreadyPaid.map((i) => i.invoice_code).join(", ")}). Remove them from your
                selection before recording.
              </span>
            </div>
          )}

          {/* Payment form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
                Payment date
              </label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
                Amount received
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="18705.34"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
                Method
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full h-10 rounded-md border border-sand-300 bg-white px-3 text-sm text-charcoal-800 focus:outline-none focus:ring-2 focus:ring-terra-300"
              >
                <option value="ach">ACH</option>
                <option value="check">Check</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
                Reference #
              </label>
              <Input
                placeholder="ACH / check reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
                Memo
              </label>
              <Input
                placeholder="e.g. Client Trust Account → HDMS, July batch"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          {/* Split cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Labor", value: split.labor, color: "text-blue-600" },
              { label: "Materials", value: split.materials, color: "text-amber-600" },
              { label: "Other", value: split.other, color: "text-charcoal-500" },
              { label: "Total billed", value: split.total, color: "text-charcoal-900" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-sand-200 shadow-card p-4">
                <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">
                  {c.label}
                </p>
                <p className={`text-xl font-bold ${c.color}`}>{formatCurrency(c.value)}</p>
              </div>
            ))}
          </div>

          {/* Variance banner */}
          <div
            className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
              !hasAmount
                ? "border-sand-200 bg-charcoal-50/60"
                : balanced
                ? "border-green-200 bg-green-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-center gap-2">
              {balanced ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : hasAmount ? (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              ) : null}
              <div>
                <p
                  className={`text-sm font-semibold ${
                    !hasAmount ? "text-charcoal-500" : balanced ? "text-green-700" : "text-amber-700"
                  }`}
                >
                  {varianceLabel}
                </p>
                {hasAmount && (
                  <p className="text-[11px] text-charcoal-500">
                    Payment {formatCurrency(parsedAmount)} − billed {formatCurrency(split.total)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Per-invoice list */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-sand-200">
              <span className="text-sm font-semibold text-charcoal-700">Invoices in this payment</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-100/80">
                    <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Invoice</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Property</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-charcoal-50/80">
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-charcoal-700">{inv.invoice_code}</span>
                        {inv.status === "void" && (
                          <span className="ml-1.5 text-[9px] text-red-500 uppercase">void</span>
                        )}
                        {inv.payment_id && (
                          <span className="ml-1.5 text-[9px] text-red-500 uppercase">paid</span>
                        )}
                        <span className="block text-[10px] text-charcoal-400">{formatDate(invoiceDate(inv))}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal-600 truncate max-w-[200px]">{inv.property_name}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-charcoal-800">
                        {inv.status === "void" ? "—" : formatCurrency(inv.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-charcoal-200/60 bg-charcoal-50/80">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="text-xs h-9">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleRecord}
            disabled={!canRecord}
            className="bg-terra-500 hover:bg-terra-600 text-white text-xs h-9 disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Recording…
              </>
            ) : (
              "Record payment"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
