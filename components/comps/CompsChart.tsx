"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import type { TownStats, MarketBaseline } from "@/types/comps";

interface CompsChartProps {
  townStats: TownStats[];
  baselines: MarketBaseline[];
  loading?: boolean;
  bedrooms?: number;
}

const TOWN_COLORS: Record<string, string> = {
  Bend: "#059669",
  Redmond: "#10b981",
  Sisters: "#34d399",
  Prineville: "#6ee7b7",
  Culver: "#a7f3d0",
  "La Pine": "#0f766e",
};

function formatDollar(value: number) {
  return `$${value.toLocaleString()}`;
}

export function CompsChart({ townStats, baselines, loading, bedrooms }: CompsChartProps) {
  if (loading) {
    return (
      <div className="glass glass-shine rounded-2xl p-6">
        <div className="animate-pulse">
          <div className="h-4 w-48 bg-charcoal-200 rounded mb-6" />
          <div className="h-64 bg-charcoal-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (townStats.length === 0) {
    return (
      <div className="glass glass-shine rounded-2xl p-6">
        <p className="text-center text-charcoal-400 text-sm py-12">
          No data to chart with current filters
        </p>
      </div>
    );
  }

  const chartData = townStats.map((ts) => ({
    town: ts.town,
    avg_rent: ts.avg_rent,
    median_rent: ts.median_rent,
    min_rent: ts.min_rent,
    max_rent: ts.max_rent,
    count: ts.count,
  }));

  // Find FMR reference line for selected bedroom count
  const br = bedrooms ?? 3;
  const fmrBaseline = baselines.find((b) => b.bedrooms === br && b.fmr_rent);
  const fmrValue = fmrBaseline ? Number(fmrBaseline.fmr_rent) : null;

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-charcoal-700">
          Average Rent by Town
        </h4>
        {fmrValue && (
          <span className="text-[10px] text-amber-600 font-medium">
            ── HUD FMR ({br}BR): {formatDollar(fmrValue)}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(0,0,0,0.05)"
            vertical={false}
          />
          <XAxis
            dataKey="town"
            tick={{ fontSize: 12, fill: "#6b7280" }}
            axisLine={{ stroke: "rgba(0,0,0,0.08)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatDollar}
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={((value: any, name: any) => [
              formatDollar(Number(value) || 0),
              name === "avg_rent" ? "Average" : "Median",
            ]) as any}
            contentStyle={{
              backgroundColor: "rgba(255,255,255,0.95)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: "12px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
              fontSize: "12px",
            }}
            labelStyle={{ fontWeight: 600, color: "#111827" }}
          />
          <Bar dataKey="avg_rent" name="Average Rent" radius={[8, 8, 0, 0]} maxBarSize={60}>
            {chartData.map((entry) => (
              <Cell
                key={entry.town}
                fill={TOWN_COLORS[entry.town] || "#059669"}
              />
            ))}
          </Bar>
          {fmrValue && (
            <ReferenceLine
              y={fmrValue}
              stroke="#d97706"
              strokeDasharray="6 4"
              strokeWidth={1.5}
            />
          )}
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 justify-center">
        {chartData.map((d) => (
          <div key={d.town} className="flex items-center gap-1.5 text-xs text-charcoal-500">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: TOWN_COLORS[d.town] || "#059669" }}
            />
            <span>{d.town}</span>
            <span className="text-charcoal-300">({d.count})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
