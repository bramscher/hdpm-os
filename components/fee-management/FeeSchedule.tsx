"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  BASIS_LABELS,
  MGMT_SCENARIO_LABELS,
  VOLUME_LABELS,
  computeCashFlow,
  type FeeBasis,
  type FeeLine,
  type FeeScheduleConfig,
  type FeeValue,
  type MgmtScenario,
  type VolumeContext,
  type VolumeSource,
} from "@/lib/fee-management/fee-schedule";
import {
  buildOwnerRows,
  type Agreement,
  type CampaignEntry,
  type DoorBand,
  type FeeFacts,
  type PriorityWeights,
  type RaiseFloor,
} from "@/lib/fee-management/model";
import type { FeeVolumes } from "@/lib/fee-management/volumes";
import { MarketBenchmarks } from "./MarketBenchmarks";
import { FeeFatigue } from "./FeeFatigue";
import { DEFAULT_FATIGUE } from "@/lib/fee-management/fatigue";

interface MainPayload {
  facts: FeeFacts;
  schedule: DoorBand[];
  raiseFloor: RaiseFloor;
  weights: PriorityWeights;
  agreements: Agreement[];
  campaign: CampaignEntry[];
  feeSchedule: FeeScheduleConfig;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const signedUsd = (n: number) => (Math.round(n) === 0 ? "—" : `${n > 0 ? "+" : "−"}${usd(Math.abs(n))}`);
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const yearAgoIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 365);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
};

function describe(v: FeeValue | null): string {
  if (!v) return "—";
  if (v.basis === "flat") return usd(v.amount);
  if (v.basis === "pct_month") return `${v.amount}% of a month`;
  return `${v.amount}% of spend`;
}

