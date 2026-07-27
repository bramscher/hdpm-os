"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  ArrowLeft,
  DollarSign,
  Home,
  Wrench,
  FileWarning,
  Shield,
  RefreshCw,
  Users,
  PieChart,
  Timer,
  Repeat,
  Building2,
  UserPlus,
  Filter,
  Receipt,
} from "lucide-react";

// Recharts v3 tooltip formatter types are overly strict — cast like CompsChart.tsx
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFormatter = any;

// ============================================
// Types
// ============================================

interface TrendPoint {
  date: string;
  value: Record<string, number>;
}

type DateRange = "4w" | "8w" | "12w" | "6m" | "1y" | "2y" | "all";

const RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "4w", label: "4 Weeks" },
  { value: "8w", label: "8 Weeks" },
  { value: "12w", label: "12 Weeks" },
  { value: "6m", label: "6 Months" },
  { value: "1y", label: "1 Year" },
  { value: "2y", label: "2 Years" },
  { value: "all", label: "All" },
];

// ============================================
// Shared chart styling (matches CompsChart.tsx)
// ============================================

const GRID_PROPS = {
  strokeDasharray: "3 3",
  stroke: "rgba(0,0,0,0.05)",
  vertical: false as const,
};

const X_TICK = { fontSize: 12, fill: "#6b7280" };
const Y_TICK = { fontSize: 11, fill: "#9ca3af" };

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(255,255,255,0.95)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: "12px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
  fontSize: "12px",
};

const LABEL_STYLE = { fontWeight: 600, color: "#111827" };

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Detect whether data spans multiple calendar years */
function isMultiYear(data: TrendPoint[]): boolean {
  if (data.length < 2) return false;
  const firstYear = new Date(data[0].date + "T12:00:00").getFullYear();
  const lastYear = new Date(data[data.length - 1].date + "T12:00:00").getFullYear();
  return firstYear !== lastYear;
}

/** Format tick: include 'YY when data spans multiple years */
function tickFormat(dateStr: string, multiYear: boolean) {
  const d = new Date(dateStr + "T12:00:00");
  const base = `${d.getMonth() + 1}/${d.getDate()}`;
  if (multiYear) return `${base}/${d.getFullYear()}`;
  return base;
}

/** Return raw date strings where a new calendar year begins (first data point of each new year) */
function yearBoundaries(data: TrendPoint[]): Array<{ rawDate: string; year: number }> {
  const boundaries: Array<{ rawDate: string; year: number }> = [];
  let prevYear: number | null = null;
  for (const d of data) {
    const yr = new Date(d.date + "T12:00:00").getFullYear();
    if (prevYear !== null && yr !== prevYear) {
      boundaries.push({ rawDate: d.date, year: yr });
    }
    prevYear = yr;
  }
  return boundaries;
}

