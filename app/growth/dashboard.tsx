"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Columns3 } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { SOURCE_LABELS } from "@/lib/growth/lead-api";
import type { GrowthSummary } from "@/lib/growth/data";

const GRID_PROPS = { strokeDasharray: "3 3", stroke: "rgba(0,0,0,0.05)", vertical: false };
const X_TICK = { fontSize: 12, fill: "#6b7280" };
const Y_TICK = { fontSize: 11, fill: "#9ca3af" };
const TOOLTIP_STYLE = { backgroundColor: "rgba(255,255,255,0.95)", border: "1px solid #e7e0d5", borderRadius: 12, fontSize: 12 };
const SOURCE_COLORS = ["#c2410c", "#0f766e", "#2563eb", "#a16207", "#7c3aed", "#be123c", "#4d7c0f", "#475569", "#0891b2"];

const fmtDay = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtMonth = (m: string) => {
  const d = new Date(`${m.slice(0, 7)}-15T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} '${String(d.getUTCFullYear()).slice(2)}`;
};
const fmtLong = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function Panel({ title, note, error, children, className = "" }: { title: string; note?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-sand-200 bg-white p-5 shadow-card ${className}`}>
      <h2 className="text-sm font-semibold text-charcoal-700">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-charcoal-500">{note}</p>}
      <div className="mt-4">{error ? <p className="rounded-md bg-sand-100 p-3 text-sm text-charcoal-700">Couldn&apos;t load: {error}</p> : children}</div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-sand-200 bg-white p-4 shadow-card">
      <p className="text-xs font-medium text-charcoal-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-charcoal-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-charcoal-500">{sub}</p>}
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-8 text-center text-sm text-charcoal-500">{children}</p>;

export function GrowthDashboard() {
  const [data, setData] = useState<GrowthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/growth/summary");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the dashboard");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const s = data?.settings;
  return (
    <PageContainer width="full" className="max-w-[1400px] mx-auto">
      <PageHeader
        title="Owner growth"
        description={s ? `Goal: +${s.targetNetDoors} net doors from ${fmtLong(s.startDate)} to ${fmtLong(s.endDate)} (${s.monthlyPace} a month).` : "Net doors against the goal, and the owner pipeline."}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/growth/pipeline"><Columns3 className="mr-1.5 h-3.5 w-3.5" /> Pipeline board</Link>
          </Button>
        }
      />

      {error ? (
        <p role="alert" className="rounded-lg bg-sand-100 p-4 text-sm text-charcoal-700">
          {error} <button className="underline" onClick={load}>Try again</button>
        </p>
      ) : !data || !s ? (
        <p className="text-sm text-charcoal-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Net doors since start"
              value={data.doors?.netSinceStart != null ? signed(data.doors.netSinceStart) : "—"}
              sub={data.doors?.baselineDoors != null ? `Baseline ${data.doors.baselineDoors} doors (${fmtDay(data.doors.baselineAt!)})` : "Waiting for the first door snapshot"}
            />
            <Stat
              label="Current doors"
              value={data.doors?.currentDoors ?? "—"}
              sub={`Goal ${data.doors?.baselineDoors != null ? data.doors.baselineDoors + s.targetNetDoors : `+${s.targetNetDoors}`}`}
            />
            <Stat
              label="Weighted open pipeline"
              value={data.pipeline ? `${data.pipeline.openWeightedDoors} doors` : "—"}
              sub={data.pipeline ? `${data.pipeline.totalLeads} owner leads on the board` : undefined}
            />
            <Stat
              label="Signed (on the board)"
              value={data.pipeline ? `${data.pipeline.stages.find((x) => x.key === "signed")?.doors ?? 0} doors` : "—"}
              sub={data.pipeline ? `${data.pipeline.stages.find((x) => x.key === "signed")?.leads ?? 0} leads` : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Net doors vs. goal"
              note={`Actual net doors since ${fmtDay(s.startDate)} against the pace line (${s.monthlyPace} a month to +${s.targetNetDoors}).`}
              error={data.errors.doors}
            >
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.doors?.series ?? []} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={X_TICK} minTickGap={24} />
                    <YAxis tick={Y_TICK} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(s.targetNetDoors, max)]} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d) => fmtDay(String(d))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={s.targetNetDoors} stroke="#d97706" strokeDasharray="6 4" />
                    <Line name="Pace" dataKey="pace" stroke="#9ca3af" strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                    <Line name="Actual" dataKey="actual" stroke="#c2410c" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Doors gained and lost by month" note="From daily door rosters (door-movement KPI)." error={data.errors.movement}>
              {data.movement?.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.movement.map((m) => ({ ...m, lostNeg: -m.lost }))} margin={{ top: 5, right: 5, left: -20, bottom: 0 }} stackOffset="sign">
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="month" tickFormatter={fmtMonth} tick={X_TICK} />
                      <YAxis tick={Y_TICK} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(m) => fmtMonth(String(m))} formatter={(v, name) => [Math.abs(Number(v)), name]} />
                      <ReferenceLine y={0} stroke="#d6d3d1" />
                      <Bar name="Gained" dataKey="gained" stackId="m" fill="#0f766e" />
                      <Bar name="Lost" dataKey="lostNeg" stackId="m" fill="#be123c" />
                      <Line name="Net" dataKey="net" stroke="#1f2937" dot={{ r: 2 }} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty>Needs door rosters from two different days.</Empty>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Pipeline doors by stage" note="Expected doors on owner leads, raw and weighted by each stage's chance of signing (STAGE_WEIGHTS in lib/growth/config.ts)." error={data.errors.pipeline}>
              {data.pipeline && (
                <>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.pipeline.stages} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="label" tick={{ ...X_TICK, fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis tick={Y_TICK} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar name="Expected doors" dataKey="doors" fill="#e7c9b5" />
                        <Bar name="Weighted doors" dataKey="weightedDoors" fill="#c2410c" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {data.pipeline.truncated && <p className="mt-2 text-xs text-amber-700">The website capped the feed at the newest 1,000 owner leads.</p>}
                </>
              )}
            </Panel>

            <Panel title="Funnel" note="Leads now at each stage or past it (a lost lead counts only toward New), and how long current leads have sat in it." error={data.errors.pipeline}>
              {data.pipeline && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-charcoal-500">
                      <th className="pb-2 font-medium">Stage</th>
                      <th className="pb-2 text-right font-medium">Reached</th>
                      <th className="pb-2 text-right font-medium">From previous</th>
                      <th className="pb-2 text-right font-medium">Median days in stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-100">
                    {data.pipeline.funnel.map((f) => (
                      <tr key={f.key}>
                        <td className="py-1.5 text-charcoal-800">{f.label}</td>
                        <td className="py-1.5 text-right tabular-nums">{f.reached}</td>
                        <td className="py-1.5 text-right tabular-nums text-charcoal-600">{f.conversionPct == null ? "—" : `${f.conversionPct}%`}</td>
                        <td className="py-1.5 text-right tabular-nums text-charcoal-600">{f.medianDaysInStage ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Owner leads by source" note="Owner leads on the board, by the month they came in." error={data.errors.pipeline}>
              {data.pipeline?.bySource.rows.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.pipeline.bySource.rows} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="month" tickFormatter={fmtMonth} tick={X_TICK} />
                      <YAxis tick={Y_TICK} allowDecimals={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(m) => fmtMonth(String(m))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {data.pipeline.bySource.sources.map((src, i) => (
                        <Bar key={src} name={SOURCE_LABELS[src] ?? src} dataKey={src} stackId="s" fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty>No owner leads yet.</Empty>
              )}
            </Panel>

            <Panel title="Owner churn" note={`Owner cancellations in the last 30 days × 12 ÷ current owners (owner-retention KPI), against ${s.churnTargetPct}% a year.`} error={data.errors.churn}>
              {data.churn?.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.churn} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="date" tickFormatter={fmtDay} tick={X_TICK} minTickGap={24} />
                      <YAxis tick={Y_TICK} unit="%" domain={[0, (max: number) => Math.max(s.churnTargetPct * 1.5, max)]} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => [`${v}%`, "Yearly churn"]} />
                      <ReferenceLine y={s.churnTargetPct} stroke="#d97706" strokeDasharray="6 4" label={{ value: `${s.churnTargetPct}%`, fontSize: 11, fill: "#b45309", position: "right" }} />
                      <Line dataKey="annualizedPct" stroke="#be123c" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty>No owner-retention snapshots yet.</Empty>
              )}
            </Panel>

            <Panel title="Partner leaderboard" note="Referral partners by signed doors (partner portal referrals)." error={data.errors.leaderboard}>
              {data.leaderboard?.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-charcoal-500">
                      <th className="pb-2 font-medium">Partner</th>
                      <th className="pb-2 text-right font-medium">Leads</th>
                      <th className="pb-2 text-right font-medium">Signed</th>
                      <th className="pb-2 text-right font-medium">Doors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-100">
                    {data.leaderboard.map((p) => (
                      <tr key={p.partnerId}>
                        <td className="py-1.5 text-charcoal-800">{p.name}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.leads}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.signedLeads}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums">{p.doors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>No partner referrals yet.</Empty>
              )}
            </Panel>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
