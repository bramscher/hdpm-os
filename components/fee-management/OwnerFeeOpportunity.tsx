"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  CAMPAIGN_STATUSES,
  STATUS_LABELS,
  buildOwnerRows,
  campaignFunnel,
  ownerRowsToCsv,
  portfolioSummary,
  type Agreement,
  type CampaignEntry,
  type CampaignStatus,
  type DoorBand,
  type FeeFacts,
  type OwnerRow,
  type PriorityWeights,
  type Segment,
} from "@/lib/fee-management/model";

interface Payload {
  facts: FeeFacts;
  capturedAt: string | null;
  schedule: DoorBand[];
  maxRaisePts: number;
  weights: PriorityWeights;
  agreements: Agreement[];
  campaign: CampaignEntry[];
}

type SortKey =
  | "name" | "propertyCount" | "doors" | "blendedPct" | "currentFeesMonthly" | "targetPct"
  | "gapPts" | "nextRaiseYearly" | "addedYearly" | "grade" | "renewal" | "priority";

const SEGMENTS: Segment[] = ["Personal call", "Letter", "Renewal-timed", "Portfolio review"];

/** Gray → deep red as the grade rises; the only color in the table. */
function gradeColor(grade: number): string {
  const t = Math.min(Math.max(grade, 0), 100) / 100;
  return `hsl(0 ${Math.round(72 * t)}% ${Math.round(80 - 32 * t)}%)`;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n == null ? "—" : `${Number(n.toFixed(2))}%`);
const todayIso = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // yyyy-mm-dd

async function put(url: string, body: unknown) {
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Save failed");
  return json;
}