const YEAR_LINE_STYLE = {
  stroke: "#9ca3af",
  strokeDasharray: "4 4",
  strokeWidth: 1,
};
const YEAR_LABEL_STYLE = {
  fill: "#6b7280",
  fontSize: 11,
  fontWeight: 600 as const,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tooltipLabel(label: any) {
  const d = new Date(String(label) + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ============================================
// Stat Pills
// ============================================

function StatPills({ stats }: { stats: Array<{ label: string; value: string }> }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="px-2.5 py-1 rounded-lg bg-sand-50 border border-sand-200 text-xs"
        >
          <span className="text-charcoal-400">{s.label}</span>{" "}
          <span className="font-semibold text-charcoal-700">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

function computeStats(values: number[]): { current: number; high: number; low: number; avg: number } {
  if (values.length === 0) return { current: 0, high: 0, low: 0, avg: 0 };
  const current = values[values.length - 1];
  const high = Math.max(...values);
  const low = Math.min(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return { current, high, low, avg };
}

// ============================================
// Chart Components
// ============================================

function ChartSkeleton() {
  return (
    <div className="glass glass-shine rounded-2xl p-6 animate-pulse">
      <div className="h-4 w-40 bg-charcoal-200 rounded mb-6" />
      <div className="flex gap-2 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-6 w-20 bg-sand-100 rounded-lg" />
        ))}
      </div>
      <div className="h-64 bg-charcoal-100 rounded-xl" />
    </div>
  );
}

function EmptyChart({ name }: { name: string }) {
  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <h4 className="text-sm font-semibold text-charcoal-700 mb-4">{name}</h4>
      <p className="text-center text-charcoal-400 text-sm py-16">
        No historical data yet. Snapshots accumulate daily via cron.
      </p>
    </div>
  );
}

function DelinquencyChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Delinquency Rate" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    rate: d.value.rate ?? 0,
    dollars: d.value.totalDollars ?? 0,
  }));

  const rates = chartData.map((d) => d.rate);
  const stats = computeStats(rates);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
          <DollarSign className="w-4 h-4 text-red-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Delinquency Rate</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)}%` },
          { label: "High", value: `${stats.high.toFixed(1)}%` },
          { label: "Low", value: `${stats.low.toFixed(1)}%` },
          { label: "Avg", value: `${stats.avg.toFixed(1)}%` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis yAxisId="rate" tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="dollars" orientation="right" tick={Y_TICK} axisLine={false} tickLine={false} width={65} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "rate") return [`${value.toFixed(1)}%`, "Rate"];
              return [`$${value.toLocaleString()}`, "Outstanding"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Area yAxisId="dollars" type="monotone" dataKey="dollars" stroke="none" fill="#fecaca" fillOpacity={0.4} />
          <Line yAxisId="rate" type="monotone" dataKey="rate" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: "#dc2626" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function VacancyChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Vacancy Rate" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    rate: d.value.rate ?? 0,
    vacantCount: d.value.vacantCount ?? 0,
  }));

  const rates = chartData.map((d) => d.rate);
  const stats = computeStats(rates);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
          <Home className="w-4 h-4 text-amber-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Vacancy Rate</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)}%` },
          { label: "High", value: `${stats.high.toFixed(1)}%` },
          { label: "Low", value: `${stats.low.toFixed(1)}%` },
          { label: "Avg", value: `${stats.avg.toFixed(1)}%` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "rate") return [`${value.toFixed(1)}%`, "Rate"];
              return [`${value}`, "Vacant Units"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Area type="monotone" dataKey="rate" stroke="#d97706" strokeWidth={2} fill="#fde68a" fillOpacity={0.3} dot={{ r: 3, fill: "#d97706" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function WorkOrderChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Work Order Cycle Time" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    avgDays: d.value.avgDaysToClose ?? 0,
    openCount: d.value.openCount ?? 0,
  }));

  const avgDays = chartData.map((d) => d.avgDays);
  const stats = computeStats(avgDays);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <Wrench className="w-4 h-4 text-blue-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Work Order Cycle Time</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)} days` },
          { label: "High", value: `${stats.high.toFixed(1)} days` },
          { label: "Low", value: `${stats.low.toFixed(1)} days` },
          { label: "Avg", value: `${stats.avg.toFixed(1)} days` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis yAxisId="days" tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}d`} />
          <YAxis yAxisId="count" orientation="right" tick={Y_TICK} axisLine={false} tickLine={false} width={45} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "avgDays") return [`${value.toFixed(1)} days`, "Avg Cycle Time"];
              return [`${value}`, "Open WOs"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Bar yAxisId="count" dataKey="openCount" fill="#bfdbfe" fillOpacity={0.6} radius={[4, 4, 0, 0]} maxBarSize={24} name="openCount" />
          <Line yAxisId="days" type="monotone" dataKey="avgDays" stroke="#2563eb" strokeWidth={2} dot={{ r: 3, fill: "#2563eb" }} name="avgDays" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-6 mt-3 text-xs text-charcoal-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm bg-blue-200" />
          <span>Open Work Orders</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-blue-600 rounded" />
          <span>Avg Cycle Time</span>
        </div>
      </div>
    </div>
  );
}

function NoticeChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="30-Day Notice Volume" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    thisWeek: d.value.thisWeek ?? 0,
    last30Days: d.value.last30Days ?? 0,
  }));

  const volumes = chartData.map((d) => d.last30Days);
  const stats = computeStats(volumes);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
          <FileWarning className="w-4 h-4 text-purple-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">30-Day Notice Volume</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current}` },
          { label: "High", value: `${stats.high}` },
          { label: "Low", value: `${stats.low}` },
          { label: "Avg", value: `${stats.avg.toFixed(0)}` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "last30Days") return [`${value}`, "30-Day Rolling"];
              return [`${value}`, "This Week"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Area type="monotone" dataKey="last30Days" stroke="#9333ea" strokeWidth={2} fill="#e9d5ff" fillOpacity={0.3} name="last30Days" />
          <Line type="monotone" dataKey="thisWeek" stroke="#7c3aed" strokeWidth={1} dot={{ r: 2, fill: "#7c3aed" }} name="thisWeek" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-6 mt-3 text-xs text-charcoal-500">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-purple-600 rounded" />
          <span>30-Day Rolling</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-purple-700" />
          <span>That Week</span>
        </div>
      </div>
    </div>
  );
}

function InsuranceChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Insurance Compliance" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    rate: d.value.rate ?? 0,
    compliantCount: d.value.compliantCount ?? 0,
  }));

  const rates = chartData.map((d) => d.rate);
  const stats = computeStats(rates);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
          <Shield className="w-4 h-4 text-green-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Insurance Compliance</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)}%` },
          { label: "High", value: `${stats.high.toFixed(1)}%` },
          { label: "Low", value: `${stats.low.toFixed(1)}%` },
          { label: "Avg", value: `${stats.avg.toFixed(1)}%` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "rate") return [`${value.toFixed(1)}%`, "Compliance Rate"];
              return [`${value}`, "Compliant"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Area type="monotone" dataKey="rate" stroke="#16a34a" strokeWidth={2} fill="#bbf7d0" fillOpacity={0.3} dot={{ r: 3, fill: "#16a34a" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================
// Shared: Insight Line
// ============================================

function InsightLine({ text }: { text: string }) {
  return (
    <p className="mt-4 text-xs text-charcoal-400 italic leading-relaxed border-t border-sand-100 pt-3">
      {text}
    </p>
  );
}

// ============================================
// KPI 6: Owner Retention Rate
// ============================================

function OwnerRetentionChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Owner Retention Rate" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    rate: d.value.rate ?? 0,
    cancellations: d.value.cancellationsLast30Days ?? 0,
  }));

  const rates = chartData.map((d) => d.rate);
  const stats = computeStats(rates);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
          <Users className="w-4 h-4 text-indigo-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Owner Retention Rate</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)}%` },
          { label: "High", value: `${stats.high.toFixed(1)}%` },
          { label: "Low", value: `${stats.low.toFixed(1)}%` },
          { label: "Avg", value: `${stats.avg.toFixed(1)}%` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis yAxisId="rate" tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} domain={[80, 100]} />
          <YAxis yAxisId="cancel" orientation="right" tick={Y_TICK} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "rate") return [`${value.toFixed(1)}%`, "Retention Rate"];
              return [`${value}`, "Cancellations (30d)"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Bar yAxisId="cancel" dataKey="cancellations" fill="#c7d2fe" fillOpacity={0.6} radius={[4, 4, 0, 0]} maxBarSize={24} name="cancellations" />
          <Line yAxisId="rate" type="monotone" dataKey="rate" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3, fill: "#4f46e5" }} name="rate" />
        </ComposedChart>
      </ResponsiveContainer>
      <InsightLine text="A rate above 90% is considered healthy for a PM portfolio at this scale." />
    </div>
  );
}

// ============================================
// KPI 7: Maintenance Cost as % of Rent Roll
// ============================================

function MaintenanceCostChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Maintenance Cost %" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    rate: d.value.rate ?? 0,
    maintenanceDollars: d.value.maintenanceDollars ?? 0,
    grossRentDollars: d.value.grossRentDollars ?? 0,
  }));

  const rates = chartData.map((d) => d.rate);
  const stats = computeStats(rates);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
          <PieChart className="w-4 h-4 text-orange-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Maintenance Cost as % of Rent Roll</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)}%` },
          { label: "High", value: `${stats.high.toFixed(1)}%` },
          { label: "Low", value: `${stats.low.toFixed(1)}%` },
          { label: "Avg", value: `${stats.avg.toFixed(1)}%` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis yAxisId="rate" tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="dollars" orientation="right" tick={Y_TICK} axisLine={false} tickLine={false} width={65} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "rate") return [`${value.toFixed(1)}%`, "Cost %"];
              if (name === "maintenanceDollars") return [`$${value.toLocaleString()}`, "Maintenance"];
              return [`$${value.toLocaleString()}`, "Rent Roll"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Bar yAxisId="dollars" dataKey="grossRentDollars" fill="#e5e7eb" fillOpacity={0.4} radius={[4, 4, 0, 0]} maxBarSize={28} name="grossRentDollars" />
          <Bar yAxisId="dollars" dataKey="maintenanceDollars" fill="#fed7aa" fillOpacity={0.7} radius={[4, 4, 0, 0]} maxBarSize={28} name="maintenanceDollars" />
          <Line yAxisId="rate" type="monotone" dataKey="rate" stroke="#ea580c" strokeWidth={2} dot={{ r: 3, fill: "#ea580c" }} name="rate" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-6 mt-3 text-xs text-charcoal-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm bg-gray-200" />
          <span>Rent Roll</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm bg-orange-200" />
          <span>Maintenance</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-orange-600 rounded" />
          <span>Cost %</span>
        </div>
      </div>
      <InsightLine text="Industry benchmark is 8–15% for a residential PM portfolio. Spikes often indicate deferred maintenance catching up." />
    </div>
  );
}

