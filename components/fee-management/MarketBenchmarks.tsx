"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  BENCHMARK_CHECKED,
  BENCHMARK_REGIONS,
  OREGON_FEE_LAW,
  type BenchmarkCompany,
  type RegionKey,
} from "@/lib/fee-management/market-benchmarks";

const FEE_COLS: { key: keyof BenchmarkCompany; label: string }[] = [
  { key: "mgmtFee", label: "Management" },
  { key: "leasingFee", label: "Leasing" },
  { key: "renewalFee", label: "Renewal" },
  { key: "setupFee", label: "Setup" },
  { key: "maintenanceMarkup", label: "Maint. markup" },
  { key: "otherFees", label: "Other" },
];

const SUMMARY_ROWS: { key: "mgmtFee" | "leasingFee" | "renewalFee" | "setupFee" | "maintenanceMarkup" | "other"; label: string }[] = [
  { key: "mgmtFee", label: "Management fee" },
  { key: "leasingFee", label: "Leasing / placement" },
  { key: "renewalFee", label: "Lease renewal" },
  { key: "setupFee", label: "Owner / property setup" },
  { key: "maintenanceMarkup", label: "Maintenance markup" },
  { key: "other", label: "Other common fees" },
];

/** Market reference: published fee schedules from Central Oregon, Oregon and PNW managers. Static, dated research. */
export function MarketBenchmarks() {
  const [region, setRegion] = useState<"all" | RegionKey>("all");
  const companies = BENCHMARK_REGIONS.flatMap((r) => r.companies.map((c) => ({ ...c, regionLabel: r.label, regionKey: r.key })));
  const shown = region === "all" ? companies : companies.filter((c) => c.regionKey === region);

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-charcoal-900">Market reference</h2>
          <p className="text-[12px] text-charcoal-500">
            Published residential fee schedules from property managers in Central Oregon, the rest of Oregon, and the PNW.
            Researched {BENCHMARK_CHECKED}; fees change, so follow the source link before quoting one.
          </p>
        </div>
      </div>

      {/* Regional summary */}
      <div className="mb-6 overflow-x-auto rounded-xl border border-sand-200">
        <table className="w-full text-[12.5px]">
          <thead className="bg-sand-50">
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
              <th className="py-2 px-3 font-semibold">Fee</th>
              {BENCHMARK_REGIONS.map((r) => (
                <th key={r.key} className="py-2 pr-3 font-semibold">
                  {r.label} <span className="normal-case tracking-normal text-charcoal-300">· {r.companies.length} cos.</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUMMARY_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-sand-100 last:border-0 align-top">
                <td className="py-2 px-3 font-medium text-charcoal-800 whitespace-nowrap">{row.label}</td>
                {BENCHMARK_REGIONS.map((r) => (
                  <td key={r.key} className="py-2 pr-3 text-charcoal-700">{r.summary[row.key] ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Company detail */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        {(["all", ...BENCHMARK_REGIONS.map((r) => r.key)] as const).map((k) => (
          <button
            key={k}
            onClick={() => setRegion(k)}
            className={`rounded-md border px-2.5 py-1 font-medium ${
              region === k ? "border-charcoal-900 bg-charcoal-900 text-white" : "border-sand-200 bg-white text-charcoal-600 hover:bg-sand-50"
            }`}
          >
            {k === "all" ? `All (${companies.length})` : `${BENCHMARK_REGIONS.find((r) => r.key === k)!.label} (${BENCHMARK_REGIONS.find((r) => r.key === k)!.companies.length})`}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-sand-200">
        <table className="w-full text-[12px]">
          <thead className="bg-sand-50">
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-charcoal-400 border-b border-sand-200">
              <th className="py-2 px-3 font-semibold">Company</th>
              {FEE_COLS.map((c) => (
                <th key={c.key} className="py-2 pr-3 font-semibold">{c.label}</th>
              ))}
              <th className="py-2 pr-3 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={`${c.regionKey}-${c.company}`} className="border-b border-sand-100 last:border-0 align-top">
                <td className="py-2 px-3 min-w-[170px]">
                  <p className="font-medium text-charcoal-900">{c.company}</p>
                  <p className="text-[11px] text-charcoal-400">{c.market}</p>
                  {c.notes && <p className="mt-0.5 max-w-[220px] text-[11px] leading-snug text-charcoal-500">{c.notes}</p>}
                </td>
                {FEE_COLS.map((col) => (
                  <td key={col.key} className="py-2 pr-3 min-w-[110px] max-w-[190px] leading-snug text-charcoal-700">
                    {(c[col.key] as string | null) ?? <span className="text-charcoal-300">not published</span>}
                  </td>
                ))}
                <td className="py-2 pr-3 whitespace-nowrap">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-charcoal-700 underline-offset-2 hover:underline"
                    title={c.quote ?? undefined}
                  >
                    {c.sourceType === "company site" ? "Company site" : "Guide"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Oregon limits on tenant-paid fees */}
      <div className="mt-6 rounded-xl border border-sand-200 p-4">
        <p className="mb-2 text-[13px] font-semibold text-charcoal-800">Oregon rules on tenant-paid fees</p>
        <p className="mb-3 text-[11.5px] text-charcoal-500">
          Owner-side fees are set by the management agreement; fees charged to tenants are limited by ORS 90. Not legal advice. Confirm with counsel before changing tenant fees.
        </p>
        <ul className="space-y-2 text-[12px]">
          {OREGON_FEE_LAW.map((l) => (
            <li key={l.topic}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-charcoal-900 underline-offset-2 hover:underline">
                {l.topic}
                <ExternalLink className="h-3 w-3" />
              </a>
              <p className="text-charcoal-600 leading-snug">{l.rule}</p>
            </li>
          ))}
        </ul>
      </div>

      {BENCHMARK_REGIONS.some((r) => r.notes) && (
        <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-charcoal-400">
          {BENCHMARK_REGIONS.filter((r) => r.notes).map((r) => (
            <p key={r.key}>
              <span className="font-medium text-charcoal-500">{r.label}:</span> {r.notes}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
