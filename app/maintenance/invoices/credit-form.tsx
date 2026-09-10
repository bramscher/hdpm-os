"use client";

import React, { useMemo, useState } from "react";
import { X, Loader2, FileMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HdmsInvoice, LineItemType } from "@/lib/invoices";

interface CreditFormProps {
  /** Existing invoices, used to optionally link a credit to the one it corrects. */
  invoices: HdmsInvoice[];
  onClose: () => void;
  onCreated: () => void;
}

const inputClass =
  "w-full h-10 rounded-md border border-sand-300 bg-white px-3 text-sm text-charcoal-800 focus:outline-none focus:ring-2 focus:ring-terra-300";

const BUCKETS: { value: LineItemType; label: string }[] = [
  { value: "other", label: "Other" },
  { value: "materials", label: "Materials" },
  { value: "appliance", label: "Appliance" },
  { value: "labor", label: "Labor" },
];

/**
 * Create a standalone credit memo (a negative-amount document). Optionally linked
 * to the invoice it corrects — picking one pre-fills the property + full amount,
 * which you can trim for a partial (over-bill) credit. Amounts are entered as
 * positive magnitudes; the server stores them negative so they net in reconcile.
 */
export function CreditForm({ invoices, onClose, onCreated }: CreditFormProps) {
  const [linkedId, setLinkedId] = useState<string>("");
  const [propertyName, setPropertyName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [type, setType] = useState<LineItemType>("other");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only real invoices can be corrected (not other credits).
  const linkable = useMemo(
    () => invoices.filter((i) => i.doc_type !== "credit"),
    [invoices]
  );

  const amount = parseFloat(amountStr) || 0;

  function onPickLinked(id: string) {
    setLinkedId(id);
    const inv = linkable.find((i) => i.id === id);
    if (inv) {
      setPropertyName(inv.property_name);
      setPropertyAddress(inv.property_address);
      // Default to a full reversal; trim the amount for a partial over-bill credit.
      setAmountStr(String(Math.abs(Number(inv.total_amount) || 0)));
      if (!description.trim()) {
        setDescription(`Credit for ${inv.invoice_code} — duplicate/over-bill correction`);
      }
    }
  }

  async function submit() {
    setError(null);
    if (!propertyName.trim() || !propertyAddress.trim()) {
      setError("Property name and address are required.");
      return;
    }
    if (!description.trim()) {
      setError("A description is required.");
      return;
    }
    if (!(amount > 0)) {
      setError("Enter a credit amount greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type: "credit",
          credits_invoice_id: linkedId || null,
          property_name: propertyName.trim(),
          property_address: propertyAddress.trim(),
          description: description.trim(),
          // Positive magnitudes — the server (createCredit) stores them negative.
          total_amount: amount,
          labor_amount: 0,
          materials_amount: 0,
          line_items: [{ description: description.trim(), type, amount }],
          internal_notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create credit");
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create credit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-charcoal-900/40" onClick={saving ? undefined : onClose} />
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sand-200">
          <div className="flex items-center gap-2">
            <FileMinus className="h-4 w-4 text-red-600" />
            <h2 className="text-sm font-semibold text-charcoal-800">New credit memo</h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-charcoal-500">
            A credit offsets an invoice that was over-billed or submitted in duplicate. It
            generates a PDF (upload it to AppFolio as a credit) and nets against invoices in
            reconciliation.
          </p>

          <div>
            <label className="block text-xs font-medium text-charcoal-600 mb-1">
              Correcting invoice <span className="text-charcoal-400">(optional)</span>
            </label>
            <select className={inputClass} value={linkedId} onChange={(e) => onPickLinked(e.target.value)}>
              <option value="">Standalone credit (no linked invoice)</option>
              {linkable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_code} — {i.property_name} (${Math.abs(Number(i.total_amount) || 0).toFixed(2)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-charcoal-600 mb-1">Property name</label>
              <Input value={propertyName} onChange={(e) => setPropertyName(e.target.value)} placeholder="Property name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal-600 mb-1">Property address</label>
              <Input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} placeholder="123 Main St, Redmond" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-charcoal-600 mb-1">Reason / description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Duplicate bill correction" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-charcoal-600 mb-1">Credit amount</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal-600 mb-1">Applies to</label>
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as LineItemType)}>
                {BUCKETS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-charcoal-600 mb-1">
              Internal notes <span className="text-charcoal-400">(optional)</span>
            </label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Not shown on the PDF" />
          </div>

          {amount > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <span className="text-xs font-medium text-red-700">Credit total</span>
              <span className="text-sm font-semibold text-red-700">-${amount.toFixed(2)}</span>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-charcoal-200/60 bg-charcoal-50/80">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="text-xs h-9">
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={saving} className="text-xs h-9">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create credit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
