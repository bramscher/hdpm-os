"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Kept in sync with DEFAULT_PAYEE in lib/payments.ts (inlined so this client
// component doesn't pull the server-only payments module into the bundle).
const DEFAULT_PAYEE = "High Desert Maintenance Services";

/** Today as YYYY-MM-DD, for the default payment date. */
function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface CapturePaymentModalProps {
  onClose: () => void;
  onCaptured: () => void;
}

export function CapturePaymentModal({ onClose, onCaptured }: CapturePaymentModalProps) {
  const [payee, setPayee] = useState(DEFAULT_PAYEE);
  const [paidOn, setPaidOn] = useState(todayInput());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("ach");
  const [reference, setReference] = useState("");
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

  const parsedAmount = parseFloat(amount);
  const canSave = !saving && !!paidOn && Number.isFinite(parsedAmount) && !!payee.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_on: paidOn,
          amount: parsedAmount,
          payee: payee.trim(),
          method,
          reference: reference.trim() || undefined,
          memo: memo.trim() || undefined,
          // no invoice_ids → captured "open"
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to capture payment");
      onCaptured();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture payment");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={saving ? undefined : onClose} />

      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-5 py-3 border-b border-charcoal-200/60 bg-charcoal-50/80">
          <div className="flex items-center gap-3">
            <Wallet className="h-5 w-5 text-terra-600" />
            <span className="font-semibold text-charcoal-900 text-sm">Capture ACH payment</span>
          </div>
          <button
            onClick={saving ? undefined : onClose}
            className="flex items-center justify-center h-8 w-8 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
              Payee
            </label>
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
                Payment date
              </label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
                Amount
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
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-charcoal-500 uppercase tracking-wider mb-1">
              Memo
            </label>
            <Input
              placeholder="e.g. Client Trust Account → HDMS, July batch"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-charcoal-200/60 bg-charcoal-50/80">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="text-xs h-9">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
            className="bg-terra-500 hover:bg-terra-600 text-white text-xs h-9 disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Capturing…
              </>
            ) : (
              "Capture payment"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
