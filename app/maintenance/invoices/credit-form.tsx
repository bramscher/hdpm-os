"use client";

import React, { useMemo, useState } from "react";
import { X, Loader2, FileMinus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeCreditItems, creditItemsForInvoice, creditBalancePreview } from "@/lib/invoice-credit";
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
  const [items, setItems] = useState([{ id: "initial", description: "", type: "other" as LineItemType, amount: "" }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only real invoices can be corrected (not other credits).
  const linkable = useMemo(
    () => invoices.filter((i) => i.doc_type !== "credit"),
    [invoices]
  );

  const amount = items.reduce((sum, item) => {
    const value = Number(item.amount);
    return sum + (Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0);
  }, 0) / 100;
  const linkedInvoice = linkable.find(invoice => invoice.id === linkedId);
  const balance = linkedInvoice ? creditBalancePreview(linkedInvoice, invoices, amount) : null;
  const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

  function updateItem(id: string, patch: Partial<(typeof items)[number]>) {
    setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function onPickLinked(id: string) {
    setLinkedId(id);
    const inv = linkable.find((i) => i.id === id);
    if (inv) {
      setPropertyName(inv.property_name);
      setPropertyAddress(inv.property_address);
      // Default to a full reversal; trim the amount for a partial over-bill credit.
      setItems(creditItemsForInvoice(inv).map(item => ({ id: crypto.randomUUID(), description: item.description, type: item.type!, amount: String(item.amount) })));
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
    let credit: ReturnType<typeof normalizeCreditItems>;
    try { credit = normalizeCreditItems(items.map(({description, type, amount}) => ({description, type, amount: Number(amount)}))); }
    catch (e) { setError((e as Error).message); return; }

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
          total_amount: credit.total_amount,
          labor_amount: credit.labor_amount,
          materials_amount: credit.materials_amount,
          line_items: credit.line_items,
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
      <div role="dialog" aria-modal="true" aria-labelledby="credit-title" className="relative w-full max-w-2xl max-h-[90dvh] mx-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-sand-200">
          <div className="flex items-center gap-2">
            <FileMinus className="h-4 w-4 text-red-600" />
            <h2 id="credit-title" className="text-sm font-semibold text-charcoal-800">New credit memo</h2>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close credit memo"
            className="flex items-center justify-center h-8 w-8 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Credit details">
        <fieldset disabled={saving} onChange={() => setError(null)} className="min-w-0 p-5 space-y-4">
          <p className="text-xs text-charcoal-500">
            A credit offsets an invoice that was over-billed or submitted in duplicate. It
            generates a PDF (upload it to AppFolio as a credit) and nets against invoices in
            reconciliation.
          </p>

          <div>
            <label className="block text-xs font-medium text-charcoal-600 mb-1">
              Correcting invoice <span className="text-charcoal-400">(optional)</span>
            </label>
            <select aria-label="Correcting invoice" className={inputClass} value={linkedId} onChange={(e) => onPickLinked(e.target.value)}>
              <option value="">Standalone credit (no linked invoice)</option>
              {linkable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_code} — {i.property_name} (${Math.abs(Number(i.total_amount) || 0).toFixed(2)})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-charcoal-500">Selecting an invoice replaces the items with a full credit. Adjust or remove items for a partial credit.</p>
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

          <section aria-label="Credit items" className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Credit items</h3><Button type="button" variant="outline" size="sm" onClick={() => setItems(current => [...current, {id: crypto.randomUUID(), description: "", type: "other", amount: ""}])}><Plus className="mr-1 h-4 w-4"/>Add credit item</Button></div>
            <p className="text-xs text-charcoal-500">Enter positive amounts. Labor, materials, appliances, and other items combine into one credit memo.</p>
            {items.map((item, index) => <div key={item.id} className="rounded-xl border border-sand-200 bg-charcoal-50/50 p-3 space-y-3">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold">Item {index + 1}</span><button type="button" disabled={items.length === 1} aria-label={`Remove credit item ${index + 1}`} className="p-2 text-red-700 disabled:opacity-30" onClick={() => { setError(null); setItems(current => current.filter(row => row.id !== item.id)); }}><Trash2 className="h-4 w-4"/></button></div>
              <label className="block text-xs font-medium text-charcoal-600">Item description<Input aria-label={`Credit item ${index + 1} description`} value={item.description} onChange={e => updateItem(item.id, {description:e.target.value})} placeholder="Labor overcharge / returned materials" className="mt-1"/></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-charcoal-600">Applies to<select aria-label={`Credit item ${index + 1} type`} className={`${inputClass} mt-1`} value={item.type} onChange={e => updateItem(item.id, {type:e.target.value as LineItemType})}>{BUCKETS.map(bucket => <option value={bucket.value} key={bucket.value}>{bucket.label}</option>)}</select></label>
                <label className="block text-xs font-medium text-charcoal-600">Credit amount<Input aria-label={`Credit item ${index + 1} amount`} className="mt-1" type="number" min="0.01" step="0.01" value={item.amount} onChange={e => updateItem(item.id, {amount:e.target.value})} placeholder="0.00"/></label>
              </div>
            </div>)}
          </section>

          <div>
            <label className="block text-xs font-medium text-charcoal-600 mb-1">
              Internal notes <span className="text-charcoal-400">(optional)</span>
            </label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Not shown on the PDF" />
          </div>

        </fieldset>
        </div>

        {/* Keep totals, errors, and actions outside the scrolling item list. */}
        <div className="shrink-0 px-5 py-3 border-t border-charcoal-200/60 bg-white space-y-3">
          <div aria-label="Credit summary" aria-live="polite" className="rounded-xl border border-sand-200 bg-charcoal-50 px-4 py-3 space-y-1 text-sm">
            {balance && <div className="flex justify-between gap-3"><span>Original invoice</span><span>{money(balance.original)}</span></div>}
            {balance && balance.existingCredits > 0 && <div className="flex justify-between gap-3"><span>Existing credits</span><span>−{money(balance.existingCredits)}</span></div>}
            <div className="flex justify-between gap-3 font-semibold text-red-700"><span>Credit total</span><span>−{money(amount)}</span></div>
            {balance && <>
              <div className="flex justify-between gap-3 border-t border-sand-200 pt-1 font-semibold"><span>New net invoice amount</span><span>{money(balance.net)}</span></div>
              <p className="text-xs text-charcoal-500">After linked credits; payments are not included.</p>
              {balance.net < 0 && <p className="text-xs text-amber-800">This credit exceeds the remaining invoice amount.</p>}
            </>}
          </div>
          {error && <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="text-xs h-9">
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={saving} className="text-xs h-9">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create credit"}
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
