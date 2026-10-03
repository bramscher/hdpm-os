"use client";

import { useMemo } from "react";
import { MapPin } from "lucide-react";
import type { RentAnalysis } from "@/types/comps";
import { buildNearbyRentals } from "@/lib/rent-report-nearby";

/**
 * On-screen Nearby Rentals panel, modelled on AppFolio's Nearby Advertised
 * Units view. Same model as the PDF page (lib/rent-report-nearby.ts); it
 * follows the rent override as it's typed, since "your rent" is the
 * recommended rent the report will show.
 */

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—";

function Delta({ value, money: isMoney }: { value: number | null; money?: boolean }) {
  if (value == null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={`ml-1.5 text-[11px] font-medium ${up ? "text-green-700" : "text-red-700"}`}>
      {up ? "▲" : "▼"} {isMoney ? money(Math.abs(value)) : Math.abs(value).toLocaleString()}
    </span>
  );
}

export function NearbyRentals({ analysis, rentOverride }: { analysis: RentAnalysis; rentOverride: string }) {
  const model = useMemo(() => {
    const override = Number(rentOverride);
    const withOverride = override > 0 ? { ...analysis, recommended_rent_override: override } : analysis;
    return buildNearbyRentals(withOverride, (analysis.generated_at || new Date().toISOString()).slice(0, 10));
  }, [analysis, rentOverride]);

  if (!model) return null;

  // Chart geometry (SVG units; scales to the panel width)
  const W = 640;
  const H = 210;
  const left = 34;
  const right = 10;
  const top = 26;
  const chartH = 120;
  const base = top + chartH;
  const chartW = W - left - right;
  const binW = chartW / model.bins.length;
  const maxCount = Math.max(1, ...model.bins.map((b) => b.count));
  const x = (i: number) => left + i * binW;
  const every = Math.ceil(model.bins.length / 8);
  const medX = x(model.medianBin) + binW / 2;
  const youX = x(model.yourBin) + binW / 2;

  return (
    <div className="glass-heavy rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-charcoal-200/50 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium text-charcoal-400 uppercase tracking-wider flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" /> Nearby Rentals ({model.rows.length})
        </h4>
        <p className="text-xs text-charcoal-500">
          Similar rentals advertised nearby (RentCast) · {model.above} ask more and {model.below} ask less than {money(model.unit.rent)}
        </p>
      </div>

      <div className="px-4 pt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Rent distribution of ${model.rows.length} nearby rentals from ${money(model.low)} to ${money(model.high)}, median ${money(model.median)}, your rent ${money(model.unit.rent)}`}>
          <defs>
            <linearGradient id="nearby-band" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#9fca9f" />
              <stop offset="50%" stopColor="#f3f3f3" />
              <stop offset="100%" stopColor="#e7a3a3" />
            </linearGradient>
          </defs>
          {Array.from({ length: maxCount }, (_, c) => {
            const gy = base - ((c + 1) / maxCount) * chartH;
            return (
              <g key={c}>
                <line x1={left} x2={W - right} y1={gy} y2={gy} stroke="#e5e7eb" strokeWidth={0.6} />
                <text x={left - 6} y={gy + 3} textAnchor="end" fontSize={9} fill="#6b7280">{c + 1}</text>
              </g>
            );
          })}
          {/* your rent column */}
          <rect x={x(model.yourBin) + 1} y={top - 8} width={binW - 2} height={chartH + 8} fill="#f2f8f2" stroke="#3d7a3d" strokeDasharray="3 3" />
          {model.bins.map((b, i) =>
            b.count ? (
              <rect
                key={b.from}
                x={x(i) + 2}
                y={base - (b.count / maxCount) * chartH}
                width={binW - 4}
                height={(b.count / maxCount) * chartH}
                fill={i === model.medianBin ? "#d9ad91" : "#efd3c1"}
              >
                <title>{`${money(b.from)}–${money(b.to)}: ${b.count} rental${b.count === 1 ? "" : "s"}`}</title>
              </rect>
            ) : null
          )}
          {/* median label */}
          <g>
            <rect x={Math.min(Math.max(medX - 48, left), W - right - 96)} y={top - 24} width={96} height={15} rx={3} fill="#fff" stroke="#e5e7eb" />
            <text x={Math.min(Math.max(medX, left + 48), W - right - 48)} y={top - 13} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#111827">
              Median {money(model.median)}
            </text>
          </g>
          {/* low → high band and your-rent marker */}
          <rect x={left} y={base + 2} width={chartW} height={7} fill="url(#nearby-band)" />
          <path d={`M ${youX - 7} ${base + 17} L ${youX} ${base + 10} L ${youX + 7} ${base + 17} Z M ${youX - 5} ${base + 17} h 10 v 7 h -10 Z`} fill="#3d7a3d" />
          {model.bins.map((b, i) =>
            i % every === 0 ? (
              <text key={b.from} x={x(i)} y={base + 36} textAnchor="middle" fontSize={9} fill="#6b7280">{money(b.from)}</text>
            ) : null
          )}
          <text x={left} y={base + 52} fontSize={10} fontWeight={600} fill="#111827">Low {money(model.low)}</text>
          <text x={W - right} y={base + 52} textAnchor="end" fontSize={10} fontWeight={600} fill="#111827">High {money(model.high)}</text>
        </svg>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-charcoal-50 text-charcoal-500">
              {["Similarity", "Beds", "Baths", "Sq ft", "Location", "Last advertised", "Rent"].map((h) => (
                <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r, i) => (
              <tr key={`${r.address}-${i}`} className={i % 2 ? "bg-charcoal-50/40" : ""} title={r.address}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-14 rounded bg-charcoal-100 overflow-hidden">
                      <span className="block h-full bg-terra-600" style={{ width: `${r.similarity}%` }} />
                    </span>
                    <span className="text-xs font-semibold tabular-nums">{r.similarity}%</span>
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{r.bedrooms}</td>
                <td className="px-3 py-2 tabular-nums">{r.bathrooms}</td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {r.sqft ? r.sqft.toLocaleString() : "—"}
                  <Delta value={r.sqftDiff} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-charcoal-600">{r.distanceLabel}</td>
                <td className="px-3 py-2 whitespace-nowrap text-charcoal-500">{shortDate(r.lastAdvertised)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-semibold tabular-nums">
                  {money(r.rent)}
                  <Delta value={r.rentDiff} money />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-charcoal-400">
        Advertised asking rents from RentCast, not signed leases. Similarity is RentCast&apos;s match score. The dashed column and house mark your rent; arrows compare each rental with your unit. This also appears in the PDF.
      </p>
    </div>
  );
}
