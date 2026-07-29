"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, CalendarDays, ShieldCheck, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InhouseAnalysis, CategoryAnalysis } from "@/lib/inhouse-analysis";

// ============================================
// In-house vs Vendor analysis (ADMIN ONLY)
//
// What work should HDMS keep in-house vs leave to outside vendors — per trade
// category: volume, spend, avg cost/WO, avg cycle time, and the "small job"
// external spend an in-house tech could capture.
// ============================================

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function todayInput(): string {
  return new Date().toISOString().split("T")[0];
}

export function InhouseReport() {
  const [analysis, setAnalysis] = useState<InhouseAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState(() => todayInput());
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchAnalysis = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/inhouse-analysis?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const a = analysis;
  const hdmsShare = a && a.hdmsSpend + a.externalSpend > 0
    ? (a.hdmsSpend / (a.hdmsSpend + a.externalSpend)) * 100
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-charcoal-800">In-house vs Vendor</h2>
          <p className="text-xs text-charcoal-400">
            Where HDMS should take work in-house — by trade, from AppFolio bills joined to work orders. Admin only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-charcoal-500">
            <CalendarDays className="h-3.5 w-3.5 text-charcoal-400" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 rounded-md border border-sand-300 bg-white px-2 text-xs text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-400"
            />
            <span className="text-charcoal-300">–</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 rounded-md border border-sand-300 bg-white px-2 text-xs text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-400"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchAnalysis} disabled={isLoading} className="text-xs h-8">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Run analysis
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {isLoading && !a && (
        <div className="flex items-center justify-center py-16 text-charcoal-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Pulling AppFolio bills and joining work orders (~30s)…</span>
        </div>
      )}

      {a && (
        <>
          {/* Headline cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-sand-200 shadow-card p-4">
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">HDMS Share of Spend</p>
              <p className="text-xl font-bold text-terra-600">{hdmsShare.toFixed(1)}%</p>
              <p className="text-[10px] text-charcoal-400 mt-0.5">
                {formatCurrency(a.hdmsSpend)} of {formatCurrency(a.hdmsSpend + a.externalSpend)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-sand-200 shadow-card p-4">
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">External Spend</p>
              <p className="text-xl font-bold text-charcoal-900">{formatCurrency(a.externalSpend)}</p>
              <p className="text-[10px] text-charcoal-400 mt-0.5">{a.woCount.toLocaleString()} billed WOs in range</p>
            </div>
            <div className="bg-white rounded-xl border border-sand-200 shadow-card p-4">
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">Avg Cycle Time</p>
              <p className="text-xl font-bold text-blue-600">
                {a.hdmsAvgCycleDays != null ? `${a.hdmsAvgCycleDays.toFixed(1)}d` : "—"}
                <span className="text-sm font-medium text-charcoal-400"> vs {a.externalAvgCycleDays != null ? `${a.externalAvgCycleDays.toFixed(1)}d` : "—"}</span>
              </p>
              <p className="text-[10px] text-charcoal-400 mt-0.5">HDMS vs external vendors</p>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-200 shadow-card p-4">
              <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider mb-1">Small-Job Opportunity</p>
              <p className="text-xl font-bold text-amber-700">{formatCurrency(a.smallJobOpportunityTotal)}</p>
              <p className="text-[10px] text-amber-600/80 mt-0.5">external spend on jobs ≤ $500</p>
            </div>
          </div>

          {/* Category table */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-sand-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-charcoal-700">By trade category</span>
              <span className="text-[10px] text-charcoal-400">sorted by capturable small-job spend · click a row for vendors</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-100/80 bg-charcoal-50/40">
                    <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Category</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">WOs (in/out)</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Ext. Spend</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Avg $/WO (in vs out)</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Cycle (in vs out)</th>
                    <th className="text-right px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">≤$500 Opportunity</th>
                    <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {a.categories.map((c) => (
                    <CategoryRow
                      key={c.category}
                      c={c}
                      expanded={expanded === c.category}
                      onToggle={() => setExpanded(expanded === c.category ? null : c.category)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[10px] text-charcoal-400">
            Costs are AppFolio maintenance-GL bill lines (6xxx) joined to work orders; categories are inferred from
            GL account + WO description keywords. &ldquo;Opportunity&rdquo; counts external jobs billed ≤ $500 —
            handyman-scale work an in-house tech could absorb at $95/hr + materials markup. Licensed trades are
            flagged: their small jobs may still need a licensed sub.
            {a.unjoinedBillLines > 0 && ` ${a.unjoinedBillLines} bill lines had no work-order link and are excluded.`}
          </p>
        </>
      )}
    </div>
  );
}

function CategoryRow({
  c,
  expanded,
  onToggle,
}: {
  c: CategoryAnalysis;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Simple, transparent heuristic for the Signal column.
  const signal = c.licensedTrade
    ? { label: "Licensed trade", cls: "bg-charcoal-100 text-charcoal-500", icon: ShieldCheck }
    : c.smallJobOpportunity >= 5000
    ? { label: "In-house candidate", cls: "bg-green-100 text-green-700", icon: Lightbulb }
    : c.hdms.count >= 5 &&
      c.external.count >= 5 &&
      c.hdms.avgCost < c.external.avgCost &&
      (c.hdms.avgCycleDays ?? 99) < (c.external.avgCycleDays ?? 99)
    ? { label: "HDMS wins here", cls: "bg-terra-100 text-terra-700", icon: Lightbulb }
    : null;

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-charcoal-50/80 hover:bg-charcoal-50/60 cursor-pointer"
      >
        <td className="px-4 py-2.5 text-xs font-medium text-charcoal-800">{c.category}</td>
        <td className="px-4 py-2.5 text-right text-xs text-charcoal-600">
          <span className="text-terra-600 font-medium">{c.hdms.count}</span>
          <span className="text-charcoal-300"> / </span>
          {c.external.count}
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-charcoal-800">{formatCurrency(c.external.spend)}</td>
        <td className="px-4 py-2.5 text-right text-xs text-charcoal-600 whitespace-nowrap">
          {c.hdms.count ? formatCurrency(c.hdms.avgCost) : "—"}
          <span className="text-charcoal-300"> vs </span>
          {c.external.count ? formatCurrency(c.external.avgCost) : "—"}
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-charcoal-600 whitespace-nowrap">
          {c.hdms.avgCycleDays != null ? `${c.hdms.avgCycleDays.toFixed(0)}d` : "—"}
          <span className="text-charcoal-300"> vs </span>
          {c.external.avgCycleDays != null ? `${c.external.avgCycleDays.toFixed(0)}d` : "—"}
        </td>
        <td className="px-4 py-2.5 text-right text-xs font-semibold text-amber-700">
          {c.smallJobOpportunity > 0 ? formatCurrency(c.smallJobOpportunity) : "—"}
          {c.smallJobCount > 0 && (
            <span className="block text-[9px] font-normal text-charcoal-400">{c.smallJobCount} jobs</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs">
          {signal && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${signal.cls}`}>
              <signal.icon className="h-3 w-3" />
              {signal.label}
            </span>
          )}
        </td>
      </tr>
      {expanded && c.topVendors.length > 0 && (
        <tr className="bg-charcoal-50/40">
          <td colSpan={7} className="px-6 py-2.5">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-charcoal-600">
              <span className="font-semibold text-charcoal-500">Top external vendors:</span>
              {c.topVendors.map((v) => (
                <span key={v.name}>
                  {v.name} — {formatCurrency(v.spend)} <span className="text-charcoal-400">({v.count} WOs)</span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
