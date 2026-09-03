"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PriceBookItem } from "@/lib/turn-estimator/types";

export interface BuilderSeed {
  property_name?: string;
  property_id?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  unit_turn_id?: string | null;
  wo_number?: string | null;
  wo_description?: string | null;
}

interface Row {
  key: string;
  item_code: string;
  qty: string;
  minutes: string;
  material_cost: string;
  room: string;
  description: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;
let seq = 0;
const newRow = (): Row => ({
  key: `r${seq++}`,
  item_code: "",
  qty: "1",
  minutes: "",
  material_cost: "",
  room: "",
  description: "",
});

export default function EstimateBuilder({ items, seed }: { items: PriceBookItem[]; seed: BuilderSeed }) {
  const itemByCode = useMemo(() => {
    const m = new Map<string, PriceBookItem>();
    for (const it of items) m.set(it.item_code, it);
    return m;
  }, [items]);

  const [propertyName, setPropertyName] = useState(seed.property_name ?? "");
  const [unitName, setUnitName] = useState(seed.unit_name ?? "");
  const [authLimit, setAuthLimit] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [preview, setPreview] = useState<{
    owner_total: number;
    authorization: "auto_approved" | "approval_pending";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Post-issue state
  const [issued, setIssued] = useState<null | {
    estimateId: string;
    versionId: string;
    ownerTotal: number;
    authorization: string;
    status: string;
    invoiceCode?: string;
  }>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const specForRow = (r: Row) => {
    const item = itemByCode.get(r.item_code);
    if (!item) return null;
    const spec: Record<string, unknown> = { item_code: r.item_code };
    if (r.qty) spec.qty = Number(r.qty);
    if (r.minutes) spec.minutes = Number(r.minutes);
    if (r.material_cost) spec.est_material_cost = Number(r.material_cost);
    if (r.room) spec.room = r.room;
    if (r.description) spec.description = r.description;
    return spec;
  };

  const validSpecs = useCallback(
    () => rows.map(specForRow).filter(Boolean) as Record<string, unknown>[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, itemByCode]
  );

  // Debounced live preview.
  useEffect(() => {
    if (issued) return;
    const specs = validSpecs();
    if (specs.length === 0) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/turn-estimator/estimates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: specs,
            authorization_limit: authLimit ? Number(authLimit) : null,
          }),
        });
        const data = await res.json();
        if (res.ok) setPreview({ owner_total: data.totals.owner_total, authorization: data.authorization });
      } catch {
        /* ignore preview errors */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [rows, authLimit, issued, validSpecs]);

  function setRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function issue() {
    setError(null);
    const specs = validSpecs();
    if (!propertyName.trim()) return setError("Property name is required");
    if (specs.length === 0) return setError("Add at least one line item");
    setBusy("issue");
    try {
      // 1. Create the estimate header.
      const createRes = await fetch("/api/turn-estimator/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: propertyName.trim(),
          property_id: seed.property_id ?? null,
          unit_id: seed.unit_id ?? null,
          unit_name: unitName.trim() || null,
          unit_turn_id: seed.unit_turn_id ?? null,
          authorization_limit: authLimit ? Number(authLimit) : null,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || "create failed");
      const estimateId = created.estimate.id as string;

      // 2. Issue a version with the lines.
      const issueRes = await fetch(`/api/turn-estimator/estimates/${estimateId}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: specs }),
      });
      const issuedData = await issueRes.json();
      if (!issueRes.ok) throw new Error(issuedData.error || "issue failed");

      setIssued({
        estimateId,
        versionId: issuedData.version_id,
        ownerTotal: issuedData.owner_total,
        authorization: issuedData.authorization,
        status: issuedData.estimate_status,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "issue failed");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: "APPROVED" | "DECLINED") {
    if (!issued) return;
    setBusy(decision);
    setError(null);
    try {
      const reqRes = await fetch("/api/turn-estimator/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_id: issued.versionId, kind: "PM" }),
      });
      const req = await reqRes.json();
      if (!reqRes.ok) throw new Error(req.error || "request failed");
      const patchRes = await fetch(`/api/turn-estimator/approvals/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const patch = await patchRes.json();
      if (!patchRes.ok) throw new Error(patch.error || "decision failed");
      setIssued({ ...issued, status: decision === "APPROVED" ? "approved" : "declined" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    if (!issued) return;
    setBusy("convert");
    setError(null);
    try {
      const res = await fetch("/api/turn-estimator/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_id: issued.versionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "convert failed");
      setIssued({ ...issued, invoiceCode: data.invoice_code });
    } catch (e) {
      setError(e instanceof Error ? e.message : "convert failed");
    } finally {
      setBusy(null);
    }
  }

  const input = "rounded-lg border border-sand-200 px-2 py-1 text-sm";

  // ── Post-issue view ──
  if (issued) {
    const approved = issued.status === "approved";
    return (
      <div className="space-y-4">
        {error && <Banner>{error}</Banner>}
        <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-card">
          <div className="text-xs uppercase tracking-wide text-charcoal-400">Estimate issued</div>
          <div className="mt-1 text-2xl font-semibold text-charcoal-900">{money(issued.ownerTotal)}</div>
          <div className="mt-1 text-sm text-charcoal-500">
            {propertyName}
            {unitName ? ` · #${unitName}` : ""} · status:{" "}
            <span className="font-medium">{issued.status.replace(/_/g, " ")}</span>
            {issued.authorization === "auto_approved" ? " (within authorization limit)" : " (over limit — needs approval)"}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`/api/turn-estimator/estimates/${issued.estimateId}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800"
            >
              📄 Owner estimate PDF
            </a>
            {!approved && !issued.invoiceCode && (
              <>
                <button type="button" disabled={busy != null} onClick={() => decide("APPROVED")}
                  className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-charcoal-800 disabled:opacity-50">
                  {busy === "APPROVED" ? "…" : "Approve"}
                </button>
                <button type="button" disabled={busy != null} onClick={() => decide("DECLINED")}
                  className="rounded-lg border border-sand-200 px-3 py-1.5 text-xs font-medium text-charcoal-700 hover:bg-sand-50 disabled:opacity-50">
                  Decline
                </button>
              </>
            )}
            {approved && !issued.invoiceCode && (
              <button type="button" disabled={busy != null} onClick={convert}
                className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-charcoal-800 disabled:opacity-50">
                {busy === "convert" ? "Converting…" : "Convert to invoice"}
              </button>
            )}
          </div>

          {issued.invoiceCode && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              ✅ Converted to draft invoice <b>{issued.invoiceCode}</b> — find it in{" "}
              <a href="/maintenance/invoices" className="underline">Invoices</a>.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Build view ──
  return (
    <div className="space-y-4">
      {error && <Banner>{error}</Banner>}

      {seed.wo_description && (
        <div className="rounded-xl border border-sand-200 bg-sand-50 p-3 text-sm text-charcoal-600">
          <div className="text-xs font-medium uppercase tracking-wide text-charcoal-400">Work order scope</div>
          <p className="mt-1">{seed.wo_description}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs text-charcoal-500">
          Property
          <input className={`${input} mt-1 w-full`} value={propertyName} onChange={(e) => setPropertyName(e.target.value)} />
        </label>
        <label className="text-xs text-charcoal-500">
          Unit
          <input className={`${input} mt-1 w-full`} value={unitName} onChange={(e) => setUnitName(e.target.value)} />
        </label>
        <label className="text-xs text-charcoal-500">
          Authorization limit ($, optional)
          <input className={`${input} mt-1 w-full`} value={authLimit} onChange={(e) => setAuthLimit(e.target.value)} placeholder="config default" />
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-charcoal-500">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Minutes</th>
              <th className="px-3 py-2">Material $</th>
              <th className="px-3 py-2">Room / note</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {rows.map((r) => {
              const item = itemByCode.get(r.item_code);
              const method = item?.pricing_method;
              return (
                <tr key={r.key}>
                  <td className="px-3 py-2">
                    <select className={input} value={r.item_code} onChange={(e) => setRow(r.key, { item_code: e.target.value })}>
                      <option value="">— select —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.item_code}>
                          {it.name} ({it.item_code})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input className={`${input} w-16`} value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className={`${input} w-20`}
                      value={r.minutes}
                      onChange={(e) => setRow(r.key, { minutes: e.target.value })}
                      placeholder={method === "service_min" || method === "hourly" ? "min" : "—"}
                      disabled={!(method === "service_min" || method === "hourly")}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className={`${input} w-20`}
                      value={r.material_cost}
                      onChange={(e) => setRow(r.key, { material_cost: e.target.value })}
                      placeholder={method === "cost_plus" ? "cost" : "—"}
                      disabled={method !== "cost_plus"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input className={`${input} w-full`} value={r.room} onChange={(e) => setRow(r.key, { room: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      className="text-charcoal-400 hover:text-red-600">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setRows((rs) => [...rs, newRow()])}
          className="rounded-lg border border-sand-200 px-3 py-1.5 text-xs font-medium text-charcoal-700 hover:bg-sand-50">
          + Add line
        </button>

        <div className="flex items-center gap-4">
          {preview && (
            <div className="text-right">
              <div className="text-lg font-semibold text-charcoal-900">{money(preview.owner_total)}</div>
              <div className={`text-xs ${preview.authorization === "auto_approved" ? "text-green-600" : "text-amber-600"}`}>
                {preview.authorization === "auto_approved" ? "within limit — auto-approves" : "over limit — needs approval"}
              </div>
            </div>
          )}
          <button type="button" disabled={busy != null} onClick={issue}
            className="rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-medium text-white hover:bg-charcoal-800 disabled:opacity-50">
            {busy === "issue" ? "Issuing…" : "Save & Issue Estimate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{children}</div>
  );
}
