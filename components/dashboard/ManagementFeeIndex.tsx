"use client";

import { useEffect, useMemo, useState } from "react";
import { Receipt, RefreshCw } from "lucide-react";

// Mirrors ManagementFeeIndex in lib/appfolio-kpi.ts (kept local so this
// client component doesn't import the server-only KPI module).
interface FeeTier {
  pct: number;
  properties: number;
  doors: number;
  occupiedDoors: number;
  annualRentBase: number;
  annualFees: number;
}

interface FeeIndex {
  tiers: FeeTier[];
  flat: { properties: number; doors: number; annualFees: number };
  noPolicy: { properties: number; doors: number };
  doorWeightedAvgPct: number | null;
  effectiveRatePct: number | null;
}

export interface ManagementFeesSnapshot {
  totalProperties: number;
  avgFeePct?: number | null;
  estAnnualFeeRevenue?: number | null;
  feeIndex?: FeeIndex;
}

interface FeeRange {
  label: string;
  rates: number[];
  properties: number;
  doors: number;
  occupiedDoors: number;
  annualRentBase: number;
  annualFees: number;
}

const RAISE_STEPS = [0.25, 0.5, 0.75, 1];

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pctFmt = (n: number, digits = 2) => `${Number(n.toFixed(digits))}%`;

