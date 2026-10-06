"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  buildOwnerRows,
  type Agreement,
  type CampaignEntry,
  type DoorBand,
  type FeeFacts,
  type PriorityWeights,
  type RaiseFloor,
} from "@/lib/fee-management/model";
import { computeCashFlow, type FeeScheduleConfig } from "@/lib/fee-management/fee-schedule";
import type { FeeVolumes } from "@/lib/fee-management/volumes";
import { mgmtScenarios, portfolioFatigue, volumeContext } from "@/lib/fee-management/portfolio";
import { bandImpacts, scheduleError } from "@/lib/fee-management/proposed-structure";

interface MainPayload {
  facts: FeeFacts;
  schedule: DoorBand[];
  raiseFloor: RaiseFloor;
  weights: PriorityWeights;
  agreements: Agreement[];
  campaign: CampaignEntry[];
  feeSchedule: FeeScheduleConfig;
}

interface BandDraft {
  minDoors: string;
  maxDoors: string;
  targetPct: string;
  maxRaisePts: string;
  review: boolean;
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const signedUsd = (n: number) => (Math.round(n) === 0 ? "—" : `${n > 0 ? "+" : "−"}${usd(Math.abs(n))}`);
const pct = (n: number | null, digits = 2) => (n == null ? "—" : `${n.toFixed(digits)}%`);
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

const toDraft = (s: DoorBand[]): BandDraft[] =>
  [...s].sort((a, b) => a.minDoors - b.minDoors).map((b) => ({
    minDoors: String(b.minDoors),
    maxDoors: b.maxDoors == null ? "" : String(b.maxDoors),
    targetPct: String(b.targetPct),
    maxRaisePts: String(b.maxRaisePts),
    review: !!b.review,
  }));

const fromDraft = (d: BandDraft[]): DoorBand[] =>
  d.map((b) => ({
    minDoors: Number(b.minDoors),
    maxDoors: b.maxDoors === "" ? null : Number(b.maxDoors),
    targetPct: Number(b.targetPct),
    maxRaisePts: Number(b.maxRaisePts),
    ...(b.review ? { review: true } : {}),
  }));

/**
 * Proposed Structure: the door-band management fee schedule as an editable
 * table, with what each band would bring in if every owner were moved to the
 * new rate today. Other fees come from the Fee Schedule tab's proposed values.
 */
export function ProposedStructure() {
  const [main, setMain] = useState<MainPayload | null>(null);
  const [volumes, setVolumes] = useState<FeeVolumes | null>(null);
  const [draft, setDraft] = useState<BandDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [res, vol] = await Promise.all([fetch("/api/admin/fee-management"), fetch("/api/admin/fee-management/volumes")]);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not load");
        const volJson = await vol.json();
        if (!vol.ok) throw new Error(volJson.error || "Could not load volumes");
        setMain(json);
        setDraft(toDraft(json.schedule));
        setVolumes(volJson.volumes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load");
      }
    })();
  }, []);

  const schedule = useMemo(() => fromDraft(draft), [draft]);
  const invalid = draft.length ? scheduleError(schedule) : null;
  const dirty = !!main && JSON.stringify(schedule) !== JSON.stringify(fromDraft(toDraft(main.schedule)));

  const result = useMemo(() => {
    if (!main || !volumes || invalid) return null;
    const today = todayIso();
    const rows = buildOwnerRows({
      facts: main.facts,
      schedule,
      raiseFloor: main.raiseFloor,
      weights: main.weights,
      agreements: main.agreements,
      campaign: main.campaign,
      today,
    });
    const ctx = volumeContext(main.facts, volumes, today);
    const impacts = bandImpacts(rows, schedule);
    const cash = computeCashFlow(main.feeSchedule, ctx, mgmtScenarios(rows));
    const otherNow = cash.lines.reduce((a, l) => a + l.currentYearly, 0);
    const otherProposed = cash.lines.reduce((a, l) => a + l.proposedYearly, 0);
    const { fatigue } = portfolioFatigue(rows, { ...main.feeSchedule, mgmtScenario: "schedule" }, ctx);
    return { impacts, otherNow, otherProposed, fatigue, changedFees: cash.lines.filter((l) => Math.round(l.proposedYearly - l.currentYearly) !== 0) };
  }, [main, volumes, schedule, invalid]);

  const update = (i: number, patch: Partial<BandDraft>) => setDraft((d) => d.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const addBand = () =>
    setDraft((d) => {
      const last = d[d.length - 1];
      const start = last ? (last.maxDoors === "" ? Number(last.minDoors) + 1 : Number(last.maxDoors) + 1) : 1;
      const closed = last && last.maxDoors === "" ? [...d.slice(0, -1), { ...last, maxDoors: String(start - 1) }] : d;
      return [...closed, { minDoors: String(start), maxDoors: "", targetPct: last?.targetPct ?? "8", maxRaisePts: last?.maxRaisePts ?? "0.5", review: false }];
    });

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/fee-management/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doorSchedule: schedule }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Save failed");
      setMain((m) => (m ? { ...m, schedule } : m));
      toast.success("Door schedule saved — the Owner Fee Opportunity tab now uses it");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="rounded-xl border border-sand-200 p-6 text-sm text-charcoal-600">{error}</div>;
  if (!main || !volumes) return <div className="rounded-xl border border-sand-200 p-6 text-sm text-charcoal-500">Loading the portfolio…</div>;

  const t = result?.impacts.total;
  const mgmtDelta = t ? t.deltaYearly : 0;
  const otherDelta = result ? result.otherProposed - result.otherNow : 0;
  const totalNow = (t?.currentYearly ?? 0) + (result?.otherNow ?? 0);
  const totalFull = (t?.fullYearly ?? 0) + (result?.otherProposed ?? 0);
  const expectedLoss = result?.fatigue.expectedLoss ?? 0;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-charcoal-600">
        The proposed management fee by portfolio size. Edit any band and the numbers update instantly; <b>Save</b> makes it the
        schedule the Owner Fee Opportunity campaign uses. &ldquo;Fully implemented&rdquo; moves every owner straight to their
        band&apos;s rate today — owners already above it keep their rate.
      </p>

      {/* Headline: what full implementation is worth */}
      {result && t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Management fees / yr" now={t.currentYearly} next={t.fullYearly} />
          <Stat label="Other fees / yr" now={result.otherNow} next={result.otherProposed} note="Proposed values from the Fee Schedule tab" />
          <Stat label="Total fee revenue / yr" now={totalNow} next={totalFull} strong />
          <div className="rounded-xl border border-sand-200 bg-white p-4">
            <p className="text-[11.5px] font-medium text-charcoal-500">After expected churn</p>
            <p className="mt-1 text-xl font-semibold text-charcoal-950">{signedUsd(mgmtDelta + otherDelta - expectedLoss)}</p>
            <p className="mt-0.5 text-[11.5px] text-charcoal-500">
              {usd(expectedLoss)}/yr at risk · ~{result.fatigue.expectedDoorsLost.toFixed(0)} doors could leave (Fee Fatigue model)
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-sand-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand-200 px-4 py-3">
          <p className="text-[13px] font-semibold text-charcoal-900">Door bands — proposed vs today</p>
          <div className="flex items-center gap-2">
            <button onClick={addBand} className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-1.5 text-[12px] hover:bg-sand-50">
              <Plus className="h-3.5 w-3.5" /> Add band
            </button>
            <button
              onClick={() => setDraft(toDraft(main.schedule))}
              disabled={!dirty}
              className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-1.5 text-[12px] hover:bg-sand-50 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Undo edits
            </button>
            <button
              onClick={save}
              disabled={!dirty || !!invalid || saving}
              className="rounded-lg bg-charcoal-900 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </div>
        {invalid && <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">{invalid}</div>}

        <div className="overflow-x-auto">
          <table className="min-w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-sand-200 text-left text-[10.5px] uppercase tracking-wider text-charcoal-400">
                <th className="px-3 py-2 font-semibold">Doors</th>
                <th className="px-3 py-2 font-semibold">Proposed fee %</th>
                <th className="px-3 py-2 font-semibold">Max step</th>
                <th className="px-3 py-2 font-semibold">Review</th>
                <th className="px-3 py-2 text-right font-semibold">Owners</th>
                <th className="px-3 py-2 text-right font-semibold">Doors</th>
                <th className="px-3 py-2 text-right font-semibold">Avg fee today</th>
                <th className="px-3 py-2 text-right font-semibold">Mgmt fees today</th>
                <th className="px-3 py-2 text-right font-semibold">Fully implemented</th>
                <th className="px-3 py-2 text-right font-semibold">Change</th>
                <th className="px-3 py-2 text-right font-semibold">Owners raised</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {draft.map((b, i) => {
                const impact = result?.impacts.bands.find((x) => x.band && x.band.minDoors === Number(b.minDoors));
                return (
                  <tr key={i} className="align-middle">
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <input type="number" min={1} value={b.minDoors} onChange={(e) => update(i, { minDoors: e.target.value })} className="input w-16" aria-label="From doors" />
                      <span className="mx-1 text-charcoal-400">–</span>
                      <input type="number" min={1} value={b.maxDoors} placeholder="up" onChange={(e) => update(i, { maxDoors: e.target.value })} className="input w-16" aria-label="To doors" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" step="0.25" value={b.targetPct} onChange={(e) => update(i, { targetPct: e.target.value })} className="input w-20" aria-label="Proposed fee %" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" step="0.25" value={b.maxRaisePts} onChange={(e) => update(i, { maxRaisePts: e.target.value })} className="input w-20" aria-label="Largest single raise, pts" />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" checked={b.review} onChange={(e) => update(i, { review: e.target.checked })} title="Target is a starting point; these owners get a manual review" />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{impact?.owners ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{impact?.doors ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(impact?.currentPct ?? null)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{impact ? usd(impact.currentYearly) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{impact ? usd(impact.fullYearly) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-emerald-700">
                      {impact ? signedUsd(impact.deltaYearly) : "—"}
                      {impact?.deltaPct ? <span className="ml-1 text-[11px] font-normal text-charcoal-400">({impact.deltaPct.toFixed(1)}%)</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" title={impact?.maxRaises ? `Up to ${impact.maxRaises} raises at the max step` : undefined}>
                      {impact ? `${impact.ownersRaised} of ${impact.owners}` : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} disabled={draft.length <= 1} className="rounded p-1 text-charcoal-400 hover:bg-sand-100 hover:text-rose-600 disabled:opacity-30" aria-label="Remove band">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {result?.impacts.bands.filter((x) => !x.band).map((x) => (
                <tr key={x.key} className="text-amber-800">
                  <td className="px-3 py-1.5" colSpan={4}>{x.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{x.owners}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{x.doors}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pct(x.currentPct)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(x.currentYearly)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(x.fullYearly)}</td>
                  <td colSpan={3} />
                </tr>
              ))}
            </tbody>
            {t && (
              <tfoot>
                <tr className="border-t-2 border-sand-200 font-semibold">
                  <td className="px-3 py-2" colSpan={4}>Portfolio</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.owners}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.doors}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(t.currentPct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(t.currentYearly)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(t.fullYearly)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                    {signedUsd(t.deltaYearly)}
                    {t.deltaPct ? <span className="ml-1 text-[11px] font-normal text-charcoal-400">({t.deltaPct.toFixed(1)}%)</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.ownersRaised} of {t.owners}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-sand-200 bg-white p-4 text-[12.5px] text-charcoal-700">
          <p className="mb-2 font-semibold text-charcoal-900">Other fees (from the Fee Schedule tab)</p>
          {result.changedFees.length === 0 ? (
            <p className="text-charcoal-500">No other fee changes are proposed yet. Set proposed amounts in the Fee Schedule tab and they&apos;ll show here.</p>
          ) : (
            <ul className="space-y-1">
              {result.changedFees.map((l) => (
                <li key={l.line.id} className="flex justify-between gap-4">
                  <span>{l.line.name}</span>
                  <span className="tabular-nums">{usd(l.currentYearly)} → {usd(l.proposedYearly)} <span className="text-emerald-700">({signedUsd(l.proposedYearly - l.currentYearly)})</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, now, next, note, strong }: { label: string; now: number; next: number; note?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${strong ? "border-charcoal-300 bg-sand-50" : "border-sand-200 bg-white"}`}>
      <p className="text-[11.5px] font-medium text-charcoal-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-charcoal-950">{usd(next)}</p>
      <p className="mt-0.5 text-[11.5px] text-charcoal-500">
        today {usd(now)} · <span className="text-emerald-700">{signedUsd(next - now)}</span>
      </p>
      {note && <p className="mt-1 text-[10.5px] text-charcoal-400">{note}</p>}
    </div>
  );
}