// ============================================
// KPI 8: Average Days to Lease
// ============================================

function DaysToLeaseChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Average Days to Lease" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    avgDays: d.value.avgDays ?? 0,
    fastest: d.value.fastest ?? 0,
    slowest: d.value.slowest ?? 0,
    unitsLeased: d.value.unitsLeased ?? 0,
  }));

  const avgDays = chartData.map((d) => d.avgDays);
  const stats = computeStats(avgDays);
  const lastPoint = chartData[chartData.length - 1];

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-cyan-100 rounded-lg flex items-center justify-center">
          <Timer className="w-4 h-4 text-cyan-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Average Days to Lease</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)} days` },
          { label: "High", value: `${stats.high.toFixed(1)} days` },
          { label: "Low", value: `${stats.low.toFixed(1)} days` },
          { label: "Avg", value: `${stats.avg.toFixed(1)} days` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}d`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "avgDays") return [`${value.toFixed(1)} days`, "Avg Days"];
              return [`${value}`, name];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Area type="monotone" dataKey="avgDays" stroke="#0891b2" strokeWidth={2} fill="#a5f3fc" fillOpacity={0.3} dot={{ r: 3, fill: "#0891b2" }} />
        </AreaChart>
      </ResponsiveContainer>
      {lastPoint && (
        <div className="flex flex-wrap gap-2 mt-3">
          <div className="px-2.5 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-xs">
            <span className="text-charcoal-400">Fastest</span>{" "}
            <span className="font-semibold text-cyan-700">{lastPoint.fastest}d</span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-xs">
            <span className="text-charcoal-400">Slowest</span>{" "}
            <span className="font-semibold text-cyan-700">{lastPoint.slowest}d</span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-xs">
            <span className="text-charcoal-400">Units Leased</span>{" "}
            <span className="font-semibold text-cyan-700">{lastPoint.unitsLeased}</span>
          </div>
        </div>
      )}
      <InsightLine text="Central Oregon market average is typically 14–21 days. Anything over 30 days warrants a pricing or advertising review." />
    </div>
  );
}

// ============================================
// KPI 9: Lease Renewal Rate
// ============================================

function LeaseRenewalChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Lease Renewal Rate" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    rate: d.value.rate ?? 0,
    renewals: d.value.renewals ?? 0,
    moveOuts: d.value.moveOuts ?? 0,
  }));

  const rates = chartData.map((d) => d.rate);
  const stats = computeStats(rates);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center">
          <Repeat className="w-4 h-4 text-teal-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Lease Renewal Rate</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current.toFixed(1)}%` },
          { label: "High", value: `${stats.high.toFixed(1)}%` },
          { label: "Low", value: `${stats.low.toFixed(1)}%` },
          { label: "Avg", value: `${stats.avg.toFixed(1)}%` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis yAxisId="rate" tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="count" orientation="right" tick={Y_TICK} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "rate") return [`${value.toFixed(1)}%`, "Renewal Rate"];
              if (name === "renewals") return [`${value}`, "Renewals"];
              return [`${value}`, "Move-Outs"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Bar yAxisId="count" dataKey="renewals" stackId="leases" fill="#99f6e4" radius={[0, 0, 0, 0]} maxBarSize={28} name="renewals" />
          <Bar yAxisId="count" dataKey="moveOuts" stackId="leases" fill="#fecaca" radius={[4, 4, 0, 0]} maxBarSize={28} name="moveOuts" />
          <Line yAxisId="rate" type="monotone" dataKey="rate" stroke="#0d9488" strokeWidth={2} dot={{ r: 3, fill: "#0d9488" }} name="rate" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-6 mt-3 text-xs text-charcoal-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm bg-teal-200" />
          <span>Renewals</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm bg-red-200" />
          <span>Move-Outs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-teal-600 rounded" />
          <span>Renewal Rate</span>
        </div>
      </div>
      <InsightLine text="A renewal rate above 60% reduces turnover cost significantly. Each avoided turnover saves an estimated $1,500–$3,000 in make-ready and vacancy costs." />
    </div>
  );
}

