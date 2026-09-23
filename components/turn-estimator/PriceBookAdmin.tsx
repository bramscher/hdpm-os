"use client";

import { useState } from "react";
import { PRICING_LABELS, needsPriceReview, priceBookName, priceBookRate } from "@/lib/turn-estimator/price-book-display";
import type { PriceBookItem, PricingMethod } from "@/lib/turn-estimator/types";

const METHODS: PricingMethod[] = [
  "flat",
  "hourly",
  "service_min",
  "package",
  "per_qty",
  "cost_plus",
  "quoted",
  "allowance",
];

export default function PriceBookAdmin({
  initialItems,
  isAdmin,
}: {
  initialItems: PriceBookItem[];
  isAdmin: boolean;
}) {
  const [items, setItems] = useState<PriceBookItem[]>(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const pendingCount = items.filter(needsPriceReview).length;
  const visibleItems = items.filter(item => showPending === needsPriceReview(item));

  async function refresh() {
    const res = await fetch("/api/turn-estimator/price-book");
    if (res.ok) setItems((await res.json()).items as PriceBookItem[]);
  }

  async function reprice(it: PriceBookItem) {
    const raw = window.prompt(`New price for ${priceBookName(it)} — ${priceBookRate(it)}`, String(it.base_price));
    if (raw == null) return;
    const base_price = Number(raw);
    if (Number.isNaN(base_price)) {
      setError("price must be a number");
      return;
    }
    setBusy(it.item_code);
    setError(null);
    try {
      const res = await fetch(`/api/turn-estimator/price-book/${encodeURIComponent(it.item_code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: it.category,
          name: it.name,
          owner_description: it.owner_description,
          pricing_method: it.pricing_method,
          base_price,
          included_minutes: it.included_minutes,
          increment_minutes: it.increment_minutes,
          increment_price: it.increment_price,
          standard_minutes: it.standard_minutes,
          uom: it.uom,
          markup_pct: it.markup_pct,
          markup_eligible: it.markup_eligible,
          tenant_alloc_eligible: it.tenant_alloc_eligible,
          gl_code: it.gl_code,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "reprice failed");
    } finally {
      setBusy(null);
    }
  }

  async function retire(it: PriceBookItem) {
    if (!window.confirm(`Retire ${priceBookName(it)}? It stays on past estimates but won't be selectable.`))
      return;
    setBusy(it.item_code);
    setError(null);
    try {
      const res = await fetch(`/api/turn-estimator/price-book/${encodeURIComponent(it.item_code)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "retire failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {isAdmin && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-charcoal-800"
          >
            {adding ? "Close" : "+ Add item"}
          </button>
          {adding && <AddItemForm onDone={async () => { setAdding(false); await refresh(); }} onError={setError} />}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={!showPending} onClick={() => setShowPending(false)} className={`rounded-lg border px-3 py-2 text-sm ${!showPending ? 'bg-charcoal-900 text-white' : 'bg-white'}`}>Current prices ({items.length - pendingCount})</button>
        <button type="button" aria-pressed={showPending} onClick={() => setShowPending(true)} className={`rounded-lg border px-3 py-2 text-sm ${showPending ? 'bg-charcoal-900 text-white' : 'bg-white'}`}>Needs pricing review ({pendingCount})</button>
      </div>
      {showPending && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">These items have unfinished prices and are not ready for estimates. Their saved amounts are provisional and need review before use.</p>}
      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs text-charcoal-500">
            <tr>
              <th className="px-3 py-2">Service or item</th>
              <th className="px-3 py-2">How it is charged</th>
              <th className="px-3 py-2">Price</th>
              {isAdmin && <th className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {visibleItems.map((it) => (
              <tr key={it.id}>
                <td className="px-3 py-2 text-charcoal-800">{priceBookName(it)}{it.owner_description && <p className="mt-1 text-xs text-charcoal-500">{it.owner_description}</p>}</td>
                <td className="px-3 py-2 text-charcoal-600">{PRICING_LABELS[it.pricing_method]}</td>
                <td className="px-3 py-2 font-medium text-charcoal-900">{needsPriceReview(it) ? "Not ready to quote" : priceBookRate(it)}</td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy === it.item_code}
                        onClick={() => reprice(it)}
                        className="rounded-md border border-sand-200 px-2 py-0.5 text-xs text-charcoal-700 hover:bg-sand-50 disabled:opacity-50"
                      >
                        Update price
                      </button>
                      <button
                        type="button"
                        disabled={busy === it.item_code}
                        onClick={() => retire(it)}
                        className="rounded-md border border-sand-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Retire
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 4 : 3} className="px-3 py-6 text-center text-charcoal-400">
                  {showPending ? "No items need pricing review." : "No current prices. Add an item to get started."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddItemForm({
  onDone,
  onError,
}: {
  onDone: () => void | Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [f, setF] = useState({
    item_code: "",
    name: "",
    category: "handyman",
    pricing_method: "flat" as PricingMethod,
    base_price: "0",
    uom: "each",
    included_minutes: "",
    increment_minutes: "",
    increment_price: "",
    markup_pct: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit() {
    if (!f.item_code || !f.name) {
      onError("An internal reference and item name are required");
      return;
    }
    setSaving(true);
    onError(null);
    try {
      const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
      const res = await fetch("/api/turn-estimator/price-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_code: f.item_code.trim(),
          name: f.name.trim(),
          category: f.category.trim(),
          pricing_method: f.pricing_method,
          base_price: Number(f.base_price) || 0,
          uom: f.uom.trim() || "each",
          included_minutes: numOrNull(f.included_minutes),
          increment_minutes: numOrNull(f.increment_minutes),
          increment_price: numOrNull(f.increment_price),
          markup_pct: numOrNull(f.markup_pct),
          markup_eligible: f.pricing_method === "cost_plus",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "add failed");
    } finally {
      setSaving(false);
    }
  }

  const input = "rounded-lg border border-sand-200 px-2 py-1 text-sm";
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-sand-200 bg-sand-50 p-3 md:grid-cols-3">
      <input className={input} placeholder="Internal reference — unique item identifier" value={f.item_code} onChange={set("item_code")} />
      <input className={input} placeholder="Item name" value={f.name} onChange={set("name")} />
      <input className={input} placeholder="Category" value={f.category} onChange={set("category")} />
      <select className={input} value={f.pricing_method} onChange={set("pricing_method")}>
        {METHODS.map((m) => (
          <option key={m} value={m}>{PRICING_LABELS[m]}</option>
        ))}
      </select>
      <input className={input} placeholder="Base price in dollars" value={f.base_price} onChange={set("base_price")} />
      <input className={input} placeholder="Charge per: item, hour, room…" value={f.uom} onChange={set("uom")} />
      {f.pricing_method === "service_min" && (
        <>
          <input className={input} placeholder="included minutes" value={f.included_minutes} onChange={set("included_minutes")} />
          <input className={input} placeholder="Additional time block in minutes" value={f.increment_minutes} onChange={set("increment_minutes")} />
          <input className={input} placeholder="Price per additional time block" value={f.increment_price} onChange={set("increment_price")} />
        </>
      )}
      {f.pricing_method === "cost_plus" && (
        <input className={input} placeholder="markup %" value={f.markup_pct} onChange={set("markup_pct")} />
      )}
      <div className="col-span-2 md:col-span-3">
        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-charcoal-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Create item"}
        </button>
      </div>
    </div>
  );
}