/** Whole-point ranges: 8% and 8.5% both land in "8–8.99%". */
function toRanges(tiers: FeeTier[]): FeeRange[] {
  const byFloor = new Map<number, FeeRange>();
  for (const t of tiers) {
    const floor = Math.floor(t.pct);
    const r = byFloor.get(floor) ?? {
      label: `${floor}–${floor}.99%`,
      rates: [],
      properties: 0,
      doors: 0,
      occupiedDoors: 0,
      annualRentBase: 0,
      annualFees: 0,
    };
    r.rates.push(t.pct);
    r.properties += t.properties;
    r.doors += t.doors;
    r.occupiedDoors += t.occupiedDoors;
    r.annualRentBase += t.annualRentBase;
    r.annualFees += t.annualFees;
    byFloor.set(floor, r);
  }
  return [...byFloor.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

/**
 * Admin-only Management Fee Index: doors per fee-% range, estimated fee
 * dollars, and what raising the average (or setting a floor) would add.
 * Pass `data` when the parent already holds the management_fees KPI;
 * omit it and the panel loads the latest snapshot itself.
 */
export function ManagementFeeIndex({
  data: dataProp,
  loading: parentLoading = false,
}: {
  data?: ManagementFeesSnapshot | null;
  loading?: boolean;
}) {
  const selfLoading = dataProp === undefined;
  const [fetched, setFetched] = useState<ManagementFeesSnapshot | null>(null);
  const [ownLoading, setLoading] = useState(selfLoading);
  const loading = ownLoading || parentLoading;
  const [refreshing, setRefreshing] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  useEffect(() => {
    if (!selfLoading) return;
    fetch("/api/kpi/cached")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setFetched((c?.management_fees?.value as ManagementFeesSnapshot) ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selfLoading]);

  const refreshLive = async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/kpi/management-fees");
      if (r.ok) setFetched(await r.json());
    } finally {
      setRefreshing(false);
    }
  };

  // A live refresh here wins over whatever the parent passed in.
  const data = fetched ?? dataProp ?? null;
  const idx = data?.feeIndex;

  const model = useMemo(() => {
    if (!idx || idx.tiers.length === 0) return null;
    const ranges = toRanges(idx.tiers);
    const pctDoors = ranges.reduce((a, r) => a + r.doors, 0);
    const rentBase = ranges.reduce((a, r) => a + r.annualRentBase, 0);
    const pctFees = ranges.reduce((a, r) => a + r.annualFees, 0);
    const totalDoors = pctDoors + idx.flat.doors + idx.noPolicy.doors;
    const effective = idx.effectiveRatePct ?? (rentBase ? (pctFees / rentBase) * 100 : 0);

    const raises = RAISE_STEPS.map((step) => ({
      step,
      newAvg: effective + step,
      added: rentBase * (step / 100),
    }));

    // Floors: every whole % above the lowest rate, up to the highest rate.
    const minPct = idx.tiers[0].pct;
    const maxPct = idx.tiers[idx.tiers.length - 1].pct;
    const floors: { floor: number; doors: number; properties: number; added: number }[] = [];
    for (let f = Math.floor(minPct) + 1; f <= Math.ceil(maxPct) && floors.length < 5; f++) {
      let doors = 0;
      let properties = 0;
      let added = 0;
      for (const t of idx.tiers) {
        if (t.pct >= f) continue;
        doors += t.doors;
        properties += t.properties;
        added += t.annualRentBase * ((f - t.pct) / 100);
      }
      if (doors > 0) floors.push({ floor: f, doors, properties, added });
    }

    return { ranges, pctDoors, rentBase, pctFees, totalDoors, effective, raises, floors };
  }, [idx]);

  const target = parseFloat(targetInput);
  const custom =
    model && Number.isFinite(target) && target > 0
      ? { delta: target - model.effective, added: model.rentBase * ((target - model.effective) / 100) }
      : null;

  return (
    <div id="mgmt-fee-index" className="bg-white rounded-2xl border border-sand-200 shadow-card px-5 py-5 mb-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-charcoal-900">Management Fee Index</p>
            <p className="text-[12px] text-charcoal-400">
              Doors by fee-% range · estimated fees on occupied market rent · admin only
            </p>
          </div>
        </div>
        <button
          onClick={refreshLive}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-charcoal-600 bg-white border border-sand-200 rounded-lg hover:bg-sand-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Pulling AppFolio…" : "Refresh live"}
        </button>
      </div>

      {loading && !data ? (
        <div className="h-40 rounded-xl bg-sand-50 animate-pulse" />
      ) : !model ? (
        <p className="text-sm text-charcoal-500 py-6">
          No door-level fee data in the latest snapshot yet. Click <strong>Refresh live</strong> to pull
          it from AppFolio (takes up to a minute); the daily cron keeps it current after that.
        </p>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
            <Stat label="Doors on % fee" value={model.pctDoors.toLocaleString()} sub={`of ${model.totalDoors.toLocaleString()} total doors`} />
            <Stat
              label="Avg fee (per property)"
              value={data?.avgFeePct != null ? pctFmt(data.avgFeePct) : "—"}
              sub={`${model.ranges.reduce((a, r) => a + r.properties, 0)} properties`}
            />
            <Stat
              label="Avg fee (per door)"
              value={idx?.doorWeightedAvgPct != null ? pctFmt(idx.doorWeightedAvgPct) : "—"}
              sub={`effective ${pctFmt(model.effective)} of rent`}
            />
            <Stat label="Est. annual % fees" value={usd(model.pctFees)} sub={`${usd(model.pctFees / 12)}/mo`} />
            <Stat
              label="Flat / no policy"
              value={`${idx!.flat.doors} / ${idx!.noPolicy.doors}`}
              sub={`doors · flat ${usd(idx!.flat.annualFees)}/yr`}
            />
          </div>

          {/* Range table */}
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
                  <th className="py-2 pr-3 font-semibold">Fee range</th>
                  <th className="py-2 pr-3 font-semibold">Rates</th>
                  <th className="py-2 pr-3 font-semibold text-right">Properties</th>
                  <th className="py-2 pr-3 font-semibold text-right">Doors</th>
                  <th className="py-2 pr-3 font-semibold w-[22%]">Share of doors</th>
                  <th className="py-2 pr-3 font-semibold text-right">Occupied</th>
                  <th className="py-2 pr-3 font-semibold text-right">Est. fees / mo</th>
                  <th className="py-2 pr-3 font-semibold text-right">Est. fees / yr</th>
                  <th className="py-2 font-semibold text-right">Fee / occ. door / mo</th>
                </tr>
              </thead>
              <tbody>
                {model.ranges.map((r) => {
                  const share = model.pctDoors ? (r.doors / model.pctDoors) * 100 : 0;
                  return (
                    <tr key={r.label} className="border-b border-sand-100">
                      <td className="py-2 pr-3 font-semibold text-charcoal-800">{r.label}</td>
                      <td className="py-2 pr-3 text-charcoal-500">{r.rates.map((p) => `${p}%`).join(", ")}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.properties}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">{r.doors}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 flex-1 rounded bg-sand-100 overflow-hidden">
                            <div className="h-full rounded bg-violet-500" style={{ width: `${Math.max(1, share)}%` }} />
                          </div>
                          <span className="w-10 text-right tabular-nums text-charcoal-400">{Math.round(share)}%</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.occupiedDoors}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{usd(r.annualFees / 12)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">{usd(r.annualFees)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.occupiedDoors ? usd(r.annualFees / 12 / r.occupiedDoors) : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-semibold text-charcoal-900">
                  <td className="py-2 pr-3">All % fees</td>
                  <td className="py-2 pr-3 text-charcoal-500 font-normal">effective {pctFmt(model.effective)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {model.ranges.reduce((a, r) => a + r.properties, 0)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{model.pctDoors}</td>
                  <td className="py-2 pr-3" />
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {model.ranges.reduce((a, r) => a + r.occupiedDoors, 0)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(model.pctFees / 12)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(model.pctFees)}</td>
                  <td className="py-2" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Potential revenue */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <p className="text-[13px] font-semibold text-charcoal-700 mb-1">Raise the average</p>
              <p className="text-[11.5px] text-charcoal-400 mb-2">
                Every % door up by the same step, vs. today&apos;s effective {pctFmt(model.effective)}.
              </p>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
                    <th className="py-1.5 pr-3 font-semibold">Increase</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">New avg</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Added / mo</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Added / yr</th>
                    <th className="py-1.5 font-semibold text-right">Lift</th>
                  </tr>
                </thead>
                <tbody>
                  {model.raises.map((s) => (
                    <tr key={s.step} className="border-b border-sand-100">
                      <td className="py-1.5 pr-3">+{s.step} pts</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{pctFmt(s.newAvg)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{usd(s.added / 12)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-green-700">+{usd(s.added)}</td>
                      <td className="py-1.5 text-right tabular-nums text-charcoal-500">
                        +{model.pctFees ? Math.round((s.added / model.pctFees) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                <label htmlFor="fee-target" className="text-charcoal-600">Target average</label>
                <input
                  id="fee-target"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={model.effective.toFixed(2)}
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  className="w-20 rounded-md border border-sand-200 px-2 py-1 tabular-nums"
                />
                <span className="text-charcoal-400">%</span>
                {custom && (
                  <span className={`font-semibold ${custom.added >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {custom.added >= 0 ? "+" : "−"}
                    {usd(Math.abs(custom.added))}/yr ({custom.delta >= 0 ? "+" : ""}
                    {custom.delta.toFixed(2)} pts)
                  </span>
                )}
              </div>
            </div>

            <div>
              <p className="text-[13px] font-semibold text-charcoal-700 mb-1">Set a minimum fee</p>
              <p className="text-[11.5px] text-charcoal-400 mb-2">
                Only doors below the floor move up to it; higher-rate doors are unchanged.
              </p>
              {model.floors.length === 0 ? (
                <p className="text-[12.5px] text-charcoal-500">All % doors are already at one rate.</p>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
                      <th className="py-1.5 pr-3 font-semibold">Floor</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">Doors moved</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">New avg</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">Added / mo</th>
                      <th className="py-1.5 font-semibold text-right">Added / yr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.floors.map((f) => (
                      <tr key={f.floor} className="border-b border-sand-100">
                        <td className="py-1.5 pr-3">{f.floor}% min</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {f.doors} <span className="text-charcoal-400">({f.properties} props)</span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {model.rentBase ? pctFmt(((model.pctFees + f.added) / model.rentBase) * 100) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{usd(f.added / 12)}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-green-700">+{usd(f.added)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <p className="mt-4 text-[11px] text-charcoal-400 leading-relaxed">
            Estimates use AppFolio market rent on occupied revenue units (actual lease rents aren&apos;t on the
            v0 API), so vacant doors add nothing until leased. &ldquo;Effective&rdquo; = total % fees ÷ total
            rent base, the rate you actually earn; per-property and per-door averages ignore rent size.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-sand-50/50 px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">{label}</p>
      <p className="text-xl font-bold text-charcoal-900 tabular-nums mt-0.5">{value}</p>
      <p className="text-[11px] text-charcoal-400 mt-0.5">{sub}</p>
    </div>
  );
}