// ============================================
// KPI 10: Net Doors Added
// ============================================

function computeTargetDate(data: TrendPoint[]): string {
  if (data.length < 3) return "Insufficient data to project target date";

  const lastThree = data.slice(-3);
  const avgNet =
    lastThree.reduce((sum, d) => sum + (d.value.netThisMonth ?? 0), 0) / lastThree.length;

  if (avgNet <= 0) return "Growth rate insufficient to project target date";

  const currentDoors = data[data.length - 1].value.currentDoors ?? 0;
  const remaining = 1500 - currentDoors;

  if (remaining <= 0) return "Goal of 1,500 doors reached!";

  const monthsToGoal = Math.ceil(remaining / avgNet);
  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + monthsToGoal);

  return `On track to reach 1,500 doors by ${targetDate.getMonth() + 1}/${targetDate.getFullYear()}. Adjust the growth rate assumption if acquisition pace changes.`;
}

function NetDoorsChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Properties / Doors" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    currentDoors: d.value.currentDoors ?? 0,
    currentProperties: d.value.currentProperties ?? 0,
    netThisMonth: d.value.netThisMonth ?? 0,
  }));

  const doors = chartData.map((d) => d.currentDoors);
  const props = chartData.map((d) => d.currentProperties);
  const doorStats = computeStats(doors);
  const propStats = computeStats(props);
  const projectionText = computeTargetDate(data);

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
          <Building2 className="w-4 h-4 text-emerald-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Properties / Doors</h4>
      </div>
      <StatPills
        stats={[
          { label: "Properties", value: `${propStats.current}` },
          { label: "Doors", value: `${doorStats.current}` },
          { label: "Door Goal", value: "1,500" },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis yAxisId="doors" tick={Y_TICK} axisLine={false} tickLine={false} width={55} />
          <YAxis yAxisId="net" orientation="right" tick={Y_TICK} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "currentDoors") return [`${value}`, "Doors"];
              if (name === "currentProperties") return [`${value}`, "Properties"];
              const sign = value >= 0 ? "+" : "";
              return [`${sign}${value}`, "Net This Month"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <ReferenceLine yAxisId="doors" y={1500} stroke="#d97706" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: "Goal: 1,500", position: "right", fontSize: 10, fill: "#d97706" }} />
          <Bar yAxisId="net" dataKey="netThisMonth" fill="#a7f3d0" fillOpacity={0.6} radius={[4, 4, 0, 0]} maxBarSize={24} name="netThisMonth" />
          <Line yAxisId="doors" type="monotone" dataKey="currentDoors" stroke="#059669" strokeWidth={2} dot={{ r: 3, fill: "#059669" }} name="currentDoors" />
          <Line yAxisId="doors" type="monotone" dataKey="currentProperties" stroke="#6366f1" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, fill: "#6366f1" }} name="currentProperties" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-5 mt-3 text-xs text-charcoal-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm bg-emerald-200" />
          <span>Monthly Net</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-emerald-600 rounded" />
          <span>Doors</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-indigo-500 rounded" style={{ borderTop: "2px dashed #6366f1" }} />
          <span>Properties</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-amber-500 rounded" style={{ borderTop: "2px dashed #d97706" }} />
          <span>Goal</span>
        </div>
      </div>
      <InsightLine text={projectionText} />
    </div>
  );
}

// ============================================
// KPI 11: Guest Card Volume
// ============================================

const SOURCE_COLORS: Record<string, string> = {
  'Zillow / Syndication': '#3b82f6',
  'Rent.': '#f59e0b',
  'Apartments.com': '#10b981',
  'HDPM Website': '#8b5cf6',
  'Apartment List': '#ec4899',
  'Craigslist': '#f97316',
  'AppFolio Portal': '#06b6d4',
  'Direct / Walk-in': '#6366f1',
  'Other': '#9ca3af',
};

function GuestCardChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Guest Card Volume" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    thisWeek: d.value.thisWeek ?? 0,
    thisMonth: d.value.thisMonth ?? 0,
  }));

  const weekly = chartData.map((d) => d.thisWeek);
  const stats = computeStats(weekly);

  // Collect all source keys across all snapshots for stacked bar
  const allSources = new Set<string>();
  for (const d of data) {
    const breakdown = d.value.sourceBreakdownWeek;
    if (Array.isArray(breakdown)) {
      for (const item of breakdown as Array<{ source: string; count: number }>) {
        allSources.add(item.source);
      }
    }
  }

  const sourceBarData = data.map((d) => {
    const row: Record<string, string | number> = { date: d.date };
    const breakdown = d.value.sourceBreakdownWeek;
    if (Array.isArray(breakdown)) {
      for (const item of breakdown as Array<{ source: string; count: number }>) {
        row[item.source] = item.count;
      }
    }
    return row;
  });

  const sourceKeys = Array.from(allSources);

  // Find best source
  const sourceTotals: Record<string, number> = {};
  for (const d of data) {
    const breakdown = d.value.sourceBreakdownWeek;
    if (Array.isArray(breakdown)) {
      for (const item of breakdown as Array<{ source: string; count: number }>) {
        sourceTotals[item.source] = (sourceTotals[item.source] || 0) + item.count;
      }
    }
  }
  const bestSource = Object.entries(sourceTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N/A';

  return (
    <div className="glass glass-shine rounded-2xl p-6 lg:col-span-2">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center">
          <UserPlus className="w-4 h-4 text-sky-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Guest Card Volume</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current Week", value: `${stats.current}` },
          { label: "Best Week", value: `${stats.high}` },
          { label: "Worst Week", value: `${stats.low}` },
          { label: "Weekly Avg", value: `${stats.avg.toFixed(0)}` },
          { label: "Best Source", value: bestSource },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly volume line */}
        <div>
          <p className="text-xs font-medium text-charcoal-500 mb-2">Weekly Volume</p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
              <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={LABEL_STYLE} />
              {yearBoundaries(data).map((b) => (
                <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
              ))}
              <Area type="monotone" dataKey="thisWeek" stroke="#0284c7" strokeWidth={2} fill="#bae6fd" fillOpacity={0.3} dot={{ r: 3, fill: "#0284c7" }} name="This Week" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* Source breakdown stacked bar */}
        <div>
          <p className="text-xs font-medium text-charcoal-500 mb-2">Source Breakdown</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sourceBarData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
              <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={LABEL_STYLE} labelFormatter={tooltipLabel} />
              {yearBoundaries(data).map((b) => (
                <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
              ))}
              {sourceKeys.map((source) => (
                <Bar
                  key={source}
                  dataKey={source}
                  stackId="sources"
                  fill={SOURCE_COLORS[source] || '#9ca3af'}
                  radius={[0, 0, 0, 0]}
                  maxBarSize={28}
                  name={source}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2 justify-center">
            {sourceKeys.map((source) => (
              <div key={source} className="flex items-center gap-1 text-[10px] text-charcoal-500">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SOURCE_COLORS[source] || '#9ca3af' }} />
                <span>{source}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <InsightLine text="Track which sources trend up or down week over week to guide advertising spend. A drop in any single source warrants checking whether that listing is still active and correctly priced." />
    </div>
  );
}

// ============================================
// KPI 12: Leasing Funnel
// ============================================

interface FunnelStage {
  name: string;
  count: number;
  rate: string;
  color: string;
}

function FunnelBars({ stages, maxCount }: { stages: FunnelStage[]; maxCount: number }) {
  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const widthPct = maxCount > 0 ? Math.max(4, (stage.count / maxCount) * 100) : 4;
        return (
          <div key={stage.name} className="flex items-center gap-3">
            <div className="w-24 text-xs text-charcoal-500 text-right flex-shrink-0">{stage.name}</div>
            <div className="flex-1 flex items-center gap-2">
              <div
                className="h-7 rounded-md flex items-center px-2 transition-all duration-300"
                style={{ width: `${widthPct}%`, backgroundColor: stage.color }}
              >
                <span className="text-xs font-semibold text-white whitespace-nowrap">{stage.count}</span>
              </div>
              <span className="text-xs text-charcoal-400 flex-shrink-0">{stage.rate}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeasingFunnelChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Leasing Funnel" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    overallConversion: (d.value.conversionRates as unknown as Record<string, number>)?.overallConversion ?? 0,
  }));

  const rates = chartData.map((d) => d.overallConversion);
  const stats = computeStats(rates);

  // Current funnel from latest snapshot
  const latest = data[data.length - 1];
  const funnel = latest.value.funnel as unknown as Record<string, number> | undefined;
  const convRates = latest.value.conversionRates as unknown as Record<string, number> | undefined;
  const contact = latest.value.timeToFirstContact as unknown as Record<string, number | string | null> | undefined;
  const dataQuality = latest.value.dataQuality as unknown as
    | { tenantMoveIns: number; leadLinkageSparse: boolean }
    | undefined;

  const funnelStages: FunnelStage[] = funnel ? [
    { name: 'Guest Cards', count: funnel.guestCards ?? 0, rate: '—', color: '#0284c7' },
    { name: 'Applications', count: funnel.applications ?? 0, rate: `${convRates?.guestCardToApplication?.toFixed(0) ?? 0}% of leads`, color: '#6366f1' },
    { name: 'Approvals', count: funnel.approvals ?? 0, rate: `${convRates?.applicationToApproval?.toFixed(0) ?? 0}% of apps`, color: '#8b5cf6' },
    { name: 'Move-Ins', count: funnel.moveIns ?? 0, rate: `${convRates?.approvalToMoveIn?.toFixed(0) ?? 0}% of approved`, color: '#059669' },
  ] : [];

  const avgDays = (latest.value.avgDaysLeadToLease as number) ?? 0;
  const avgResponseHours = contact?.avgHoursToFirstContact as number | null;
  const contactDataSource = contact?.dataSource as string;

  return (
    <div className="glass glass-shine rounded-2xl p-6 lg:col-span-2">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center">
          <Filter className="w-4 h-4 text-rose-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Leasing Funnel</h4>
      </div>
      <StatPills
        stats={[
          { label: "Avg Lead-to-Lease", value: `${avgDays.toFixed(0)} days` },
          { label: "Best Conversion", value: `${stats.high.toFixed(1)}%` },
          { label: "Current", value: `${stats.current.toFixed(1)}%` },
          { label: "Avg Response", value: avgResponseHours != null ? `${avgResponseHours.toFixed(0)}h` : 'N/A' },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion rate line chart */}
        <div>
          <p className="text-xs font-medium text-charcoal-500 mb-2">Overall Conversion Rate</p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
              <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={LABEL_STYLE}
                formatter={((value: number) => [`${value.toFixed(1)}%`, "Conversion"]) as AnyFormatter}
              />
              {yearBoundaries(data).map((b) => (
                <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
              ))}
              <Area type="monotone" dataKey="overallConversion" stroke="#e11d48" strokeWidth={2} fill="#fecdd3" fillOpacity={0.3} dot={{ r: 3, fill: "#e11d48" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* Funnel bars */}
        <div>
          <p className="text-xs font-medium text-charcoal-500 mb-2">Current Period Funnel</p>
          {funnelStages.length > 0 ? (
            <FunnelBars stages={funnelStages} maxCount={funnelStages[0].count} />
          ) : (
            <p className="text-xs text-charcoal-400 py-8 text-center">No funnel data available</p>
          )}
          {dataQuality?.leadLinkageSparse && (
            <p className="mt-2 text-xs text-amber-700">
              Actual move-ins from tenant records: <span className="font-semibold">{dataQuality.tenantMoveIns}</span>.
              Since May 2026 AppFolio rarely links leads to applications or
              tenancies, so the Applications/Approvals/Move-Ins stages above
              undercount lead outcomes.
            </p>
          )}
          {/* Response time breakdown */}
          <div className="mt-4 pt-3 border-t border-sand-100">
            <p className="text-xs font-medium text-charcoal-500 mb-2">Response Time</p>
            {contactDataSource === 'unavailable' ? (
              <p className="text-xs text-charcoal-400 italic">
                Response time data not available. The AppFolio v0 /showings endpoint
                returns no results, and /communications is not exposed. Enable the Leads
                webhook topic to begin capturing response metrics via lead_events.
              </p>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1 rounded-lg bg-green-100 p-2 text-center">
                  <p className="text-lg font-bold text-green-700">{(contact?.pctContactedUnder1Hour as number)?.toFixed(0) ?? 0}%</p>
                  <p className="text-[10px] text-green-600">&lt;1 hour</p>
                </div>
                <div className="flex-1 rounded-lg bg-amber-100 p-2 text-center">
                  <p className="text-lg font-bold text-amber-700">{(contact?.pctContactedUnder24Hours as number)?.toFixed(0) ?? 0}%</p>
                  <p className="text-[10px] text-amber-600">&lt;24 hours</p>
                </div>
                <div className="flex-1 rounded-lg bg-red-100 p-2 text-center">
                  <p className="text-lg font-bold text-red-700">{(contact?.pctNeverContacted as number)?.toFixed(0) ?? 0}%</p>
                  <p className="text-[10px] text-red-600">Never</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <InsightLine text="Industry benchmark for guest card to lease conversion is 10–20% for residential property management." />
      <InsightLine text="The biggest drop-off stage identifies where to focus process improvement: high application drop-off suggests friction in the application process or uncompetitive pricing; high approval drop-off suggests screening criteria may be misaligned with the applicant pool." />
      <InsightLine text="Research shows leads contacted within 1 hour are 7x more likely to convert than those contacted after 24 hours. Response time is one of the highest-leverage improvements a leasing team can make." />
    </div>
  );
}

function ManagementFeesChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart name="Annual Management Fees" />;

  const multi = isMultiYear(data);
  const chartData = data.map((d) => ({
    date: d.date,
    feeCount: d.value.feeCount ?? 0,
    totalProperties: d.value.totalProperties ?? 0,
  }));

  const counts = chartData.map((d) => d.feeCount);
  const stats = computeStats(counts);
  const latest = chartData[chartData.length - 1];

  return (
    <div className="glass glass-shine rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
          <Receipt className="w-4 h-4 text-violet-600" />
        </div>
        <h4 className="text-sm font-semibold text-charcoal-700">Annual Management Fees</h4>
      </div>
      <StatPills
        stats={[
          { label: "Current", value: `${stats.current}` },
          { label: "Total Props", value: `${latest.totalProperties}` },
          { label: "High", value: `${stats.high}` },
          { label: "Low", value: `${stats.low}` },
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={X_TICK} axisLine={{ stroke: "rgba(0,0,0,0.08)" }} tickLine={false} tickFormatter={(v) => tickFormat(v, multi)} />
          <YAxis tick={Y_TICK} axisLine={false} tickLine={false} width={50} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={LABEL_STYLE}
            labelFormatter={tooltipLabel}
            formatter={((value: number, name: string) => {
              if (name === "feeCount") return [`${value}`, "With Mgmt Fee"];
              return [`${value}`, "Total Properties"];
            }) as AnyFormatter}
          />
          {yearBoundaries(data).map((b) => (
            <ReferenceLine key={b.rawDate} x={b.rawDate} {...YEAR_LINE_STYLE} label={{ value: String(b.year), position: "insideTopLeft", ...YEAR_LABEL_STYLE }} />
          ))}
          <Area type="monotone" dataKey="feeCount" stroke="#7c3aed" strokeWidth={2} fill="#ddd6fe" fillOpacity={0.3} dot={{ r: 3, fill: "#7c3aed" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================
// Page
// ============================================

export default function TrendsPage() {
  const [range, setRange] = useState<DateRange>("8w");
  const [trends, setTrends] = useState<Record<string, TrendPoint[]>>({});
  const [loading, setLoading] = useState(true);

  const fetchTrends = useCallback(async (r: DateRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/kpi/trends?range=${r}`);
      if (res.ok) {
        const data = await res.json();
        setTrends(data);
      }
    } catch {
      // Trends will show empty state
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTrends(range);
  }, [range, fetchTrends]);

  return (
    <div className="px-8 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8 animate-slide-up">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs text-charcoal-400 hover:text-charcoal-600 transition-colors mb-2"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Dashboard
            </Link>
            <p className="text-xs font-semibold text-terra-500 uppercase tracking-widest mb-1">
              KPI Trends
            </p>
            <h1 className="text-2xl font-bold text-charcoal-900 tracking-tight">
              Historical Performance
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Date range toggle */}
            <div className="flex bg-sand-100 rounded-lg p-0.5">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRange(opt.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    range === opt.value
                      ? "bg-white text-charcoal-900 shadow-sm"
                      : "text-charcoal-500 hover:text-charcoal-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => fetchTrends(range)}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-charcoal-600 bg-white border border-sand-200 rounded-lg hover:bg-sand-50 transition-all duration-150 disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => (
            <ChartSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 stagger-children">
          <DelinquencyChart data={trends.delinquency || []} />
          <VacancyChart data={trends.vacancy || []} />
          <WorkOrderChart data={trends.work_orders || []} />
          <NoticeChart data={trends.notices || []} />
          <InsuranceChart data={trends.insurance || []} />
          <OwnerRetentionChart data={trends.owner_retention || []} />
          <MaintenanceCostChart data={trends.maintenance_cost || []} />
          <DaysToLeaseChart data={trends.days_to_lease || []} />
          <LeaseRenewalChart data={trends.lease_renewal || []} />
          <NetDoorsChart data={trends.net_doors || []} />
          <GuestCardChart data={trends.guest_cards || []} />
          <LeasingFunnelChart data={trends.leasing_funnel || []} />
          <ManagementFeesChart data={trends.management_fees || []} />
        </div>
      )}
    </div>
  );
}
