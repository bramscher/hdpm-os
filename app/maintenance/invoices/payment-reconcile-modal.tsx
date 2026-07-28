"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HdmsInvoice } from "@/lib/invoices";
import type { Payment } from "@/lib/payments";
import { aggregate, chargedSplit } from "@/lib/invoice-analysis";

const DEFAULT_PAYEE = "High Desert Maintenance Services";

function formatCurrency(amount: number | null): string {
  if (amount == null) return "—";
  const n = typeof amount === "number" ? amount : parseFloat(String(amount)) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  // Parse YYYY-MM-DD as local so dates don't shift a day in negative-offset TZs.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function invoiceDate(inv: HdmsInvoice): string | null {
  return inv.completed_date || inv.created_at || null;
}

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

type Mode = "existing" | "new";

export function PaymentReconcileModal({
  invoices,
  onClose,
  onRecorded,
}: PaymentReconcileModalProps) {
  // Captured payments to reconcile against.
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [mode, setMode] = useState<Mode>("existing");
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>("");

  // New-payment form.
  const [payee, setPayee] = useState(DEFAULT_PAYEE);
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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/payments");
        const data = await res.json();
        if (res.ok) {
          const list: Payment[] = data.payments || [];
          setPayments(list);
          // Default: pick an existing payment if any exist, else the new-payment form.
          if (list.length > 0) {
            setMode("existing");
            setSelectedPaymentId(list[0].id);
          } else {
            setMode("new");
          }
        }
      } finally {
        setLoadingPayments(false);
      }
    })();
  }, []);

  // Charged split of the selected invoices (void excluded by aggregate()).
  const totals = useMemo(() => aggregate(invoices), [invoices]);
  const split = useMemo(() => chargedSplit(totals), [totals]);
  // Buckets must reconstruct the invoice totals exactly, or something is off
  // in the line items (e.g. a legacy invoice whose columns don't sum).
  const tieDiff =
    Math.round((split.total - (split.labor + split.materials + split.appliance + split.other)) * 100) /
    100;
  const tiesOut = Math.abs(tieDiff) < 0.01;
  const alreadyPaid = useMemo(() => invoices.filter((i) => i.payment_id), [invoices]);

  const selectedPayment = payments.find((p) => p.id === selectedPaymentId) || null;

  // Variance depends on mode:
  //  - existing: payment.amount − (already-linked billed + this selection)
  //  - new:      entered amount − this selection
  const parsedAmount = parseFloat(amount);
  const hasNewAmount = Number.isFinite(parsedAmount);

  const billedAfter =
    mode === "existing" && selectedPayment
      ? Number(selectedPayment.invoice_total) + split.total
      : split.total;
  const paymentAmount =
    mode === "existing"
      ? selectedPayment && selectedPayment.amount != null
        ? Number(selectedPayment.amount)
        : NaN
      : parsedAmount;
  const hasPaymentAmount = Number.isFinite(paymentAmount);
  const variance = hasPaymentAmount ? Math.round((paymentAmount - billedAfter) * 100) / 100 : 0;
  const balanced = hasPaymentAmount && Math.abs(variance) < 0.01;

  const canRecord =
    !saving &&
    invoices.length > 0 &&
    alreadyPaid.length === 0 &&
    (mode === "existing" ? !!selectedPayment : !!paidOn && hasNewAmount && !!payee.trim());

  async function handleRecord() {
    if (!canRecord) return;
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "existing" && selectedPayment) {
        res = await fetch(`/api/payments/${selectedPayment.id}/invoices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_ids: invoices.map((i) => i.id) }),
        });
      } else {
        res = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paid_on: paidOn,
            amount: parsedAmount,
            payee: payee.trim(),
            reference: reference.trim() || undefined,
            method,
            memo: memo.trim() || undefined,
            invoice_ids: invoices.map((i) => i.id),
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reconcile");
      onRecorded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reconcile");
      setSaving(false);
    }
  }

  const varianceLabel = !hasPaymentAmount
    ? mode === "existing"
      ? selectedPayment
        ? "Payment has no amount set"
        : "Pick a payment"
      : "Enter the payment amount"
    : balanced
    ? "Balanced"
    : variance > 0
    ? `${formatCurrency(variance)} left on payment`
    : `Over by ${formatCurrency(Math.abs(variance))}`;

  const liveCount = totals.count - totals.voidCount;

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
                {liveCount} invoice{liveCount !== 1 ? "s" : ""}
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
                selection first.
              </span>
            </div>
          )}

          {/* Apply-to toggle */}
          <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden">
            {(["existing", "new"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === m ? "bg-terra-500 text-white" : "bg-white text-charcoal-500 hover:text-charcoal-700"
                }`}
              >
                {m === "existing" ? "Existing payment" : "New payment"}
              </button>
            ))}
          </div>

          {/* Payment source */}
          {mode === "existing" ? (
            <div className="bg-white rounded-xl border border-sand-200 shadow-card p-4 space-y-3">
              {loadingPayments ? (
                <div className="flex items-center text-charcoal-400 text-xs">
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  Loading payments…
                </div>
              ) : payments.length === 0 ? (
                <p className="text-xs text-charcoal-500">
                  No captured payments yet — switch to <strong>New payment</strong>, or capture one
                  from the Reconcile page first.
                </p>
              ) : (
                <>
                  <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider">
                    Reconcile against
                  </label>
                  <select
                    value={selectedPaymentId}
                    onChange={(e) => setSelectedPaymentId(e.target.value)}
                    className="w-full h-10 rounded-md border border-sand-300 bg-white px-3 text-sm text-charcoal-800 focus:outline-none focus:ring-2 focus:ring-terra-300"
                  >
                    {payments.map((p) => {
                      const hasAmt = p.amount != null;
                      const remaining = hasAmt
                        ? Math.round((Number(p.amount) - Number(p.invoice_total)) * 100) / 100
                        : null;
                      return (
                        <option key={p.id} value={p.id}>
                          {formatDate(p.paid_on)} · {p.payee} ·{" "}
                          {hasAmt ? `${formatCurrency(p.amount)} · ${formatCurrency(remaining)} left` : "no amount set"}
                        </option>
                      );
                    })}
                  </select>
                  {selectedPayment && (
                    <div className="grid grid-cols-3 gap-3 text-xs pt-1">
                      <div>
                        <p className="text-charcoal-400">Payment</p>
                        <p className="font-semibold text-charcoal-800">{formatCurrency(selectedPayment.amount)}</p>
                      </div>
                      <div>
                        <p className="text-charcoal-400">Already applied</p>
                        <p className="font-semibold text-charcoal-800">{formatCurrency(Number(selectedPayment.invoice_total))}</p>
                      </div>
                      <div>
                        <p className="text-charcoal-400">This selection</p>
                        <p className="font-semibold text-charcoal-800">{formatCurrency(split.total)}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">Payee</label>
                <Input value={payee} onChange={(e) => setPayee(e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">Payment date</label>
                <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">Amount received</label>
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
                <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">Method</label>
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
                <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">Reference #</label>
                <Input placeholder="ACH / check reference" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">Memo</label>
                <Input
                  placeholder="e.g. Client Trust Account → HDMS, July batch"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Split cards for the selection */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Labor", value: split.labor, color: "text-blue-600" },
              { label: "Materials", value: split.materials, color: "text-amber-600" },
              { label: "Appliances", value: split.appliance, color: "text-terra-600" },
              { label: "Other", value: split.other, color: "text-charcoal-500" },
              { label: "This selection", value: split.total, color: "text-charcoal-900" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-sand-200 shadow-card p-4">
                <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">{c.label}</p>
                <p className={`text-xl font-bold ${c.color}`}>{formatCurrency(c.value)}</p>
              </div>
            ))}
          </div>

          {/* Tie-out: labor + materials + appliances + other must equal the selection total */}
          {liveCount === 0 ? null : tiesOut ? (
            <p className="flex items-center gap-1.5 text-[11px] text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Labor + Materials + Appliances + Other ties out to the selection total.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Line items are off by {formatCurrency(Math.abs(tieDiff))}{" "}
              {tieDiff > 0 ? "under" : "over"} the invoice totals — check the selected
              invoices&rsquo; line items before reconciling.
            </p>
          )}

          {/* Variance banner */}
          <div
            className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
              !hasPaymentAmount
                ? "border-sand-200 bg-charcoal-50/60"
                : balanced
                ? "border-green-200 bg-green-50"
                : variance > 0
                ? "border-blue-200 bg-blue-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-center gap-2">
              {balanced ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : hasPaymentAmount && variance < 0 ? (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              ) : null}
              <div>
                <p
                  className={`text-sm font-semibold ${
                    !hasPaymentAmount
                      ? "text-charcoal-500"
                      : balanced
                      ? "text-green-700"
                      : variance > 0
                      ? "text-blue-700"
                      : "text-amber-700"
                  }`}
                >
                  {varianceLabel}
                </p>
                {hasPaymentAmount && (
                  <p className="text-[11px] text-charcoal-500">
                    Payment {formatCurrency(paymentAmount)} − billed {formatCurrency(billedAfter)}
                    {mode === "existing" && selectedPayment && Number(selectedPayment.invoice_total) > 0
                      ? " (incl. already-applied)"
                      : ""}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Per-invoice list */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-sand-200">
              <span className="text-sm font-semibold text-charcoal-700">Invoices in this selection</span>
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
                        {inv.status === "void" && <span className="ml-1.5 text-[9px] text-red-500 uppercase">void</span>}
                        {inv.payment_id && <span className="ml-1.5 text-[9px] text-red-500 uppercase">paid</span>}
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
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
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
                Reconciling…
              </>
            ) : mode === "existing" ? (
              "Reconcile to payment"
            ) : (
              "Record payment"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