export function OwnerFeeOpportunity() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bandFilter, setBandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | CampaignStatus>("all");
  const [segmentFilter, setSegmentFilter] = useState<"all" | Segment>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "grade", dir: -1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    load();
  }, [load]);

  const rows = useMemo(
    () =>
      payload
        ? buildOwnerRows({
            facts: payload.facts,
            schedule: payload.schedule,
            maxRaisePts: payload.maxRaisePts,
            weights: payload.weights,
            agreements: payload.agreements,
            campaign: payload.campaign,
            today: todayIso(),
          })
        : [],
    [payload]
  );
  const summary = useMemo(() => portfolioSummary(rows), [rows]);
  const funnel = useMemo(() => campaignFunnel(rows), [rows]);
  const bands = useMemo(
    () =>
      [...new Map(rows.map((r) => [r.bandLabel, r.band?.minDoors ?? 9999])).entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([label]) => label),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (bandFilter === "all" || r.bandLabel === bandFilter) &&
        (statusFilter === "all" || r.campaign.status === statusFilter) &&
        (segmentFilter === "all" || r.segments.includes(segmentFilter)) &&
        (!q || r.name.toLowerCase().includes(q) || r.properties.some((p) => p.property.name.toLowerCase().includes(q)))
    );
    const val = (r: OwnerRow): number | string => {
      if (sort.key === "name") return r.name.toLowerCase();
      if (sort.key === "renewal") return r.earliestRenewal?.daysUntil ?? Number.MAX_SAFE_INTEGER;
      return (r[sort.key] as number | null) ?? -Infinity;
    };
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, bandFilter, statusFilter, segmentFilter, search, sort]);

  const setCampaign = (entry: CampaignEntry) =>
    setPayload((p) => p && { ...p, campaign: [...p.campaign.filter((c) => c.ownerSetKey !== entry.ownerSetKey), entry] });

  const saveCampaign = async (row: OwnerRow, patch: Partial<CampaignEntry>) => {
    const next = { ...row.campaign, ...patch };
    const prev = row.campaign;
    setCampaign(next);
    try {
      const { entry } = await put("/api/admin/fee-management/campaign", { ...next, ownerName: row.name });
      setCampaign(entry);
      return true;
    } catch (e) {
      setCampaign(prev);
      toast.error(e instanceof Error ? e.message : "Save failed");
      return false;
    }
  };

  const saveAgreement = async (a: Agreement) => {
    try {
      const { agreement } = await put("/api/admin/fee-management/agreement", a);
      setPayload((p) => p && { ...p, agreements: [...p.agreements.filter((x) => x.propertyId !== a.propertyId), agreement] });
      toast.success("Agreement saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const exportCsv = () => {
    const blob = new Blob([ownerRowsToCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `owner-fee-opportunity-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const th = (key: SortKey, label: string, right = true) => (
    <th className={`py-2 pr-3 font-semibold ${right ? "text-right" : ""}`}>
      <button
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "name" || key === "renewal" ? 1 : -1 }))}
        className="uppercase tracking-wider hover:text-charcoal-900"
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  if (loading) return <div className="h-64 rounded-xl bg-sand-50 animate-pulse" />;
  if (error || !payload)
    return (
      <div className="rounded-xl border border-sand-200 p-6 text-sm text-charcoal-600">
        {error ?? "No data"}{" "}
        <button onClick={() => load()} className="font-semibold underline">Retry</button>
      </div>
    );

  return (
    <div>
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Portfolio rate" value={`${pct(summary.currentEffectivePct)} → ${pct(summary.newEffectivePct)}`} sub="effective now → at door schedule" />
        <Stat label="At schedule" value={`+${usd(summary.addedYearly)}/yr`} sub={`${usd(summary.addedMonthly)}/mo · ${summary.ownersWithUpside} of ${rows.length} owners below`} />
        <Stat label="First raise" value={`+${usd(summary.nextRaiseYearly)}/yr`} sub={`up to +${payload.maxRaisePts} pts each → ${pct(summary.nextRaiseEffectivePct)}`} />
        <Stat label="Doors" value={rows.reduce((a, r) => a + r.doors, 0).toLocaleString()} sub={`${rows.length} owners`} />
      </div>

      {/* Campaign funnel */}
      <div className="grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-sand-200 bg-sand-200 mb-5">
        {funnel.map((f) => (
          <button
            key={f.status}
            onClick={() => setStatusFilter((s) => (s === f.status ? "all" : f.status))}
            className={`bg-white px-3 py-2.5 text-left hover:bg-sand-50 ${statusFilter === f.status ? "ring-2 ring-inset ring-charcoal-900" : ""}`}
          >
            <p className="text-[11px] text-charcoal-400">{STATUS_LABELS[f.status]}</p>
            <p className="text-base font-semibold tabular-nums text-charcoal-900">{f.count}</p>
            <p className="text-[11px] tabular-nums text-charcoal-500">{usd(f.dollarsYearly)}/yr</p>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-[12.5px]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search owner or property"
          className="h-8 w-56 rounded-md border border-sand-200 px-2.5"
        />
        <Select value={bandFilter} onChange={setBandFilter} options={[["all", "All door bands"], ...bands.map((t) => [t, t] as [string, string])]} />
        <Select
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "all" | CampaignStatus)}
          options={[["all", "All statuses"], ...CAMPAIGN_STATUSES.map((s) => [s, STATUS_LABELS[s]] as [string, string])]}
        />
        <Select
          value={segmentFilter}
          onChange={(v) => setSegmentFilter(v as "all" | Segment)}
          options={[["all", "All segments"], ...SEGMENTS.map((s) => [s, s] as [string, string])]}
        />
        <span className="text-charcoal-400">{visible.length} owners</span>
        <div className="ml-auto flex items-center gap-2">
          <ToolbarButton onClick={() => setSettingsOpen((o) => !o)} icon={<Settings2 className="h-3.5 w-3.5" />}>
            Schedule &amp; weights
          </ToolbarButton>
          <ToolbarButton onClick={exportCsv} icon={<Download className="h-3.5 w-3.5" />}>Export CSV</ToolbarButton>
          <ToolbarButton
            onClick={() => load(true)}
            disabled={refreshing}
            icon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />}
          >
            {refreshing ? "Pulling AppFolio…" : "Refresh"}
          </ToolbarButton>
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          schedule={payload.schedule}
          maxRaisePts={payload.maxRaisePts}
          weights={payload.weights}
          onSaved={(schedule, maxRaisePts, weights) => setPayload((p) => p && { ...p, schedule, maxRaisePts, weights })}
        />
      )}

      {/* Owner table */}
      <div className="overflow-x-auto rounded-xl border border-sand-200">
        <table className="w-full text-[12.5px]">
          <thead className="bg-sand-50">
            <tr className="text-left text-[10.5px] text-charcoal-400 border-b border-sand-200">
              <th className="w-6" />
              {th("name", "Owner", false)}
              {th("propertyCount", "Props")}
              {th("doors", "Doors")}
              <th className="py-2 pr-3 text-right font-semibold uppercase tracking-wider">Occ.</th>
              {th("blendedPct", "Blended")}
              {th("currentFeesMonthly", "Fees / mo")}
              {th("targetPct", "Schedule")}
              {th("gapPts", "Gap")}
              {th("nextRaiseYearly", "Next raise")}
              {th("addedYearly", "+ / yr")}
              {th("grade", "Opportunity", false)}
              {th("renewal", "Agreement end", false)}
              {th("priority", "Priority")}
              <th className="py-2 pr-3 font-semibold uppercase tracking-wider">Segment</th>
              <th className="py-2 pr-3 font-semibold uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Fragment key={r.key}>
                <tr
                  className={`border-b border-sand-100 hover:bg-sand-50 cursor-pointer ${expanded === r.key ? "bg-sand-50" : ""}`}
                  onClick={() => setExpanded((k) => (k === r.key ? null : r.key))}
                >
                  <td className="pl-2 text-charcoal-400">
                    {expanded === r.key ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </td>
                  <td className="py-2 pr-3 max-w-[220px]">
                    <p className="truncate font-medium text-charcoal-900" title={r.name}>{r.name}</p>
                    <p className="truncate text-[11px] text-charcoal-400">{r.bandLabel}</p>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.propertyCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.doors}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-charcoal-500">{r.occupiedDoors}</td>
                  <td className="py-2 pr-3 text-right tabular-nums" title={r.blendedBasis === "doors" ? "No occupied doors — weighted by door count" : undefined}>
                    {pct(r.blendedPct)}
                    {r.blendedBasis === "doors" && <sup className="text-charcoal-400">d</sup>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(r.currentFeesMonthly)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{pct(r.targetPct)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.gapPts ? `+${r.gapPts}` : "—"}</td>
                  <td
                    className="py-2 pr-3 text-right tabular-nums whitespace-nowrap"
                    title={r.raisesToTarget > 1 ? `${r.raisesToTarget} raises to reach schedule` : undefined}
                  >
                    {r.nextRaiseYearly > 0 ? (
                      <>
                        <span className="text-charcoal-500">{pct(r.nextRaisePct)}</span> {usd(r.nextRaiseYearly)}
                        {r.raisesToTarget > 1 && <span className="ml-1 text-[10px] text-charcoal-400">1/{r.raisesToTarget}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold">{r.addedYearly > 0 ? usd(r.addedYearly) : "—"}</td>
                  <td className="py-2 pr-3">
                    <GradeBar grade={r.grade} />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {r.earliestRenewal ? (
                      <>
                        <span className="tabular-nums">{r.earliestRenewal.date}</span>{" "}
                        <span className={`tabular-nums ${r.earliestRenewal.daysUntil <= 60 ? "font-semibold text-red-600" : "text-charcoal-400"}`}>
                          {r.earliestRenewal.daysUntil}d
                        </span>
                        {r.earliestRenewal.source === "projected" && (
                          <span className="ml-1 text-[10px] text-charcoal-400" title="Projected: yearly auto-renewal from management start date">proj.</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span className="inline-block min-w-[30px] rounded bg-charcoal-900 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-white">
                      {r.priority}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {r.segments.map((s) => (
                        <span key={s} className="whitespace-nowrap rounded border border-sand-300 px-1.5 py-0.5 text-[10.5px] text-charcoal-600">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={r.campaign.status}
                      onChange={(e) => saveCampaign(r, { status: e.target.value as CampaignStatus })}
                      className="h-7 rounded-md border border-sand-200 bg-white px-1.5 text-[12px]"
                    >
                      {CAMPAIGN_STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
                {expanded === r.key && (
                  <tr className="border-b border-sand-200 bg-sand-50/60">
                    <td />
                    <td colSpan={15} className="py-4 pr-4">
                      <OwnerDetail row={r} onSaveCampaign={saveCampaign} onSaveAgreement={saveAgreement} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={16} className="py-8 text-center text-charcoal-400">No owners match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] text-charcoal-400 leading-relaxed">
        Estimates use AppFolio market rent on occupied revenue units (actual lease rents aren&apos;t on the v0 API), so
        vacant doors add nothing until leased. Blended fee % is weighted by that rent (<sup>d</sup> = no occupied doors,
        weighted by door count). Schedule = the door-count rate for the owner&apos;s total doors (also the rule for new business);
        fees above schedule are never lowered. Opportunity grades the full $/yr gap to schedule on a square-root curve
        (100 = largest in the portfolio, 0 = at schedule). Next raise = one step of at most {payload.maxRaisePts} pts per
        property; &ldquo;1/3&rdquo; means three raises to reach schedule. Agreement ends marked &ldquo;proj.&rdquo; assume
        a 1-year term auto-renewing on the management start anniversary; enter actual dates per property to override.
        AppFolio data as of {payload.capturedAt ? new Date(payload.capturedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "—"} PT.
      </p>
    </div>
  );
}

// ── Owner detail: campaign editor, contacts, per-property agreements ────────

function OwnerDetail({
  row,
  onSaveCampaign,
  onSaveAgreement,
}: {
  row: OwnerRow;
  onSaveCampaign: (row: OwnerRow, patch: Partial<CampaignEntry>) => Promise<boolean>;
  onSaveAgreement: (a: Agreement) => Promise<void>;
}) {
  const c = row.campaign;
  const [draft, setDraft] = useState({
    newFeePct: c.newFeePct?.toString() ?? "",
    effectiveDate: c.effectiveDate ?? "",
    assignedTo: c.assignedTo ?? "",
    notes: c.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const ok = await onSaveCampaign(row, {
      newFeePct: draft.newFeePct === "" ? null : Number(draft.newFeePct),
      effectiveDate: draft.effectiveDate || null,
      assignedTo: draft.assignedTo || null,
      notes: draft.notes || null,
    });
    setSaving(false);
    if (ok) toast.success("Campaign updated");
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-charcoal-400">Campaign</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="New fee %">
              <input type="number" step="0.05" value={draft.newFeePct} placeholder={row.nextRaisePct?.toString() ?? ""}
                onChange={(e) => setDraft({ ...draft, newFeePct: e.target.value })} className="input" />
            </Field>
            <Field label="Effective date">
              <input type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} className="input" />
            </Field>
            <Field label="Owner (staff)" wide>
              <input value={draft.assignedTo} onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })} className="input" placeholder="Who owns this conversation" />
            </Field>
            <Field label="Notes" wide>
              <textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="input h-auto py-1.5" />
            </Field>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="h-8 rounded-md bg-charcoal-900 px-3 text-[12px] font-medium text-white hover:bg-charcoal-800 disabled:opacity-50">
              {saving ? "Saving…" : "Save campaign"}
            </button>
            {c.updatedAt && <span className="text-[11px] text-charcoal-400">Updated {new Date(c.updatedAt).toLocaleDateString()}</span>}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-charcoal-400">Contacts</p>
          {row.owners.length === 0 ? (
            <p className="text-[12px] text-charcoal-500">No owner on file in AppFolio.</p>
          ) : (
            <ul className="space-y-1.5 text-[12px]">
              {row.owners.map((o) => (
                <li key={o.id}>
                  <span className="font-medium text-charcoal-900">{o.name}</span>
                  {o.percentOwned != null && o.percentOwned < 100 && <span className="text-charcoal-400"> · {o.percentOwned}%</span>}
                  <br />
                  {o.email && <a href={`mailto:${o.email}`} className="text-charcoal-600 underline-offset-2 hover:underline">{o.email}</a>}
                  {o.email && o.phone && <span className="text-charcoal-300"> · </span>}
                  {o.phone && <a href={`tel:${o.phone}`} className="text-charcoal-600">{o.phone}</a>}
                </li>
              ))}
            </ul>
          )}
          {row.lastFeeChange && <p className="mt-2 text-[11px] text-charcoal-400">Last fee change on file: {row.lastFeeChange}</p>}
        </div>
      </div>

      <div className="min-w-0">
        <p className="mb-1.5 text-[11px] font-medium text-charcoal-400">Properties &amp; agreements</p>
        <div className="overflow-x-auto rounded-lg border border-sand-200 bg-white">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
                <th className="py-1.5 px-2 font-semibold">Property</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Doors</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Fee</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Next</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Schedule</th>
                <th className="py-1.5 pr-2 font-semibold text-right">+ / yr</th>
                <th className="py-1.5 pr-2 font-semibold">Start</th>
                <th className="py-1.5 pr-2 font-semibold">End</th>
                <th className="py-1.5 pr-2 font-semibold">Auto</th>
                <th className="py-1.5 pr-2 font-semibold">Notice</th>
                <th className="py-1.5 pr-2 font-semibold">Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {row.properties.map((pr) => (
                <AgreementRow key={pr.property.id} pr={pr} onSave={onSaveAgreement} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AgreementRow({ pr, onSave }: { pr: OwnerRow["properties"][number]; onSave: (a: Agreement) => Promise<void> }) {
  const p = pr.property;
  const a = pr.agreement;
  const initial = {
    startDate: a?.startDate ?? "",
    endDate: a?.endDate ?? "",
    autoRenew: a?.autoRenew ?? true,
    noticeDays: a?.noticeDays?.toString() ?? "",
    notes: a?.notes ?? "",
  };
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  return (
    <tr className="border-b border-sand-100 last:border-0 align-top">
      <td className="py-1.5 px-2 max-w-[200px]">
        <p className="truncate font-medium text-charcoal-900" title={p.name}>{p.name}</p>
        <p className="truncate text-[10.5px] text-charcoal-400">
          {pr.renewal ? `Next end ${pr.renewal.date} (${pr.renewal.source})` : "No dates on file"}
          {pr.renewal?.noticeBy ? ` · notice by ${pr.renewal.noticeBy}` : ""}
        </p>
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{p.occupiedDoors}/{p.doors}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">
        {p.feeType === "percent" ? `${p.feePct}%` : p.feeType === "flat" ? `${usd(p.flatMonthly ?? 0)}/mo` : "—"}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">
        {pr.nextRaisePct != null && pr.nextRaisePct !== p.feePct ? `${pr.nextRaisePct}%` : "—"}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{pr.targetPct != null ? `${pr.targetPct}%` : "—"}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{pr.addedYearly > 0 ? usd(pr.addedYearly) : "—"}</td>
      <td className="py-1.5 pr-2">
        <input type="date" value={d.startDate} placeholder={p.mgmtStartDate ?? ""} title={p.mgmtStartDate ? `AppFolio management start: ${p.mgmtStartDate}` : undefined}
          onChange={(e) => setD({ ...d, startDate: e.target.value })} className="input w-[128px]" />
      </td>
      <td className="py-1.5 pr-2">
        <input type="date" value={d.endDate} onChange={(e) => setD({ ...d, endDate: e.target.value })} className="input w-[128px]" />
      </td>
      <td className="py-1.5 pr-2 pt-2.5">
        <input type="checkbox" checked={d.autoRenew} onChange={(e) => setD({ ...d, autoRenew: e.target.checked })} />
      </td>
      <td className="py-1.5 pr-2">
        <input type="number" min={0} max={365} value={d.noticeDays} placeholder="days" onChange={(e) => setD({ ...d, noticeDays: e.target.value })} className="input w-[64px]" />
      </td>
      <td className="py-1.5 pr-2">
        <input value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} className="input w-[160px]" />
      </td>
      <td className="py-1.5 pr-2">
        <button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            await onSave({
              propertyId: p.id,
              startDate: d.startDate || null,
              endDate: d.endDate || null,
              autoRenew: d.autoRenew,
              noticeDays: d.noticeDays === "" ? null : Number(d.noticeDays),
              notes: d.notes || null,
            });
            setSaving(false);
          }}
          className="h-7 rounded-md border border-sand-300 px-2 text-[11.5px] font-medium hover:bg-sand-100 disabled:opacity-40"
        >
          {saving ? "…" : "Save"}
        </button>
      </td>
    </tr>
  );
}

// ── Settings: door schedule, raise cap, priority weights ──────────────

function SettingsPanel({
  schedule,
  maxRaisePts,
  weights,
  onSaved,
}: {
  schedule: DoorBand[];
  maxRaisePts: number;
  weights: PriorityWeights;
  onSaved: (schedule: DoorBand[], maxRaisePts: number, weights: PriorityWeights) => void;
}) {
  const [bands, setBands] = useState(
    schedule.map((b) => ({
      minDoors: String(b.minDoors),
      maxDoors: b.maxDoors == null ? "" : String(b.maxDoors),
      targetPct: String(b.targetPct),
      review: !!b.review,
    }))
  );
  const [cap, setCap] = useState(String(maxRaisePts));
  const [w, setW] = useState({ addedDollars: String(weights.addedDollars), renewalUrgency: String(weights.renewalUrgency), feeGap: String(weights.feeGap) });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const doorSchedule = bands.map((b) => ({
      minDoors: Number(b.minDoors),
      maxDoors: b.maxDoors === "" ? null : Number(b.maxDoors),
      targetPct: Number(b.targetPct),
      review: b.review,
    }));
    const priorityWeights = { addedDollars: Number(w.addedDollars), renewalUrgency: Number(w.renewalUrgency), feeGap: Number(w.feeGap) };
    setSaving(true);
    try {
      await put("/api/admin/fee-management/config", { doorSchedule, maxRaisePts: Number(cap), priorityWeights });
      onSaved(
        [...doorSchedule].sort((a, b) => a.minDoors - b.minDoors).map(({ review, ...b }) => (review ? { ...b, review } : b)),
        Number(cap),
        priorityWeights
      );
      toast.success("Schedule and weights saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 grid gap-6 rounded-xl border border-sand-200 p-4 lg:grid-cols-[1fr_280px]">
      <div>
        <p className="mb-2 text-[12.5px] font-semibold text-charcoal-800">Door schedule</p>
        <table className="text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-charcoal-400">
              <th className="pr-2 pb-1 font-semibold">From doors</th>
              <th className="pr-2 pb-1 font-semibold">To doors</th>
              <th className="pr-2 pb-1 font-semibold">Fee %</th>
              <th className="pr-2 pb-1 font-semibold">Review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i}>
                {(["minDoors", "maxDoors", "targetPct"] as const).map((k) => (
                  <td key={k} className="pr-2 pb-1.5">
                    <input
                      type="number"
                      step={k === "targetPct" ? "0.25" : "1"}
                      value={b[k]}
                      placeholder={k === "maxDoors" ? "and up" : ""}
                      onChange={(e) => setBands(bands.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))}
                      className="input w-20"
                    />
                  </td>
                ))}
                <td className="pr-2 pb-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={b.review}
                    title="Target is a starting point; portfolio gets a manual review"
                    onChange={(e) => setBands(bands.map((y, j) => (j === i ? { ...y, review: e.target.checked } : y)))}
                  />
                </td>
                <td className="pb-1.5 text-[11px] text-charcoal-400">
                  <button onClick={() => setBands(bands.filter((_, j) => j !== i))} className="hover:text-red-600" aria-label="Remove band">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => setBands([...bands, { minDoors: "", maxDoors: "", targetPct: "", review: false }])}
          className="mt-1 text-[12px] font-medium text-charcoal-600 hover:text-charcoal-900"
        >
          + Add band
        </button>
        <label className="mt-4 flex items-center gap-3 text-[12px] text-charcoal-600">
          Max raise per step (existing clients)
          <input type="number" step="0.25" min={0.25} value={cap} onChange={(e) => setCap(e.target.value)} className="input w-20" />
          <span className="text-charcoal-400">pts</span>
        </label>
        <p className="mt-1 text-[11px] text-charcoal-400">
          Bands count an owner&apos;s total doors. New business goes straight to schedule; existing clients step up by at most this much per raise.
        </p>
      </div>
      <div>
        <p className="mb-2 text-[12.5px] font-semibold text-charcoal-800">Priority weights</p>
        {([
          ["addedDollars", "Added $/yr"],
          ["renewalUrgency", "Agreement end (sooner)"],
          ["feeGap", "Fee gap"],
        ] as const).map(([k, label]) => (
          <label key={k} className="mb-1.5 flex items-center justify-between gap-3 text-[12px] text-charcoal-600">
            {label}
            <input type="number" step="0.05" min={0} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} className="input w-20" />
          </label>
        ))}
        <p className="mb-3 text-[11px] text-charcoal-400">Relative; they don&apos;t need to sum to 1.</p>
        <button onClick={save} disabled={saving} className="h-8 rounded-md bg-charcoal-900 px-3 text-[12px] font-medium text-white hover:bg-charcoal-800 disabled:opacity-50">
          {saving ? "Saving…" : "Save & recalculate"}
        </button>
      </div>
    </div>
  );
}

// ── Small bits ──────────────────────────────────────────

function GradeBar({ grade }: { grade: number }) {
  return (
    <div className="flex w-[112px] items-center gap-2" title={grade === 0 ? "At or above schedule" : `Opportunity grade ${grade} of 100`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-sand-100">
        {grade > 0 && <div className="h-full rounded-full" style={{ width: `${grade}%`, background: gradeColor(grade) }} />}
      </div>
      <span className="w-7 text-right text-[11.5px] font-semibold tabular-nums text-charcoal-900">{grade}</span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-sand-200 px-3.5 py-3">
      <p className="text-[11px] font-medium text-charcoal-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-charcoal-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-charcoal-400">{sub}</p>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md border border-sand-200 bg-white px-2">
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function ToolbarButton({ onClick, icon, children, disabled }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex h-8 items-center gap-1.5 rounded-md border border-sand-200 bg-white px-2.5 font-medium text-charcoal-700 hover:bg-sand-50 disabled:opacity-50">
      {icon}
      {children}
    </button>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-[11px] text-charcoal-500 ${wide ? "col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}