export function FeeSchedule() {
  const [main, setMain] = useState<MainPayload | null>(null);
  const [volumes, setVolumes] = useState<{ volumes: FeeVolumes; capturedAt: string } | null>(null);
  const [draft, setDraft] = useState<FeeScheduleConfig | null>(null);
  const [saved, setSaved] = useState<FeeScheduleConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadVolumes = useCallback(async (refresh = false) => {
    const res = await fetch(`/api/admin/fee-management/volumes${refresh ? "?refresh=1" : ""}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load volumes");
    setVolumes(json);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/fee-management");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not load");
        setMain(json);
        setDraft(json.feeSchedule);
        setSaved(json.feeSchedule);
        await loadVolumes();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load");
      }
    })();
  }, [loadVolumes]);

  // Management fee scenarios + volume context from the same AppFolio facts as the owner rollup.
  const derived = useMemo(() => {
    if (!main || !volumes) return null;
    const { facts } = main;
    const rows = buildOwnerRows({
      facts,
      schedule: main.schedule,
      raiseFloor: main.raiseFloor,
      weights: main.weights,
      agreements: main.agreements,
      campaign: main.campaign,
      today: todayIso(),
    });
    const current = rows.reduce((a, r) => a + r.currentFeesMonthly * 12, 0);
    const mgmt: Record<MgmtScenario, number> = {
      current,
      firstRaise: current + rows.reduce((a, r) => a + r.nextRaiseYearly, 0),
      schedule: current + rows.reduce((a, r) => a + r.addedYearly, 0),
    };
    const yearAgo = yearAgoIso();
    const newProps = facts.properties.filter((p) => p.mgmtStartDate && p.mgmtStartDate >= yearAgo);
    const existingSets = new Set(
      facts.properties.filter((p) => !p.mgmtStartDate || p.mgmtStartDate < yearAgo).map((p) => p.ownerSetKey)
    );
    const occupied = facts.properties.reduce((a, p) => a + p.occupiedDoors, 0);
    const ctx: VolumeContext = {
      newLeases: volumes.volumes.newLeases,
      renewals: volumes.volumes.renewals,
      newProperties: newProps.length,
      newOwners: new Set(newProps.map((p) => p.ownerSetKey).filter((k) => !existingSets.has(k))).size,
      properties: facts.properties.length,
      doors: facts.properties.reduce((a, p) => a + p.doors, 0),
      vendorSpend: volumes.volumes.vendorSpend ?? 0,
      avgMonthlyRent: occupied ? facts.properties.reduce((a, p) => a + p.occupiedRentMonthly, 0) / occupied : 0,
    };
    return { mgmt, ctx, rows };
  }, [main, volumes]);

  const cash = useMemo(() => (draft && derived ? computeCashFlow(draft, derived.ctx, derived.mgmt) : null), [draft, derived]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const updateLine = (id: string, patch: Partial<FeeLine>) =>
    setDraft((d) => d && { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/fee-management/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeSchedule: draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Save failed");
      setSaved(draft);
      toast.success("Fee schedule saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const refreshVolumes = async () => {
    setRefreshing(true);
    try {
      await loadVolumes(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  if (error)
    return <div className="rounded-xl border border-sand-200 p-6 text-sm text-charcoal-600">{error}</div>;
  if (!draft || !cash || !derived) return <div className="h-64 rounded-xl bg-sand-50 animate-pulse" />;

  const { ctx } = derived;

  return (
    <div>
      {/* Summary: current vs proposed at a glance */}
      <div className="grid gap-3 mb-4 lg:grid-cols-[1fr_220px_220px]">
        <CompareCard
          current={{ total: cash.currentYearly, mgmt: cash.mgmt.currentYearly }}
          proposed={{ total: cash.proposedYearly, mgmt: cash.mgmt.proposedYearly }}
        />
        <Stat
          label="Change"
          value={`${signedUsd(cash.deltaYearly)}/yr`}
          sub={`${signedUsd(cash.deltaYearly / 12)}/mo${cash.deltaPct != null ? ` · ${cash.deltaPct >= 0 ? "+" : ""}${cash.deltaPct.toFixed(1)}%` : ""}`}
          tone={cash.deltaYearly > 0 ? "up" : cash.deltaYearly < 0 ? "down" : undefined}
        />
        <Stat
          label="Other fees share"
          value={`${cash.currentYearly ? Math.round(((cash.currentYearly - cash.mgmt.currentYearly) / cash.currentYearly) * 100) : 0}% → ${cash.proposedYearly ? Math.round(((cash.proposedYearly - cash.mgmt.proposedYearly) / cash.proposedYearly) * 100) : 0}%`}
          sub="of fee revenue from fees other than management"
        />
      </div>

      {/* Volumes */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-sand-200 px-4 py-2.5 text-[12px] text-charcoal-500">
        <span className="font-medium text-charcoal-700">Last 12 months</span>
        <span><b className="tabular-nums text-charcoal-900">{ctx.newLeases}</b> new leases</span>
        <span><b className="tabular-nums text-charcoal-900">{ctx.renewals}</b> renewals</span>
        <span><b className="tabular-nums text-charcoal-900">{ctx.newProperties}</b> new properties ({ctx.newOwners} new owners)</span>
        <span><b className="tabular-nums text-charcoal-900">{usd(ctx.vendorSpend)}</b> vendor spend</span>
        <span>avg rent <b className="tabular-nums text-charcoal-900">{usd(ctx.avgMonthlyRent)}</b>/mo</span>
        <span><b className="tabular-nums text-charcoal-900">{ctx.doors}</b> doors · {ctx.properties} properties</span>
        <button onClick={refreshVolumes} disabled={refreshing} className="ml-auto flex items-center gap-1.5 font-medium text-charcoal-600 hover:text-charcoal-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Pulling AppFolio…" : "Refresh"}
        </button>
      </div>

      {/* Fee table */}
      <div className="overflow-x-auto rounded-xl border border-sand-200">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[11px] font-semibold">
              <th colSpan={3} className="bg-white" />
              <th colSpan={2} className={`${CUR_BAND} border-b border-sand-200 px-3 pt-2 pb-1 text-left text-charcoal-600`}>
                Current
              </th>
              <th colSpan={2} className={`${PROP_BAND} border-b border-sky-200 px-3 pt-2 pb-1 text-left text-sky-800`}>
                Proposed
              </th>
              <th colSpan={2} className="bg-white" />
            </tr>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
              <th className="bg-sand-50 py-2 px-3 font-semibold">Fee</th>
              <th className="bg-sand-50 py-2 pr-3 font-semibold">Volume / yr</th>
              <th className="bg-sand-50 py-2 pr-3 font-semibold">Industry</th>
              <th className={`${CUR_BAND} py-2 px-3 font-semibold`}>Fee</th>
              <th className={`${CUR_BAND} py-2 pr-3 font-semibold text-right`}>Per year</th>
              <th className={`${PROP_BAND} py-2 px-3 font-semibold text-sky-800/70`}>Fee</th>
              <th className={`${PROP_BAND} py-2 pr-3 font-semibold text-right text-sky-800/70`}>Per year</th>
              <th className="bg-sand-50 py-2 px-3 font-semibold text-right">Change / yr</th>
              <th className="bg-sand-50 w-8" />
            </tr>
          </thead>
          <tbody>
            {/* Management fee: driven by the Owner Fee Opportunity tab */}
            <tr className="border-b border-sand-200 align-top">
              <td className="py-2.5 px-3">
                <p className="font-medium text-charcoal-900">Management fee</p>
                <p className="text-[11px] text-charcoal-400">% of rent + flat-fee properties · from Owner Fee Opportunity</p>
              </td>
              <td className="py-2.5 pr-3 text-charcoal-500">{ctx.doors} doors</td>
              <td className="py-2.5 pr-3 text-[11.5px] text-charcoal-500">8–10% in Bend; ~8.5% national avg</td>
              <td className={`${CUR_BAND} py-2.5 px-3 text-charcoal-600`}>Current rates</td>
              <td className={`${CUR_BAND} py-2.5 pr-3 text-right tabular-nums text-charcoal-700`}>{usd(cash.mgmt.currentYearly)}</td>
              <td className={`${PROP_BAND} py-2.5 px-3`}>
                <Changed on={draft.mgmtScenario !== "current"}>
                  <select
                    value={draft.mgmtScenario}
                    onChange={(e) => setDraft({ ...draft, mgmtScenario: e.target.value as MgmtScenario })}
                    className="input w-[150px]"
                  >
                    {(Object.keys(MGMT_SCENARIO_LABELS) as MgmtScenario[]).map((k) => (
                      <option key={k} value={k}>{MGMT_SCENARIO_LABELS[k]}</option>
                    ))}
                  </select>
                </Changed>
              </td>
              <td className={`${PROP_BAND} py-2.5 pr-3 text-right tabular-nums font-semibold text-charcoal-900`}>{usd(cash.mgmt.proposedYearly)}</td>
              <td className="py-2.5 px-3 text-right">
                <ChangePill value={cash.mgmt.proposedYearly - cash.mgmt.currentYearly} base={cash.mgmt.currentYearly} />
              </td>
              <td />
            </tr>

            {cash.lines.map(({ line, volume, currentYearly, proposedYearly, typicalYearly, deltaYearly }) => (
              <tr key={line.id} className="border-b border-sand-100 align-top">
                <td className="py-2.5 px-3 max-w-[240px]">
                  {line.custom ? (
                    <input value={line.name} onChange={(e) => updateLine(line.id, { name: e.target.value })} className="input w-full font-medium" />
                  ) : (
                    <p className="font-medium text-charcoal-900">{line.name}</p>
                  )}
                  <p className="mt-0.5 text-[11px] leading-snug text-charcoal-400" title={line.notes}>
                    {line.payer === "tenant" ? "Tenant-paid · " : ""}
                    {line.notes}
                  </p>
                </td>
                <td className="py-2.5 pr-3">
                  <select
                    value={line.volumeSource}
                    onChange={(e) => updateLine(line.id, { volumeSource: e.target.value as VolumeSource, volumeOverride: e.target.value === "manual" ? volume : null })}
                    className="input mb-1 w-[150px]"
                  >
                    {(Object.keys(VOLUME_LABELS) as VolumeSource[]).map((k) => (
                      <option key={k} value={k}>{VOLUME_LABELS[k]}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={line.volumeOverride ?? ""}
                    placeholder={String(Math.round(volume))}
                    onChange={(e) => updateLine(line.id, { volumeOverride: e.target.value === "" ? null : Number(e.target.value) })}
                    title="Leave blank to use the AppFolio figure"
                    className="input w-[150px] tabular-nums"
                  />
                </td>
                <td className="py-2.5 pr-3 max-w-[210px] text-[11.5px] leading-snug text-charcoal-500">
                  {line.industry || "—"}
                  {line.typical && typicalYearly != null && (
                    <button
                      onClick={() => updateLine(line.id, { proposed: { ...line.typical! } })}
                      className="mt-1 block text-[11px] font-medium text-sky-800 underline-offset-2 hover:underline"
                      title="Use this as the proposed fee"
                    >
                      Use {describe(line.typical)} → {usd(typicalYearly)}/yr
                    </button>
                  )}
                </td>
                <td className={`${CUR_BAND} py-2.5 px-3`}>
                  <ValueEditor value={line.current} onChange={(v) => updateLine(line.id, { current: v })} />
                </td>
                <td className={`${CUR_BAND} py-2.5 pr-3 text-right tabular-nums text-charcoal-700`}>{usd(currentYearly)}</td>
                <td className={`${PROP_BAND} py-2.5 px-3`}>
                  <Changed on={!sameValue(line.current, line.proposed)}>
                    <ValueEditor value={line.proposed} onChange={(v) => updateLine(line.id, { proposed: v })} />
                  </Changed>
                </td>
                <td className={`${PROP_BAND} py-2.5 pr-3 text-right tabular-nums font-semibold text-charcoal-900`}>{usd(proposedYearly)}</td>
                <td className="py-2.5 px-3 text-right">
                  <ChangePill value={deltaYearly} base={currentYearly} />
                </td>
                <td className="py-2.5 pr-2">
                  {line.custom && (
                    <button
                      onClick={() => setDraft({ ...draft, lines: draft.lines.filter((l) => l.id !== line.id) })}
                      className="text-charcoal-300 hover:text-red-600"
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}

            <tr className="border-t-2 border-sand-300 font-semibold text-charcoal-900">
              <td className="py-3 px-3">Total fee revenue</td>
              <td colSpan={2} />
              <td className={CUR_BAND} />
              <td className={`${CUR_BAND} py-3 pr-3 text-right tabular-nums`}>{usd(cash.currentYearly)}</td>
              <td className={PROP_BAND} />
              <td className={`${PROP_BAND} py-3 pr-3 text-right tabular-nums`}>{usd(cash.proposedYearly)}</td>
              <td className="py-3 px-3 text-right">
                <ChangePill value={cash.deltaYearly} base={cash.currentYearly} />
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <button
          onClick={() =>
            setDraft({
              ...draft,
              lines: [
                ...draft.lines,
                {
                  id: `custom_${Date.now().toString(36)}`,
                  name: "New fee",
                  payer: "owner",
                  volumeSource: "manual",
                  volumeOverride: 0,
                  current: { basis: "flat", amount: 0 },
                  proposed: { basis: "flat", amount: 0 },
                  industry: "",
                  typical: null,
                  notes: "",
                  custom: true,
                },
              ],
            })
          }
          className="flex h-8 items-center gap-1.5 rounded-md border border-sand-200 bg-white px-2.5 font-medium text-charcoal-700 hover:bg-sand-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add fee
        </button>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[11.5px] text-charcoal-400">Unsaved changes</span>}
          <button
            onClick={() => setDraft(saved)}
            disabled={!dirty}
            className="flex h-8 items-center gap-1.5 rounded-md border border-sand-200 bg-white px-2.5 font-medium text-charcoal-700 hover:bg-sand-50 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Revert
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="h-8 rounded-md bg-charcoal-900 px-3 font-medium text-white hover:bg-charcoal-800 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save fee schedule"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-charcoal-400 leading-relaxed">
        Annual $ = fee × volume. Volumes are the last 12 months from AppFolio ({volumes?.volumes.windowStart} to{" "}
        {volumes?.volumes.windowEnd}): new leases = distinct unit move-ins, renewals = leases renewed, new properties =
        management start dates in the window; vendor spend = outside-vendor maintenance from the maintenance KPI.
        &ldquo;% of a month&rdquo; fees use the average occupied market rent (actual lease rents aren&apos;t on the v0 API).
        Type a number under a volume to override it. Management fee scenarios come from the Owner Fee Opportunity tab&apos;s
        door schedule and raise steps. Industry ranges are 2026 national and Bend, OR published fee guides; check
        Oregon rules before changing tenant-paid fees. Market reference below.
      </p>

      <FeeFatigue
        rows={derived.rows}
        cash={cash}
        ctx={ctx}
        scenario={draft.mgmtScenario}
        assumptions={draft.fatigue ?? DEFAULT_FATIGUE}
        onChange={(fatigue) => setDraft({ ...draft, fatigue })}
        baseline={
          volumes?.volumes.endedProperties != null && volumes.volumes.activeProperties != null
            ? { ended: volumes.volumes.endedProperties, active: volumes.volumes.activeProperties }
            : null
        }
      />

      <MarketBenchmarks />
    </div>
  );
}

function ValueEditor({ value, onChange }: { value: FeeValue; onChange: (v: FeeValue) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <select value={value.basis} onChange={(e) => onChange({ ...value, basis: e.target.value as FeeBasis })} className="input w-[150px]">
        {(Object.keys(BASIS_LABELS) as FeeBasis[]).map((k) => (
          <option key={k} value={k}>{BASIS_LABELS[k]}</option>
        ))}
      </select>
      <div className="relative w-[150px]">
        {value.basis === "flat" && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-charcoal-400">$</span>}
        <input
          type="number"
          min={0}
          step={value.basis === "flat" ? 25 : 5}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)) })}
          className={`input w-full tabular-nums ${value.basis === "flat" ? "pl-5" : "pr-6"}`}
        />
        {value.basis !== "flat" && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-charcoal-400">%</span>}
      </div>
    </div>
  );
}

const CUR_BAND = "bg-sand-50";
const PROP_BAND = "bg-sky-50/70";

const sameValue = (a: FeeValue, b: FeeValue) => a.basis === b.basis && a.amount === b.amount;

/** Amber outline + tag on a proposed value that differs from current. */
function Changed({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="relative inline-block rounded-lg p-1 -m-1 ring-2 ring-amber-400/80 bg-amber-50/60">
      <span className="absolute -top-2 right-1 rounded bg-amber-400 px-1 text-[9px] font-bold uppercase tracking-wider text-white">
        changed
      </span>
      {children}
    </div>
  );
}

/** Green (increase) / red (decrease) pill with $ and % change; gray when unchanged. */
function ChangePill({ value, base }: { value: number; base: number }) {
  if (Math.round(value) === 0) {
    return <span className="inline-block rounded-full bg-sand-100 px-2 py-0.5 text-[11.5px] text-charcoal-400">No change</span>;
  }
  const up = value > 0;
  const pct = base > 0 ? `${up ? "+" : "−"}${Math.abs((value / base) * 100).toFixed(0)}%` : "new";
  return (
    <span
      className={`inline-flex flex-col items-end rounded-lg border px-2 py-1 leading-tight ${
        up ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      <span className="text-[12.5px] font-semibold tabular-nums">{signedUsd(value)}</span>
      <span className="text-[10.5px] font-medium opacity-80">{pct}</span>
    </span>
  );
}

/** Current vs proposed as two stacked bars (management + other fees) on one scale. */
function CompareCard({
  current,
  proposed,
}: {
  current: { total: number; mgmt: number };
  proposed: { total: number; mgmt: number };
}) {
  const max = Math.max(current.total, proposed.total, 1);
  const bar = (v: { total: number; mgmt: number }, tone: "cur" | "prop") => (
    <div className="flex h-3.5 flex-1 overflow-hidden rounded-full bg-sand-100">
      <div
        className={tone === "cur" ? "bg-charcoal-400" : "bg-sky-700"}
        style={{ width: `${(v.mgmt / max) * 100}%` }}
        title={`Management ${usd(v.mgmt)}`}
      />
      <div
        className={tone === "cur" ? "bg-charcoal-200" : "bg-sky-300"}
        style={{ width: `${((v.total - v.mgmt) / max) * 100}%` }}
        title={`Other fees ${usd(v.total - v.mgmt)}`}
      />
    </div>
  );
  return (
    <div className="rounded-xl border border-sand-200 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium text-charcoal-400">Annual fee revenue</p>
        <p className="flex items-center gap-3 text-[10.5px] text-charcoal-400">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-charcoal-400" />management</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-charcoal-200" />other fees</span>
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="w-16 text-[11.5px] font-medium text-charcoal-500">Current</span>
          {bar(current, "cur")}
          <span className="w-36 text-right text-[13px] font-semibold tabular-nums text-charcoal-700">
            {usd(current.total)}
            <span className="ml-1 text-[11px] font-normal text-charcoal-400">/yr</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-16 text-[11.5px] font-semibold text-sky-800">Proposed</span>
          {bar(proposed, "prop")}
          <span className="w-36 text-right text-[13px] font-semibold tabular-nums text-charcoal-950">
            {usd(proposed.total)}
            <span className="ml-1 text-[11px] font-normal text-charcoal-400">/yr</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-sand-200 px-3.5 py-3">
      <p className="text-[11px] font-medium text-charcoal-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === "up" ? "text-green-700" : tone === "down" ? "text-red-600" : "text-charcoal-900"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-charcoal-400">{sub}</p>
    </div>
  );
}
