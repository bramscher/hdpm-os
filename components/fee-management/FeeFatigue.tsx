"use client";

import type { FatigueAssumptions, FatigueResult } from "@/lib/fee-management/fatigue";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const BAND_COLORS = ["hsl(142 60% 38%)", "hsl(45 90% 45%)", "hsl(25 90% 50%)", "hsl(0 85% 50%)"];

/**
 * Fee fatigue & churn: nets expected owner losses from the proposed fee
 * changes against the gross gain, and shows the "do more with fewer doors"
 * effect via revenue per door.
 */
export function FeeFatigue({
  result,
  newFeeTypes,
  ownerCount,
  assumptions,
  onChange,
  baseline,
}: {
  result: FatigueResult;
  newFeeTypes: number;
  ownerCount: number;
  assumptions: FatigueAssumptions;
  onChange: (a: FatigueAssumptions) => void;
  baseline: { ended: number; active: number } | null;
}) {
  const baselinePct = baseline && baseline.active + baseline.ended > 0 ? (baseline.ended / (baseline.active + baseline.ended)) * 100 : null;
  const lossShare = result.grossGain > 0 ? Math.min(100, (result.expectedLoss / result.grossGain) * 100) : 0;
  const setA = (k: keyof FatigueAssumptions, v: string) => onChange({ ...assumptions, [k]: v === "" ? 0 : Math.max(0, Number(v)) });

  return (
    <section id="fee-fatigue" className="mt-8 scroll-mt-6">
      <h2 className="text-[15px] font-semibold text-charcoal-900">Fee fatigue &amp; churn</h2>
      <p className="mb-3 max-w-3xl text-[12px] text-charcoal-500">
        Raising fees costs some owners&apos; goodwill. Each owner gets a 0–100 fatigue score from how much their total fees rise and
        how many new fee types they start paying; fatigue adds to the chance they leave within a year, and their fees leave with them.
      </p>

      {result.grossGain <= 0 ? (
        <p className="rounded-xl border border-sand-200 p-4 text-[12.5px] text-charcoal-500">
          No fee increase proposed yet. Change a proposed fee above to see the churn offset.
        </p>
      ) : (
        <>
          {/* Gross → loss → net */}
          <div className="mb-4 rounded-xl border border-sand-200 p-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Figure label="Gross gain" value={`+${usd(result.grossGain)}`} sub="/yr, before churn" tone="up" />
              <Figure
                label="Expected churn loss"
                value={`−${usd(result.expectedLoss)}`}
                sub={`~${result.expectedDoorsLost.toFixed(1)} doors · ~${result.expectedOwnersLost.toFixed(1)} owners`}
                tone="down"
              />
              <Figure label="Net gain" value={`${result.netGain >= 0 ? "+" : "−"}${usd(Math.abs(result.netGain))}`} sub="/yr after churn" tone={result.netGain >= 0 ? "up" : "down"} strong />
              <Figure
                label="Break-even"
                value={`${Math.floor(result.breakEvenDoors)} doors`}
                sub={`could leave (${result.doors ? ((result.breakEvenDoors / result.doors) * 100).toFixed(0) : 0}% of doors) before this loses money`}
              />
            </div>
            <div className="mt-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-sand-100">
                <div className="bg-green-600" style={{ width: `${100 - lossShare}%` }} title="Kept after churn" />
                <div className="bg-red-500" style={{ width: `${lossShare}%` }} title="Lost to churn" />
              </div>
              <p className="mt-1 text-[11px] text-charcoal-400">
                {lossShare.toFixed(0)}% of the gross gain is expected to walk out the door; {(100 - lossShare).toFixed(0)}% is kept.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            {/* Do more with less */}
            <div className="rounded-xl border border-sand-200 p-4">
              <p className="mb-2 text-[13px] font-semibold text-charcoal-800">Do more with fewer doors</p>
              <div className="grid grid-cols-3 gap-3 text-[12px]">
                <Mini label="Revenue per door" before={usd(result.revPerDoorNow)} after={usd(result.revPerDoorAfter)} />
                <Mini label="Doors managed" before={result.doors.toLocaleString()} after={Math.round(result.doors - result.expectedDoorsLost).toLocaleString()} />
                <Mini
                  label="Doors for today's revenue"
                  before={result.doors.toLocaleString()}
                  after={Math.ceil(result.doorsForTodaysRevenue).toLocaleString()}
                />
              </div>
              <p className="mt-3 text-[11.5px] leading-snug text-charcoal-500">
                At the new revenue per door, today&apos;s fee revenue takes{" "}
                <b className="text-charcoal-900">{Math.max(0, result.doors - Math.ceil(result.doorsForTodaysRevenue))} fewer doors</b>. That&apos;s
                capacity to grow without adding staff, or room to part ways with the hardest-to-serve accounts.
              </p>
            </div>

            {/* Fatigue distribution */}
            <div className="rounded-xl border border-sand-200 p-4">
              <p className="mb-2 text-[13px] font-semibold text-charcoal-800">Owners by fatigue</p>
              <div className="mb-2 flex h-3 overflow-hidden rounded-full bg-sand-100">
                {result.bands.map((b, i) => (
                  <div key={b.label} style={{ width: `${ownerCount ? (b.owners / ownerCount) * 100 : 0}%`, background: BAND_COLORS[i] }} title={`${b.label}: ${b.owners} owners`} />
                ))}
              </div>
              <table className="w-full text-[12px]">
                <tbody>
                  {result.bands.map((b, i) => (
                    <tr key={b.label} className="border-b border-sand-100 last:border-0">
                      <td className="py-1">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: BAND_COLORS[i] }} />
                        {b.label} <span className="text-charcoal-400">({b.min}–{Math.min(b.max, 100)})</span>
                      </td>
                      <td className="py-1 text-right tabular-nums">{b.owners} owners</td>
                      <td className="py-1 text-right tabular-nums text-charcoal-500">{b.doors} doors</td>
                      <td className="py-1 text-right tabular-nums text-red-600">{b.expectedLoss > 0 ? `−${usd(b.expectedLoss)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Most at risk */}
          <div className="mt-4 rounded-xl border border-sand-200 p-4">
            <p className="mb-2 text-[13px] font-semibold text-charcoal-800">Most at risk: call these before the change lands</p>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
                  <th className="py-1.5 pr-3 font-semibold">Owner</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Doors</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Fees now → proposed</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Increase</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Fatigue</th>
                  <th className="py-1.5 font-semibold text-right">Expected loss</th>
                </tr>
              </thead>
              <tbody>
                {result.owners.slice(0, 10).map((o) => (
                  <tr key={o.key} className="border-b border-sand-100 last:border-0">
                    <td className="py-1.5 pr-3 max-w-[260px] truncate font-medium text-charcoal-900" title={o.name}>{o.name}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{o.doors}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-charcoal-600">{usd(o.currentYearly)} → {usd(o.proposedYearly)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">+{o.increasePct.toFixed(0)}%</td>
                    <td className="py-1.5 pr-3 text-right">
                      <span
                        className="inline-block min-w-[34px] rounded px-1.5 text-center text-[11px] font-semibold tabular-nums text-white"
                        style={{ background: BAND_COLORS[Math.min(3, Math.floor(o.fatigue / 25))] }}
                      >
                        {o.fatigue}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-red-600">−{usd(o.expectedLoss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Assumptions */}
      <div className="mt-4 rounded-xl border border-dashed border-sand-300 p-4 text-[12px] text-charcoal-600">
        <p className="mb-2 font-semibold text-charcoal-800">Assumptions (saved with the fee schedule)</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2">
            Full fatigue at a
            <input type="number" min={1} value={assumptions.fullFatigueAtPct} onChange={(e) => setA("fullFatigueAtPct", e.target.value)} className="input w-16" />
            % fee increase
          </label>
          <label className="flex items-center gap-2">
            +
            <input type="number" min={0} value={assumptions.pointsPerNewFee} onChange={(e) => setA("pointsPerNewFee", e.target.value)} className="input w-14" />
            fatigue pts per new fee type ({newFeeTypes} proposed)
          </label>
          <label className="flex items-center gap-2">
            Full fatigue adds
            <input type="number" min={0} step={1} value={assumptions.maxAddedChurnPts} onChange={(e) => setA("maxAddedChurnPts", e.target.value)} className="input w-14" />
            pts of annual churn
          </label>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-charcoal-400">
          Baseline owner churn:{" "}
          {baselinePct != null ? (
            <>HDPM <b className="text-charcoal-600">{baselinePct.toFixed(1)}%</b> of properties ended management in the last 12 months ({baseline!.ended} of {baseline!.active + baseline!.ended}, AppFolio)</>
          ) : (
            <>refresh the volumes above to load HDPM&apos;s own rate</>
          )}
          ; industry sources cite ~20% average annual owner churn and ~10% for top firms. That churn happens anyway, so only the
          fee-driven <i>extra</i> churn is counted here. There is no published data on how owners react to fee increases, so the three
          inputs above are judgment calls: tune them to your experience. The break-even figure needs no assumptions. Other fees are
          spread across owners per door; expected loss assumes a departing owner&apos;s full proposed fees for the year.
        </p>
      </div>
    </section>
  );
}

function Figure({ label, value, sub, tone, strong }: { label: string; value: string; sub: string; tone?: "up" | "down"; strong?: boolean }) {
  const color = tone === "up" ? "text-green-700" : tone === "down" ? "text-red-600" : "text-charcoal-900";
  return (
    <div className={strong ? "rounded-lg bg-sand-50 px-3 py-2 -my-2" : ""}>
      <p className="text-[11px] font-medium text-charcoal-400">{label}</p>
      <p className={`mt-0.5 tabular-nums ${strong ? "text-xl" : "text-lg"} font-semibold ${color}`}>{value}</p>
      <p className="text-[11px] text-charcoal-400">{sub}</p>
    </div>
  );
}

function Mini({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div>
      <p className="text-[11px] text-charcoal-400">{label}</p>
      <p className="mt-0.5 tabular-nums text-charcoal-500">{before}</p>
      <p className="tabular-nums text-[14px] font-semibold text-charcoal-900">→ {after}</p>
    </div>
  );
}
