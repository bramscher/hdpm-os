"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  agreementRows,
  sortAgreementRows,
  type Agreement,
  type AgreementRow,
  type AgreementSort,
  type FeeFacts,
} from "@/lib/fee-management/model";

/**
 * Fee Management → Agreements: every owner management agreement, one row per
 * property, sorted by when it next expires. Most agreements auto-renew every
 * year, so the "Renews" column shows the day and month without the year.
 * AppFolio's API can't list documents, so staff paste the link to the latest
 * signed agreement and the date it was last renewed (its version).
 */

interface Payload {
  facts: FeeFacts;
  capturedAt: string | null;
  agreements: Agreement[];
}

type Window = "all" | "30" | "60" | "90";

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—";

export function AgreementsTable() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [windowDays, setWindowDays] = useState<Window>("all");
  const [missingLinkOnly, setMissingLinkOnly] = useState(false);
  const [missingRenewedOnly, setMissingRenewedOnly] = useState(false);
  const [sort, setSort] = useState<{ by: AgreementSort; dir: "asc" | "desc" }>({ by: "expiration", dir: "asc" });
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await fetch(`/api/admin/fee-management${refresh ? "?refresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load");
      setPayload(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => (payload ? agreementRows(payload.facts, payload.agreements, todayIso()) : []), [payload]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const limit = windowDays === "all" ? null : Number(windowDays);
    const filtered = rows.filter((r) => {
      if (q && ![r.propertyName, r.address, r.ownerNames].join(" ").toLowerCase().includes(q)) return false;
      if (limit != null && (!r.renewal || r.renewal.daysUntil > limit)) return false;
      if (missingLinkOnly && !r.missingLink) return false;
      if (missingRenewedOnly && !r.missingRenewedDate) return false;
      return true;
    });
    return sortAgreementRows(filtered, sort.by, sort.dir);
  }, [rows, search, windowDays, missingLinkOnly, missingRenewedOnly, sort]);

  const counts = useMemo(
    () => ({ missingLink: rows.filter((r) => r.missingLink).length, missingRenewed: rows.filter((r) => r.missingRenewedDate).length }),
    [rows]
  );
  const noPropertyLinks = rows.length > 0 && rows.every((r) => !r.appfolioPropertyUrl);

  const th = (by: AgreementSort | null, label: string, help?: string) => (
    <th className="py-2 pr-3 text-left font-semibold">
      {by ? (
        <button
          type="button"
          onClick={() => setSort((s) => ({ by, dir: s.by === by && s.dir === "asc" ? "desc" : "asc" }))}
          className="uppercase tracking-wider hover:text-charcoal-900"
          title={help}
          aria-label={`Sort by ${label}`}
        >
          {label}
          {sort.by === by ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      ) : (
        <span className="uppercase tracking-wider" title={help}>{label}</span>
      )}
    </th>
  );

  if (loading) return <div className="h-64 rounded-xl bg-sand-50 animate-pulse" />;
  if (error || !payload)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error ?? "Could not load agreements."}{" "}
        <button className="underline" onClick={() => load()}>
          Try again
        </button>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search property, owner or address"
          aria-label="Search agreements"
          className="h-8 w-64 rounded-md border border-sand-300 bg-white px-2.5 text-[12.5px]"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-charcoal-500">
          Expiring
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value as Window)}
            className="h-8 rounded-md border border-sand-300 bg-white px-2 text-[12.5px]"
          >
            <option value="all">Any time</option>
            <option value="30">Within 30 days</option>
            <option value="60">Within 60 days</option>
            <option value="90">Within 90 days</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-charcoal-600">
          <input type="checkbox" checked={missingLinkOnly} onChange={(e) => setMissingLinkOnly(e.target.checked)} />
          Missing agreement link <span className="tabular-nums text-charcoal-400">({counts.missingLink})</span>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-charcoal-600">
          <input type="checkbox" checked={missingRenewedOnly} onChange={(e) => setMissingRenewedOnly(e.target.checked)} />
          Missing renewed date <span className="tabular-nums text-charcoal-400">({counts.missingRenewed})</span>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] tabular-nums text-charcoal-400">
            {visible.length} of {rows.length} properties
          </span>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-sand-300 bg-white px-2.5 text-[12px] font-medium text-charcoal-700 hover:bg-sand-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Pulling AppFolio…" : "Refresh"}
          </button>
        </div>
      </div>

      {noPropertyLinks && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          AppFolio property links appear after the next AppFolio pull. Click Refresh to load them now.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-sand-200">
        <table className="w-full text-[12.5px]">
          <thead className="bg-sand-50">
            <tr className="text-[10.5px] text-charcoal-400 border-b border-sand-200">
              {th("property", "Property")}
              {th("owner", "Owner")}
              {th("monthDay", "Renews", "Day and month the agreement renews each year (year left off). Sorts January to December.")}
              {th("expiration", "Next expiration")}
              {th(null, "Auto-renew")}
              {th(null, "Notice by")}
              {th("lastRenewed", "Last renewed", "Date the current agreement was last signed or renewed; tells you which version they have.")}
              {th(null, "Agreement")}
              {th(null, "AppFolio")}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Fragment key={r.propertyId}>
                <tr
                  className={`border-b border-sand-100 hover:bg-sand-50 cursor-pointer ${editing === r.propertyId ? "bg-sand-50" : ""}`}
                  onClick={() => setEditing((id) => (id === r.propertyId ? null : r.propertyId))}
                >
                  <td className="py-2 pr-3 pl-3 max-w-[240px]">
                    <p className="truncate font-medium text-charcoal-900" title={r.propertyName}>{r.propertyName}</p>
                    <p className="truncate text-[11px] text-charcoal-400" title={r.address}>{r.address}</p>
                  </td>
                  <td className="py-2 pr-3 max-w-[200px] truncate" title={r.ownerNames}>{r.ownerNames || "—"}</td>
                  <td className="py-2 pr-3 font-medium tabular-nums">{r.expiresMonthDay || "—"}</td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                    {r.renewal ? (
                      <>
                        {fmtDate(r.renewal.date)}{" "}
                        <span className={`text-[11px] ${r.renewal.daysUntil <= 30 ? "text-red-700" : r.renewal.daysUntil <= 90 ? "text-amber-700" : "text-charcoal-400"}`}>
                          · {r.renewal.daysUntil < 0 ? `${-r.renewal.daysUntil}d ago` : `in ${r.renewal.daysUntil}d`}
                        </span>
                        {r.projected && (
                          <span className="ml-1 rounded bg-sand-100 px-1 text-[10px] text-charcoal-500" title="No end date entered; projected yearly from the AppFolio management start date">
                            projected
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.autoRenew ? "Yes" : <span className="font-medium text-amber-800">No</span>}</td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{fmtDate(r.renewal?.noticeBy)}</td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                    {r.lastRenewedOn ? fmtDate(r.lastRenewedOn) : <span className="text-amber-700">Add date</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {r.agreementUrl ? (
                      <a href={r.agreementUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-terra-700 underline">
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <button type="button" onClick={() => setEditing(r.propertyId)} className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                        Add link
                      </button>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {r.appfolioPropertyUrl ? (
                      <a href={r.appfolioPropertyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-charcoal-600 underline">
                        Property <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-charcoal-300">—</span>
                    )}
                  </td>
                </tr>
                {editing === r.propertyId && (
                  <tr className="border-b border-sand-200 bg-sand-50/60">
                    <td colSpan={9} className="px-3 py-3">
                      <AgreementEditor
                        row={r}
                        onCancel={() => setEditing(null)}
                        onSaved={(a) => {
                          setPayload((p) => p && { ...p, agreements: [...p.agreements.filter((x) => x.propertyId !== a.propertyId), a] });
                          setEditing(null);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-charcoal-400">
                  No agreements match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-charcoal-400">
        Expirations come from the end date entered here; auto-renewing agreements roll forward a year at a time. Without an end date, the expiration is
        projected yearly from AppFolio&apos;s management start date. AppFolio data as of {payload.capturedAt ? new Date(payload.capturedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "—"}.
      </p>
    </div>
  );
}

function AgreementEditor({ row, onCancel, onSaved }: { row: AgreementRow; onCancel: () => void; onSaved: (a: Agreement) => void }) {
  const a = row.agreement;
  const [endDate, setEndDate] = useState(a?.endDate ?? "");
  const [autoRenew, setAutoRenew] = useState(a?.autoRenew ?? true);
  const [noticeDays, setNoticeDays] = useState(a?.noticeDays != null ? String(a.noticeDays) : "");
  const [lastRenewedOn, setLastRenewedOn] = useState(a?.lastRenewedOn ?? "");
  const [agreementUrl, setAgreementUrl] = useState(a?.agreementUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = (k: string) => `agreement-${row.propertyId}-${k}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // Send the whole agreement so the PUT keeps start date and notes as they are.
    const body = {
      propertyId: row.propertyId,
      startDate: a?.startDate ?? null,
      endDate: endDate || null,
      autoRenew,
      noticeDays: noticeDays === "" ? null : Number(noticeDays),
      notes: a?.notes ?? null,
      lastRenewedOn: lastRenewedOn || null,
      agreementUrl: agreementUrl.trim() || null,
    };
    try {
      const res = await fetch("/api/admin/fee-management/agreement", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Save failed");
      toast.success(`Saved agreement for ${row.propertyName}`);
      onSaved({ ...body, ...json.agreement });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const label = "block text-[10.5px] font-semibold uppercase tracking-wider text-charcoal-400 mb-1";
  const input = "h-8 w-full rounded-md border border-sand-300 bg-white px-2 text-[12.5px]";
  return (
    <form onSubmit={save} className="grid gap-3 md:grid-cols-6">
      <div className="md:col-span-3">
        <label htmlFor={id("url")} className={label}>Link to the latest signed agreement in AppFolio</label>
        <input id={id("url")} value={agreementUrl} onChange={(e) => setAgreementUrl(e.target.value)} placeholder="https://highdesertpm.appfolio.com/…" className={input} />
        <p className="mt-1 text-[11px] text-charcoal-400">
          Open the property in AppFolio, open the agreement in its attachments, and copy the address.
          {row.appfolioPropertyUrl && (
            <>
              {" "}
              <a href={row.appfolioPropertyUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Open the property ↗
              </a>
            </>
          )}
        </p>
      </div>
      <div>
        <label htmlFor={id("renewed")} className={label}>Last renewed</label>
        <input id={id("renewed")} type="date" value={lastRenewedOn} onChange={(e) => setLastRenewedOn(e.target.value)} className={input} />
      </div>
      <div>
        <label htmlFor={id("end")} className={label}>Term end date</label>
        <input id={id("end")} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={input} />
      </div>
      <div>
        <label htmlFor={id("notice")} className={label}>Notice days</label>
        <input id={id("notice")} type="number" min={0} max={365} value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} className={input} />
      </div>
      <div className="md:col-span-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[12px] text-charcoal-600">
          <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
          Auto-renews every year
        </label>
        {error && (
          <p role="alert" className="text-[12px] text-red-700">
            {error}
          </p>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-sand-300 bg-white px-3 text-[12px]">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="h-8 rounded-md bg-charcoal-900 px-3 text-[12px] font-medium text-white disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}
