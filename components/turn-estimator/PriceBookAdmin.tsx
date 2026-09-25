"use client";

import { Fragment, useMemo, useState } from "react";
import { PRICING_LABELS, needsPriceReview, priceBookName, priceBookRate } from "@/lib/turn-estimator/price-book-display";
import { PRICING_METHODS, withReviewTag } from "@/lib/turn-estimator/price-book-input";
import type { PriceBookItem, PricingMethod } from "@/lib/turn-estimator/types";

/**
 * Price book admin: every line is fully editable (name, descriptions,
 * category, how it's charged, prices, minutes, markup, GL, trade, flags).
 * Saving writes a new version effective today — issued estimates keep the
 * price they were built with.
 */
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
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const pendingCount = items.filter(needsPriceReview).length;
  const q = search.trim().toLowerCase();
  const visibleItems = items.filter(
    (item) =>
      showPending === needsPriceReview(item) &&
      (category === "all" || item.category === category) &&
      (!q ||
        priceBookName(item).toLowerCase().includes(q) ||
        item.item_code.toLowerCase().includes(q) ||
        (item.owner_description ?? "").toLowerCase().includes(q))
  );
  const cols = isAdmin ? 5 : 4;

  async function refresh() {
    const res = await fetch("/api/turn-estimator/price-book");
    if (res.ok) setItems((await res.json()).items as PriceBookItem[]);
  }

  async function save(it: PriceBookItem, body: Record<string, unknown>) {
    setBusy(it.item_code);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/turn-estimator/price-book/${encodeURIComponent(it.item_code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await refresh();
      setEditing(null);
      setNotice(`Saved ${String(body.name).replace(/\s*\[PLACEHOLDER\]/i, "")}. New estimates use it from today; issued estimates keep their prices.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(null);
    }
  }

  async function retire(it: PriceBookItem) {
    if (!window.confirm(`Retire ${priceBookName(it)}? It stays on past estimates but won't be selectable.`)) return;
    setBusy(it.item_code);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/turn-estimator/price-book/${encodeURIComponent(it.item_code)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await refresh();
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "retire failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">{notice}</div>}

      {isAdmin && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              setAdding((v) => !v);
              setEditing(null);
            }}
            className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-charcoal-800"
          >
            {adding ? "Close" : "+ Add item"}
          </button>
          {adding && (
            <div className="mt-3 rounded-xl border border-sand-200 bg-sand-50 p-3">
              <ItemEditor
                mode="create"
                categories={categories}
                busy={busy === "__new__"}
                onCancel={() => setAdding(false)}
                onSubmit={async (body) => {
                  setBusy("__new__");
                  setError(null);
                  try {
                    const res = await fetch("/api/turn-estimator/price-book", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });
                    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
                    setAdding(false);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "add failed");
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={!showPending} onClick={() => setShowPending(false)} className={`rounded-lg border px-3 py-2 text-sm ${!showPending ? "bg-charcoal-900 text-white" : "bg-white"}`}>
          Current prices ({items.length - pendingCount})
        </button>
        <button type="button" aria-pressed={showPending} onClick={() => setShowPending(true)} className={`rounded-lg border px-3 py-2 text-sm ${showPending ? "bg-charcoal-900 text-white" : "bg-white"}`}>
          Needs pricing review ({pendingCount})
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items"
          className="ml-auto rounded-lg border border-sand-200 px-3 py-2 text-sm"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-sand-200 bg-white px-2 py-2 text-sm">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      {showPending && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          These items have unfinished prices and are not ready for estimates. Edit one and uncheck &ldquo;Needs pricing review&rdquo; once its price is final.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs text-charcoal-500">
            <tr>
              <th className="px-3 py-2">Service or item</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">How it is charged</th>
              <th className="px-3 py-2">Price</th>
              {isAdmin && <th className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {visibleItems.map((it) => (
              <Fragment key={it.id}>
                <tr className={editing === it.item_code ? "bg-sand-50" : undefined}>
                  <td className="px-3 py-2 text-charcoal-800">
                    {priceBookName(it)}
                    <span className="ml-1.5 whitespace-nowrap text-[11px] text-charcoal-400">{it.item_code}</span>
                    {it.owner_description && <p className="mt-1 text-xs text-charcoal-500">{it.owner_description}</p>}
                  </td>
                  <td className="px-3 py-2 text-charcoal-600">{it.category}</td>
                  <td className="px-3 py-2 text-charcoal-600">{PRICING_LABELS[it.pricing_method]}</td>
                  <td className="px-3 py-2 font-medium text-charcoal-900">{needsPriceReview(it) ? "Not ready to quote" : priceBookRate(it)}</td>
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy === it.item_code}
                          onClick={() => {
                            setEditing((c) => (c === it.item_code ? null : it.item_code));
                            setAdding(false);
                          }}
                          className="rounded-md border border-sand-200 px-2 py-0.5 text-xs text-charcoal-700 hover:bg-sand-50 disabled:opacity-50"
                        >
                          {editing === it.item_code ? "Close" : "Edit"}
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
                {isAdmin && editing === it.item_code && (
                  <tr className="bg-sand-50">
                    <td colSpan={cols} className="px-3 pb-4 pt-1">
                      <ItemEditor
                        mode="edit"
                        item={it}
                        categories={categories}
                        busy={busy === it.item_code}
                        onCancel={() => setEditing(null)}
                        onSubmit={(body) => save(it, body)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-3 py-6 text-center text-charcoal-400">
                  {q || category !== "all"
                    ? "No items match."
                    : showPending
                      ? "No items need pricing review."
                      : "No current prices. Add an item to get started."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Form = {
  item_code: string;
  name: string;
  category: string;
  owner_description: string;
  internal_instructions: string;
  pricing_method: PricingMethod;
  base_price: string;
  uom: string;
  included_minutes: string;
  increment_minutes: string;
  increment_price: string;
  standard_minutes: string;
  markup_pct: string;
  gl_code: string;
  skill_trade: string;
  tenant_alloc_eligible: boolean;
  needs_review: boolean;
};

const str = (v: number | string | null | undefined) => (v == null ? "" : String(v));

function formFrom(it?: PriceBookItem): Form {
  return {
    item_code: it?.item_code ?? "",
    name: it ? priceBookName(it) : "",
    category: it?.category ?? "handyman",
    owner_description: it?.owner_description ?? "",
    internal_instructions: it?.internal_instructions ?? "",
    pricing_method: it?.pricing_method ?? "flat",
    base_price: str(it?.base_price ?? 0),
    uom: it?.uom ?? "each",
    included_minutes: str(it?.included_minutes),
    increment_minutes: str(it?.increment_minutes),
    increment_price: str(it?.increment_price),
    standard_minutes: str(it?.standard_minutes),
    markup_pct: str(it?.markup_pct),
    gl_code: it?.gl_code ?? "",
    skill_trade: it?.skill_trade ?? "",
    tenant_alloc_eligible: it?.tenant_alloc_eligible ?? false,
    needs_review: it ? needsPriceReview(it) : false,
  };
}

const PRICE_LABEL: Record<PricingMethod, string> = {
  flat: "Price",
  hourly: "Rate per hour",
  service_min: "Minimum charge",
  package: "Package price",
  per_qty: "Price per unit",
  cost_plus: "Base price (usually 0)",
  quoted: "Starting price",
  allowance: "Allowance amount",
};

/** One form for create and edit — every price-book field. */
function ItemEditor({
  mode,
  item,
  categories,
  busy,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  item?: PriceBookItem;
  categories: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void | Promise<void>;
}) {
  const initial = useMemo(() => formFrom(item), [item]);
  const [f, setF] = useState<Form>(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = <K extends keyof Form>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const submit = () => {
    const nOrNull = (s: string) => (s.trim() === "" ? null : s.trim());
    onSubmit({
      ...(mode === "create" ? { item_code: f.item_code.trim() } : {}),
      name: withReviewTag(f.name, f.needs_review),
      category: f.category,
      owner_description: nOrNull(f.owner_description),
      internal_instructions: nOrNull(f.internal_instructions),
      pricing_method: f.pricing_method,
      base_price: f.base_price,
      uom: f.uom,
      included_minutes: nOrNull(f.included_minutes),
      increment_minutes: nOrNull(f.increment_minutes),
      increment_price: nOrNull(f.increment_price),
      standard_minutes: nOrNull(f.standard_minutes),
      markup_pct: nOrNull(f.markup_pct),
      markup_eligible: f.pricing_method === "cost_plus" || (item?.markup_eligible ?? false),
      gl_code: nOrNull(f.gl_code),
      skill_trade: nOrNull(f.skill_trade),
      tenant_alloc_eligible: f.tenant_alloc_eligible,
      ...(item?.market ? { market: item.market } : {}),
    });
  };

  const input = "w-full rounded-lg border border-sand-200 bg-white px-2 py-1 text-sm";
  const label = "flex flex-col gap-1 text-xs text-charcoal-500";
  const m = f.pricing_method;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {mode === "create" && (
        <label className={label}>
          Internal reference (unique, can&apos;t change later)
          <input className={input} value={f.item_code} onChange={set("item_code")} placeholder="e.g. paint-room-std" />
        </label>
      )}
      <label className={`${label} col-span-2`}>
        Item name
        <input className={input} value={f.name} onChange={set("name")} />
      </label>
      <label className={label}>
        Category
        <input className={input} value={f.category} onChange={set("category")} list="price-book-categories" />
        <datalist id="price-book-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      {mode === "edit" && (
        <div className={label}>
          Internal reference
          <p className="py-1 text-sm text-charcoal-700">{item?.item_code}</p>
        </div>
      )}

      <label className={label}>
        How it is charged
        <select className={input} value={m} onChange={set("pricing_method")}>
          {PRICING_METHODS.map((pm) => (
            <option key={pm} value={pm}>{PRICING_LABELS[pm]}</option>
          ))}
        </select>
      </label>
      <label className={label}>
        {PRICE_LABEL[m]} ($)
        <input className={input} type="number" min={0} step="0.01" value={f.base_price} onChange={set("base_price")} />
      </label>
      <label className={label}>
        Charged per (unit)
        <input className={input} value={f.uom} onChange={set("uom")} placeholder="each, hour, room, sqft, load…" />
      </label>
      <label className={label}>
        Standard time (minutes)
        <input className={input} type="number" min={0} step="1" value={f.standard_minutes} onChange={set("standard_minutes")} placeholder="for estimating" />
      </label>

      {(m === "service_min" || m === "package") && (
        <label className={label}>
          Included minutes
          <input className={input} type="number" min={0} step="1" value={f.included_minutes} onChange={set("included_minutes")} />
        </label>
      )}
      {m === "service_min" && (
        <>
          <label className={label}>
            Additional block (minutes)
            <input className={input} type="number" min={1} step="1" value={f.increment_minutes} onChange={set("increment_minutes")} />
          </label>
          <label className={label}>
            Price per additional block ($)
            <input className={input} type="number" min={0} step="0.01" value={f.increment_price} onChange={set("increment_price")} />
          </label>
        </>
      )}
      {m === "cost_plus" && (
        <label className={label}>
          Markup (%)
          <input className={input} type="number" min={0} step="0.5" value={f.markup_pct} onChange={set("markup_pct")} />
        </label>
      )}

      <label className={label}>
        GL code
        <input className={input} value={f.gl_code} onChange={set("gl_code")} />
      </label>
      <label className={label}>
        Trade
        <input className={input} value={f.skill_trade} onChange={set("skill_trade")} placeholder="paint, plumbing…" />
      </label>

      <label className={`${label} col-span-2`}>
        Owner-facing description
        <textarea className={input} rows={2} value={f.owner_description} onChange={set("owner_description")} />
      </label>
      <label className={`${label} col-span-2`}>
        Internal instructions (staff only)
        <textarea className={input} rows={2} value={f.internal_instructions} onChange={set("internal_instructions")} />
      </label>

      <div className="col-span-2 flex flex-wrap items-center gap-4 text-sm text-charcoal-700 md:col-span-4">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={f.tenant_alloc_eligible} onChange={set("tenant_alloc_eligible")} />
          Can be charged to tenant
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={f.needs_review} onChange={set("needs_review")} />
          Needs pricing review (not ready to quote)
        </label>
        <div className="ml-auto flex items-center gap-2">
          {mode === "edit" && <span className="text-xs text-charcoal-400">Saves a new version from today; issued estimates keep their prices.</span>}
          <button type="button" onClick={onCancel} className="rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (mode === "edit" && !dirty)}
            onClick={submit}
            className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-charcoal-800 disabled:opacity-40"
          >
            {busy ? "Saving…" : mode === "create" ? "Create item" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
