"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  Home,
  Wrench,
  FileWarning,
  Shield,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  ArrowUpRight,
  Users,
  PieChart,
  Timer,
  Repeat,
  Building2,
  UserPlus,
  Filter,
  Receipt,
  CheckCircle2,
  MapPin,
  CalendarClock,
  ClipboardCheck,
  Hammer,
  Settings,
  X,
} from "lucide-react";

// ============================================
// Types
// ============================================

interface DelinquencyData {
  rate: number;
  totalDollars: number;
  count: number;
  totalActive?: number;
  dollarRatePct?: number | null;
  formerTenantDollars?: number;
}

interface VacancyData {
  rate: number;
  vacantCount: number;
  totalUnits: number;
}

interface WorkOrderData {
  avgDaysToClose: number;
  openCount: number;
}

interface NoticeData {
  thisWeek: number;
  last30Days: number;
}

interface InsuranceData {
  rate: number;
  compliantCount: number;
  totalCount: number;
}

interface OwnerRetentionData {
  rate: number;
  cancellationsLast30Days: number;
  totalOwners: number;
}

interface MaintenanceCostData {
  rate: number;
  maintenanceDollars: number;
  grossRentDollars: number;
}

interface DaysToLeaseData {
  avgDays: number;
  fastest: number;
  slowest: number;
  unitsLeased: number;
}

interface LeaseRenewalData {
  rate: number;
  renewals: number;
  moveOuts: number;
}

interface NetDoorsData {
  currentDoors: number;
  currentProperties: number;
  netThisMonth: number;
}

interface GuestCardData {
  today: number;
  thisWeek: number;
  thisMonth: number;
  lastWeek: number;
  lastMonth: number;
  weekOverWeekDelta: number;
  monthOverMonthDelta: number;
  sourceBreakdownWeek: Array<{ source: string; count: number }>;
  sourceBreakdownMonth: Array<{ source: string; count: number }>;
}

interface ManagementFeesData {
  totalProperties: number;
  avgFeePct?: number | null;
  tiers?: { pct: number; count: number }[];
  flatCount?: number;
  estAnnualFeeRevenue?: number | null;
  /** legacy shape (pre-2026-08-04 snapshots) */
  feeCount?: number;
}

interface OccupancyData {
  rate: number;
  occupiedCount: number;
  vacantCount: number;
  totalUnits: number;
  target: number;
}

interface BendGrowthData {
  bendUnits: number;
  totalUnits: number;
  bendPct: number;
  targetPct: number;
  bendAvgRent: number;
  nonBendAvgRent: number;
  premiumPct: number;
}

interface LeaseExpirationsData {
  within30: number;
  within60: number;
  within90: number;
  mtm: number;
  activeLeases: number;
}

interface WorkOrdersCompletedData {
  thisMonth: number;
  lastMonth: number;
  momDelta: number;
  last90Days: number;
}

interface MaintenanceEconomicsData {
  totalSpendTTM: number;
  inHouseDollars: number;
  outsourcedDollars: number;
  inHousePct: number;
  byCategory: Array<{ category: string; dollars: number }>;
  workOrdersCompletedTTM: number;
  costPerWorkOrder: number;
  costPerDoor: number;
}

interface LeasingFunnelData {
  period: string;
  funnel: {
    guestCards: number;
    applications: number;
    approvals: number;
    moveIns: number;
  };
  conversionRates: {
    guestCardToApplication: number;
    applicationToApproval: number;
    approvalToMoveIn: number;
    overallConversion: number;
  };
  avgDaysLeadToLease: number;
  timeToFirstContact: {
    avgHoursToFirstContact: number | null;
    pctContactedUnder1Hour: number | null;
    pctContactedUnder24Hours: number | null;
    pctNeverContacted: number | null;
    dataSource: string;
  };
  dataQuality?: {
    tenantMoveIns?: number;
    leadLinkageSparse?: boolean;
  };
}

type KpiData = DelinquencyData | VacancyData | WorkOrderData | NoticeData | InsuranceData
  | OwnerRetentionData | MaintenanceCostData | DaysToLeaseData | LeaseRenewalData | NetDoorsData
  | GuestCardData | LeasingFunnelData | ManagementFeesData
  | OccupancyData | BendGrowthData | LeaseExpirationsData | WorkOrdersCompletedData
  | MaintenanceEconomicsData;

// Compact money formatter for maintenance economics ($1.41M / $842k / $312)
function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

interface KpiState<T extends KpiData> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

type DeltaDirection = "up" | "down" | "flat";
type DeltaSentiment = "good" | "bad" | "neutral";

interface SparklinePoint {
  value: number;
}

interface KpiCardConfig {
  name: string;
  key: string;
  endpoint: string;
  icon: typeof DollarSign;
  color: string;
  bgColor: string;
  iconColor: string;
  sparkColor: string;
  sparkFill: string;
  dataTag: "live" | "mock" | "estimated";
  formatPrimary: (data: KpiData) => string;
  formatSecondary: (data: KpiData) => string;
  getSparklineValue: (snapshot: Record<string, unknown>) => number;
  getDelta: (current: KpiData, prior: Record<string, unknown>) => { direction: DeltaDirection; sentiment: DeltaSentiment; label: string } | null;
}

// ============================================
// KPI Card Configurations
// ============================================

const KPI_CARDS: KpiCardConfig[] = [
  {
    name: "Delinquency Rate",
    key: "delinquency",
    endpoint: "/api/kpi/delinquency",
    icon: DollarSign,
    color: "text-red-600",
    bgColor: "bg-red-100",
    iconColor: "text-red-600",
    sparkColor: "#dc2626",
    sparkFill: "#fecaca",
    dataTag: "live",
    formatPrimary: (d) => `${(d as DelinquencyData).rate}%`,
    formatSecondary: (d) => {
      const data = d as DelinquencyData;
      const base = `${data.count}${data.totalActive ? ` of ${data.totalActive}` : ""} current tenancies >$50 | $${data.totalDollars.toLocaleString()} owed`;
      return data.dollarRatePct != null ? `${base} (${data.dollarRatePct}% of rent roll)` : base;
    },
    getSparklineValue: (s) => (s.rate as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as DelinquencyData).rate;
      const prev = (prior as { rate?: number }).rate;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "bad" : "good",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Vacancy Rate",
    key: "vacancy",
    endpoint: "/api/kpi/vacancy",
    icon: Home,
    color: "text-amber-600",
    bgColor: "bg-amber-100",
    iconColor: "text-amber-600",
    sparkColor: "#d97706",
    sparkFill: "#fde68a",
    dataTag: "live",
    formatPrimary: (d) => `${(d as VacancyData).rate}%`,
    formatSecondary: (d) => {
      const data = d as VacancyData;
      return `${data.vacantCount} vacant of ${data.totalUnits} units`;
    },
    getSparklineValue: (s) => (s.rate as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as VacancyData).rate;
      const prev = (prior as { rate?: number }).rate;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "bad" : "good",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Work Order Cycle Time",
    key: "work_orders",
    endpoint: "/api/kpi/work-orders",
    icon: Wrench,
    color: "text-blue-600",
    bgColor: "bg-blue-100",
    iconColor: "text-blue-600",
    sparkColor: "#2563eb",
    sparkFill: "#bfdbfe",
    dataTag: "live",
    formatPrimary: (d) => `${(d as WorkOrderData).avgDaysToClose} days`,
    formatSecondary: (d) => `${(d as WorkOrderData).openCount} open work orders`,
    getSparklineValue: (s) => (s.avgDaysToClose as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as WorkOrderData).avgDaysToClose;
      const prev = (prior as { avgDaysToClose?: number }).avgDaysToClose;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.5) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "bad" : "good",
        label: `${Math.abs(diff).toFixed(1)} days`,
      };
    },
  },
  {
    name: "30-Day Notice Volume",
    key: "notices",
    endpoint: "/api/kpi/notices",
    icon: FileWarning,
    color: "text-purple-600",
    bgColor: "bg-purple-100",
    iconColor: "text-purple-600",
    sparkColor: "#9333ea",
    sparkFill: "#e9d5ff",
    dataTag: "live",
    formatPrimary: (d) => `${(d as NoticeData).thisWeek}`,
    formatSecondary: (d) => `${(d as NoticeData).last30Days} in last 30 days`,
    getSparklineValue: (s) => (s.last30Days as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as NoticeData).last30Days;
      const prev = (prior as { last30Days?: number }).last30Days;
      if (prev == null) return null;
      const diff = curr - prev;
      if (diff === 0) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: "neutral",
        label: `${Math.abs(diff)}`,
      };
    },
  },
  {
    name: "Insurance Compliance",
    key: "insurance",
    endpoint: "/api/kpi/insurance",
    icon: Shield,
    color: "text-green-600",
    bgColor: "bg-green-100",
    iconColor: "text-green-600",
    sparkColor: "#16a34a",
    sparkFill: "#bbf7d0",
    dataTag: "mock",
    formatPrimary: (d) => `${(d as InsuranceData).rate}%`,
    formatSecondary: (d) => {
      const data = d as InsuranceData;
      return `${data.compliantCount} of ${data.totalCount} compliant`;
    },
    getSparklineValue: (s) => (s.rate as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as InsuranceData).rate;
      const prev = (prior as { rate?: number }).rate;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Owner Retention",
    key: "owner_retention",
    endpoint: "/api/kpi/owner-retention",
    icon: Users,
    color: "text-indigo-600",
    bgColor: "bg-indigo-100",
    iconColor: "text-indigo-600",
    sparkColor: "#4f46e5",
    sparkFill: "#c7d2fe",
    dataTag: "live",
    formatPrimary: (d) => `${(d as OwnerRetentionData).rate}%`,
    formatSecondary: (d) => {
      const data = d as OwnerRetentionData;
      return `${data.cancellationsLast30Days} cancellations (30d) | ${data.totalOwners} owners`;
    },
    getSparklineValue: (s) => (s.rate as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as OwnerRetentionData).rate;
      const prev = (prior as { rate?: number }).rate;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Maintenance Cost %",
    key: "maintenance_cost",
    endpoint: "/api/kpi/maintenance-cost",
    icon: PieChart,
    color: "text-orange-600",
    bgColor: "bg-orange-100",
    iconColor: "text-orange-600",
    sparkColor: "#ea580c",
    sparkFill: "#fed7aa",
    dataTag: "live",
    formatPrimary: (d) => `${(d as MaintenanceCostData).rate}%`,
    formatSecondary: (d) => {
      const data = d as MaintenanceCostData;
      return `$${data.maintenanceDollars.toLocaleString()} of $${data.grossRentDollars.toLocaleString()} rent roll`;
    },
    getSparklineValue: (s) => (s.rate as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as MaintenanceCostData).rate;
      const prev = (prior as { rate?: number }).rate;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "bad" : "good",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Avg Days to Lease",
    key: "days_to_lease",
    endpoint: "/api/kpi/days-to-lease",
    icon: Timer,
    color: "text-cyan-600",
    bgColor: "bg-cyan-100",
    iconColor: "text-cyan-600",
    sparkColor: "#0891b2",
    sparkFill: "#a5f3fc",
    dataTag: "live",
    formatPrimary: (d) => `${(d as DaysToLeaseData).avgDays} days`,
    formatSecondary: (d) => {
      const data = d as DaysToLeaseData;
      return `${data.unitsLeased} leased | fastest ${data.fastest}d, slowest ${data.slowest}d`;
    },
    getSparklineValue: (s) => (s.avgDays as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as DaysToLeaseData).avgDays;
      const prev = (prior as { avgDays?: number }).avgDays;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.5) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "bad" : "good",
        label: `${Math.abs(diff).toFixed(1)} days`,
      };
    },
  },
  {
    name: "Lease Renewal Rate",
    key: "lease_renewal",
    endpoint: "/api/kpi/lease-renewal",
    icon: Repeat,
    color: "text-teal-600",
    bgColor: "bg-teal-100",
    iconColor: "text-teal-600",
    sparkColor: "#0d9488",
    sparkFill: "#99f6e4",
    dataTag: "live",
    formatPrimary: (d) => `${(d as LeaseRenewalData).rate}%`,
    formatSecondary: (d) => {
      const data = d as LeaseRenewalData;
      return `${data.renewals} renewals | ${data.moveOuts} move-outs`;
    },
    getSparklineValue: (s) => (s.rate as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as LeaseRenewalData).rate;
      const prev = (prior as { rate?: number }).rate;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Properties / Doors",
    key: "net_doors",
    endpoint: "/api/kpi/net-doors",
    icon: Building2,
    color: "text-emerald-600",
    bgColor: "bg-emerald-100",
    iconColor: "text-emerald-600",
    sparkColor: "#059669",
    sparkFill: "#a7f3d0",
    dataTag: "live",
    formatPrimary: (d) => {
      const data = d as NetDoorsData;
      return `${data.currentProperties} / ${data.currentDoors}`;
    },
    formatSecondary: (d) => {
      const data = d as NetDoorsData;
      const net = data.netThisMonth;
      const sign = net >= 0 ? "+" : "";
      return `${sign}${net} this month | Goal: 1,500 doors`;
    },
    getSparklineValue: (s) => (s.currentDoors as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as NetDoorsData).currentDoors;
      const prev = (prior as { currentDoors?: number }).currentDoors;
      if (prev == null) return null;
      const diff = curr - prev;
      if (diff === 0) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff)} doors`,
      };
    },
  },
  {
    name: "Guest Card Volume",
    key: "guest_cards",
    endpoint: "/api/kpi/guest-cards",
    icon: UserPlus,
    color: "text-sky-600",
    bgColor: "bg-sky-100",
    iconColor: "text-sky-600",
    sparkColor: "#0284c7",
    sparkFill: "#bae6fd",
    dataTag: "live",
    formatPrimary: (d) => `${(d as GuestCardData).thisWeek}`,
    formatSecondary: (d) => {
      const data = d as GuestCardData;
      const delta = data.weekOverWeekDelta;
      const sign = delta >= 0 ? "+" : "";
      const top3 = data.sourceBreakdownWeek.slice(0, 3).map((s) => `${s.source}: ${s.count}`).join("  |  ");
      return `Today: ${data.today}  |  Month: ${data.thisMonth}  |  ${sign}${delta} vs last week${top3 ? `\n${top3}` : ""}`;
    },
    getSparklineValue: (s) => (s.thisWeek as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as GuestCardData).thisWeek;
      const prev = (prior as { thisWeek?: number }).thisWeek;
      if (prev == null) return null;
      const diff = curr - prev;
      if (diff === 0) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff)} leads`,
      };
    },
  },
  {
    name: "Leasing Funnel",
    key: "leasing_funnel",
    endpoint: "/api/kpi/leasing-funnel",
    icon: Filter,
    color: "text-rose-600",
    bgColor: "bg-rose-100",
    iconColor: "text-rose-600",
    sparkColor: "#e11d48",
    sparkFill: "#fecdd3",
    dataTag: "live",
    formatPrimary: (d) => {
      const data = d as LeasingFunnelData;
      // AppFolio's May-2026 lead-lifecycle rewrite broke guest-card→app
      // linkage; when sparse, the stage counts/conversions are fiction —
      // show real tenant move-ins instead.
      if (data.dataQuality?.leadLinkageSparse && data.dataQuality.tenantMoveIns != null) {
        return `${data.dataQuality.tenantMoveIns}`;
      }
      return `${data.conversionRates.overallConversion}%`;
    },
    formatSecondary: (d) => {
      const data = d as LeasingFunnelData;
      const f = data.funnel;
      const contact = data.timeToFirstContact;
      const responseLine = contact.dataSource !== "unavailable" && contact.avgHoursToFirstContact != null
        ? `Avg response: ${contact.avgHoursToFirstContact.toFixed(0)}h  |  ${contact.pctContactedUnder1Hour?.toFixed(0)}% <1hr`
        : "Response time: data pending";
      if (data.dataQuality?.leadLinkageSparse) {
        return `move-ins (90d) | ${f.guestCards} leads — stage linkage broken in AppFolio since May\n${responseLine}`;
      }
      return `${f.guestCards} leads → ${f.applications} apps → ${f.approvals} approved → ${f.moveIns} move-ins\n${responseLine}`;
    },
    getSparklineValue: (s) => {
      const dq = s.dataQuality as { leadLinkageSparse?: boolean; tenantMoveIns?: number } | undefined;
      if (dq?.leadLinkageSparse && dq.tenantMoveIns != null) return dq.tenantMoveIns;
      const rates = s.conversionRates as Record<string, number> | undefined;
      return rates?.overallConversion ?? 0;
    },
    getDelta: (current, prior) => {
      const cur = current as LeasingFunnelData;
      const pri = prior as unknown as LeasingFunnelData;
      if (cur.dataQuality?.leadLinkageSparse) {
        const c = cur.dataQuality.tenantMoveIns;
        const p = pri.dataQuality?.tenantMoveIns;
        if (c == null || p == null) return null;
        const diff = c - p;
        if (diff === 0) return { direction: "flat", sentiment: "neutral", label: "No change" };
        return {
          direction: diff > 0 ? "up" : "down",
          sentiment: diff > 0 ? "good" : "bad",
          label: `${Math.abs(diff)} move-ins`,
        };
      }
      const curr = cur.conversionRates.overallConversion;
      const prev = pri.conversionRates?.overallConversion;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Annual Mgmt Fees",
    key: "management_fees",
    endpoint: "/api/kpi/management-fees",
    icon: Receipt,
    color: "text-violet-600",
    bgColor: "bg-violet-100",
    iconColor: "text-violet-600",
    sparkColor: "#7c3aed",
    sparkFill: "#ddd6fe",
    dataTag: "live",
    formatPrimary: (d) => {
      const data = d as ManagementFeesData;
      if (data.estAnnualFeeRevenue != null) {
        return `$${Math.round(data.estAnnualFeeRevenue / 1000)}k`;
      }
      return data.avgFeePct != null ? `${data.avgFeePct}%` : "—";
    },
    formatSecondary: (d) => {
      const data = d as ManagementFeesData;
      if (data.avgFeePct == null) return "Fee policy data unavailable";
      const topTiers = (data.tiers ?? [])
        .slice(0, 3)
        .map((t) => `${t.pct}%×${t.count}`)
        .join(" · ");
      return `est. annual fees | avg ${data.avgFeePct}% across ${data.totalProperties} properties${topTiers ? ` (${topTiers})` : ""}`;
    },
    getSparklineValue: (s) =>
      ((s.estAnnualFeeRevenue as number | null) ?? 0) / 1000,
    getDelta: (current, prior) => {
      const curr = (current as ManagementFeesData).estAnnualFeeRevenue;
      const prev = (prior as unknown as ManagementFeesData).estAnnualFeeRevenue;
      if (curr == null || prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 1000) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `$${Math.round(Math.abs(diff) / 1000)}k/yr`,
      };
    },
  },
  {
    name: "Occupancy",
    key: "occupancy",
    endpoint: "/api/kpi/occupancy",
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-100",
    iconColor: "text-green-600",
    sparkColor: "#16a34a",
    sparkFill: "#bbf7d0",
    dataTag: "live",
    formatPrimary: (d) => `${(d as OccupancyData).rate}%`,
    formatSecondary: (d) => {
      const data = d as OccupancyData;
      return `${data.occupiedCount} occupied of ${data.totalUnits} | target ${data.target}%`;
    },
    getSparklineValue: (s) => (s.rate as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as OccupancyData).rate;
      const prev = (prior as { rate?: number }).rate;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Bend Mix & Premium",
    key: "bend_growth",
    endpoint: "/api/kpi/bend-growth",
    icon: MapPin,
    color: "text-terra-600",
    bgColor: "bg-terra-100",
    iconColor: "text-terra-600",
    sparkColor: "#c2562d",
    sparkFill: "#f5d0c0",
    dataTag: "live",
    formatPrimary: (d) => `${(d as BendGrowthData).bendPct}%`,
    formatSecondary: (d) => {
      const data = d as BendGrowthData;
      const prem = data.premiumPct >= 0 ? `+${data.premiumPct}` : `${data.premiumPct}`;
      return `${data.bendUnits} of ${data.totalUnits} units in Bend | ${prem}% rent premium | target ${data.targetPct}%`;
    },
    getSparklineValue: (s) => (s.bendPct as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as BendGrowthData).bendPct;
      const prev = (prior as { bendPct?: number }).bendPct;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff).toFixed(1)}pp`,
      };
    },
  },
  {
    name: "Lease Expirations",
    key: "lease_expirations",
    endpoint: "/api/kpi/lease-expirations",
    icon: CalendarClock,
    color: "text-amber-600",
    bgColor: "bg-amber-100",
    iconColor: "text-amber-600",
    sparkColor: "#d97706",
    sparkFill: "#fde68a",
    dataTag: "live",
    formatPrimary: (d) => `${(d as LeaseExpirationsData).within30}`,
    formatSecondary: (d) => {
      const data = d as LeaseExpirationsData;
      return `${data.within30} in 30d | ${data.within60} in 60d | ${data.within90} in 90d | ${data.mtm} MTM`;
    },
    getSparklineValue: (s) => (s.within30 as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as LeaseExpirationsData).within30;
      const prev = (prior as { within30?: number }).within30;
      if (prev == null) return null;
      const diff = curr - prev;
      if (diff === 0) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return { direction: diff > 0 ? "up" : "down", sentiment: "neutral", label: `${Math.abs(diff)}` };
    },
  },
  {
    name: "Work Orders Completed",
    key: "work_orders_completed",
    endpoint: "/api/kpi/work-orders-completed",
    icon: ClipboardCheck,
    color: "text-blue-600",
    bgColor: "bg-blue-100",
    iconColor: "text-blue-600",
    sparkColor: "#2563eb",
    sparkFill: "#bfdbfe",
    dataTag: "live",
    formatPrimary: (d) => `${(d as WorkOrdersCompletedData).thisMonth}`,
    formatSecondary: (d) => {
      const data = d as WorkOrdersCompletedData;
      return `${data.lastMonth} last month | ${data.last90Days} in 90 days`;
    },
    getSparklineValue: (s) => (s.thisMonth as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as WorkOrdersCompletedData).thisMonth;
      const prev = (prior as { thisMonth?: number }).thisMonth;
      if (prev == null) return null;
      const diff = curr - prev;
      if (diff === 0) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return { direction: diff > 0 ? "up" : "down", sentiment: "neutral", label: `${Math.abs(diff)}` };
    },
  },
  {
    name: "Maintenance Economics",
    key: "maintenance_economics",
    endpoint: "/api/kpi/maintenance-economics",
    icon: Hammer,
    color: "text-orange-600",
    bgColor: "bg-orange-100",
    iconColor: "text-orange-600",
    sparkColor: "#ea580c",
    sparkFill: "#fed7aa",
    dataTag: "live",
    formatPrimary: (d) => fmtMoney((d as MaintenanceEconomicsData).totalSpendTTM),
    formatSecondary: (d) => {
      const data = d as MaintenanceEconomicsData;
      return `TTM spend | In-house ${data.inHousePct}% · ${fmtMoney(data.costPerDoor)}/door · ${data.workOrdersCompletedTTM} WOs`;
    },
    getSparklineValue: (s) => (s.inHousePct as number) ?? 0,
    getDelta: (current, prior) => {
      const curr = (current as MaintenanceEconomicsData).inHousePct;
      const prev = (prior as { inHousePct?: number }).inHousePct;
      if (prev == null) return null;
      const diff = curr - prev;
      if (Math.abs(diff) < 0.1) return { direction: "flat", sentiment: "neutral", label: "No change" };
      return {
        direction: diff > 0 ? "up" : "down",
        sentiment: diff > 0 ? "good" : "bad",
        label: `${Math.abs(diff).toFixed(1)}pp in-house`,
      };
    },
  },
];

// ============================================
// Components
// ============================================

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-sand-200 p-6 shadow-card animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 bg-sand-100 rounded-xl" />
        <div className="w-16 h-4 bg-sand-100 rounded" />
      </div>
      <div className="w-24 h-8 bg-sand-100 rounded mb-2" />
      <div className="w-40 h-4 bg-sand-100 rounded mb-4" />
      <div className="h-10 bg-sand-50 rounded" />
    </div>
  );
}

function DeltaArrow({
  direction,
  sentiment,
  label,
}: {
  direction: DeltaDirection;
  sentiment: DeltaSentiment;
  label: string;
}) {
  const colorMap = {
    good: "text-green-600",
    bad: "text-red-500",
    neutral: "text-charcoal-400",
  };

  const Icon = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;

  return (
    <div className={`flex items-center gap-1 text-xs font-medium ${colorMap[sentiment]}`}>
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
}

function Sparkline({
  data,
  color,
  fill,
}: {
  data: SparklinePoint[];
  color: string;
  fill: string;
}) {
  if (data.length < 2) return null;

  return (
    <div className="mt-3 -mx-1">
      <ResponsiveContainer width="100%" height={40}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={fill}
            fillOpacity={0.3}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({
  config,
  state,
  priorSnapshot,
  sparklineData,
  refreshing,
}: {
  config: KpiCardConfig;
  state: KpiState<KpiData>;
  priorSnapshot: Record<string, unknown> | undefined;
  sparklineData: SparklinePoint[];
  refreshing?: boolean;
}) {
  const Icon = config.icon;

  // Only show skeleton if no data at all (first load before cache arrives)
  if (state.loading && !state.data) return <SkeletonCard />;

  if (state.error) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-6 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div className={`w-11 h-11 ${config.bgColor} rounded-xl flex items-center justify-center opacity-50`}>
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          </div>
          <AlertCircle className="w-4 h-4 text-red-400" />
        </div>
        <h3 className="text-sm font-medium text-charcoal-500 mb-1">{config.name}</h3>
        <p className="text-xs text-red-400">{state.error}</p>
      </div>
    );
  }

  if (!state.data) return <SkeletonCard />;

  const delta = priorSnapshot ? config.getDelta(state.data, priorSnapshot) : null;

  return (
    <Link
      href="/dashboard/trends"
      className="bg-white rounded-xl border border-sand-200 p-6 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 block cursor-pointer"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 ${config.bgColor} rounded-xl flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>
        <div className="flex items-center gap-2">
          {refreshing && (
            <RefreshCw className="w-3 h-3 text-charcoal-300 animate-spin" />
          )}
          {delta && (
            <DeltaArrow
              direction={delta.direction}
              sentiment={delta.sentiment}
              label={delta.label}
            />
          )}
        </div>
      </div>
      <p className={`text-2xl font-bold ${config.color} mb-1 tracking-tight`}>
        {config.formatPrimary(state.data)}
      </p>
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-medium text-charcoal-900">{config.name}</h3>
        {config.dataTag !== "live" && (
          <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
            config.dataTag === "mock"
              ? "bg-charcoal-100 text-charcoal-400"
              : "bg-amber-100 text-amber-600"
          }`}>
            {config.dataTag === "mock" ? "Mock Data" : "Estimated"}
          </span>
        )}
      </div>
      <p className="text-xs text-charcoal-400">{config.formatSecondary(state.data)}</p>
      <Sparkline data={sparklineData} color={config.sparkColor} fill={config.sparkFill} />
    </Link>
  );
}

// ============================================
// Config Drawer
// ============================================

interface DashboardConfig {
  internalVendorIds: string[];
  targets: {
    bendMixPct: number;
    occupancyPct: number;
    doorsGoal: number;
    netIncomeGoal: number;
    ownerCashGoal: number;
    maintBillableRateMin: number;
  };
  financials: {
    loanBalance: number;
    loanRatePct: number;
    annualDebtService: number;
    staffAnnualCost: number;
    gmAnnualCost: number;
    ownerDrawTarget: number;
  };
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-charcoal-500">{label}</span>
      <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-sand-200 bg-white px-2.5 focus-within:border-terra-300">
        {prefix && <span className="text-xs text-charcoal-400">{prefix}</span>}
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent py-2 text-sm text-charcoal-900 outline-none"
        />
        {suffix && <span className="text-xs text-charcoal-400">{suffix}</span>}
      </div>
    </label>
  );
}

function ConfigDrawer({
  open,
  onClose,
  config,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  config: DashboardConfig | null;
  onSaved: (c: DashboardConfig) => void;
}) {
  const [draft, setDraft] = useState<DashboardConfig | null>(config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  if (!open) return null;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onSaved(await res.json());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const setTarget = (k: keyof DashboardConfig["targets"], v: number) =>
    setDraft((d) => (d ? { ...d, targets: { ...d.targets, [k]: v } } : d));
  const setFin = (k: keyof DashboardConfig["financials"], v: number) =>
    setDraft((d) => (d ? { ...d, financials: { ...d.financials, [k]: v } } : d));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-charcoal-900/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-sand-50 shadow-xl animate-slide-up">
        <div className="sticky top-0 z-10 flex items-center justify-between glass-chrome scroll-edge-fade px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-terra-500">
              Dashboard Config
            </p>
            <h2 className="text-lg font-bold text-charcoal-900">Targets & Inputs</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-charcoal-400 hover:bg-sand-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!draft ? (
          <div className="p-6 space-y-3 animate-pulse">
            <div className="h-4 w-40 rounded bg-sand-100" />
            <div className="h-9 w-full rounded bg-sand-100" />
            <div className="h-9 w-full rounded bg-sand-50" />
          </div>
        ) : (
          <div className="space-y-6 p-6">
            {/* Internal vendors */}
            <section>
              <h3 className="mb-1 text-sm font-semibold text-charcoal-900">
                In-house maintenance vendors
              </h3>
              <p className="mb-2 text-xs text-charcoal-400">
                AppFolio vendor IDs counted as in-house (HDPM&apos;s own crew). One per line.
                Powers the in-house vs outsourced split.
              </p>
              <textarea
                value={draft.internalVendorIds.join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    internalVendorIds: e.target.value
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                rows={3}
                className="w-full rounded-lg border border-sand-200 bg-white p-2.5 font-mono text-xs text-charcoal-900 outline-none focus:border-terra-300"
              />
            </section>

            {/* Targets */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-charcoal-900">KPI targets</h3>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Bend mix target" value={draft.targets.bendMixPct} onChange={(v) => setTarget("bendMixPct", v)} suffix="%" />
                <NumberField label="Occupancy target" value={draft.targets.occupancyPct} onChange={(v) => setTarget("occupancyPct", v)} suffix="%" />
                <NumberField label="Doors goal" value={draft.targets.doorsGoal} onChange={(v) => setTarget("doorsGoal", v)} />
                <NumberField label="Billable rate floor" value={draft.targets.maintBillableRateMin} onChange={(v) => setTarget("maintBillableRateMin", v)} prefix="$" suffix="/hr" />
              </div>
            </section>

            {/* Financials */}
            <section>
              <h3 className="mb-1 text-sm font-semibold text-charcoal-900">Financial inputs</h3>
              <p className="mb-3 text-xs text-charcoal-400">
                Power the Financials panel (net income, owner cash, DSCR).
                <strong className="text-charcoal-500"> Annual staff cost is required</strong> —
                QuickBooks doesn&apos;t book payroll, so without it true NOI can&apos;t be computed.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Annual staff cost (incl. GM)" value={draft.financials.staffAnnualCost} onChange={(v) => setFin("staffAnnualCost", v)} prefix="$" />
                <NumberField label="Annual debt service (P&I)" value={draft.financials.annualDebtService} onChange={(v) => setFin("annualDebtService", v)} prefix="$" />
                <NumberField label="Loan balance" value={draft.financials.loanBalance} onChange={(v) => setFin("loanBalance", v)} prefix="$" />
                <NumberField label="Loan rate" value={draft.financials.loanRatePct} onChange={(v) => setFin("loanRatePct", v)} suffix="%" />
                <NumberField label="GM annual cost (info)" value={draft.financials.gmAnnualCost} onChange={(v) => setFin("gmAnnualCost", v)} prefix="$" />
                <NumberField label="Owner draw target" value={draft.financials.ownerDrawTarget} onChange={(v) => setFin("ownerDrawTarget", v)} prefix="$" />
              </div>
            </section>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex items-center justify-end gap-3 border-t border-sand-200 pt-4">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-charcoal-500 hover:text-charcoal-700">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-terra-600 px-4 py-2 text-sm font-medium text-white hover:bg-terra-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Section A — Financials panel (QuickBooks)
// ============================================

interface FinancialsResponse {
  seeded: boolean;
  source?: string;
  note?: string | null;
  periodStart?: string;
  periodEnd?: string;
  capturedAt?: string;
  revenueTTM?: number;
  bookedOpexTTM?: number;
  qbNetIncomeTTM?: number;
  staffAnnualCost?: number;
  annualDebtService?: number;
  goals?: { netIncomeGoal: number; ownerCashGoal: number };
  needsStaffCost?: boolean;
  adjustedNoiTTM?: number | null;
  noiMarginPct?: number | null;
  ownerDistributableCash?: number | null;
  dscr?: number | null;
  noiProgressPct?: number | null;
  ownerCashProgressPct?: number | null;
}

function FinancialsPanel({
  data,
  loading,
  onOpenConfig,
}: {
  data: FinancialsResponse | null;
  loading: boolean;
  onOpenConfig: () => void;
}) {
  const needsConfig = data?.seeded && data?.needsStaffCost;

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-terra-500 uppercase tracking-widest">
            Financials
          </p>
          <h2 className="text-lg font-bold text-charcoal-900 tracking-tight">
            Net income, owner cash &amp; DSCR
          </h2>
        </div>
        {data?.seeded && data.periodEnd && (
          <p className="text-xs text-charcoal-400">
            QuickBooks · TTM thru{" "}
            {new Date(data.periodEnd + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </p>
        )}
      </div>

      {!data && loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-white rounded-xl border border-sand-200 shadow-card animate-pulse" />
          ))}
        </div>
      ) : !data?.seeded ? (
        <div className="bg-white rounded-xl border border-sand-200 p-6 shadow-card text-sm text-charcoal-500">
          No QuickBooks financials seeded yet. Run{" "}
          <code className="text-xs bg-sand-100 px-1.5 py-0.5 rounded">node scripts/seed-financials.js</code>{" "}
          to load the P&L.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-white rounded-xl border border-sand-200 p-5 shadow-card">
              <p className="text-xs font-medium text-charcoal-500">Revenue (TTM)</p>
              <p className="mt-1 text-2xl font-bold text-charcoal-900 tracking-tight">
                {fmtMoney(data.revenueTTM ?? 0)}
              </p>
              <p className="mt-3 text-xs text-charcoal-400">
                Booked opex {fmtMoney(data.bookedOpexTTM ?? 0)} · from QuickBooks
              </p>
            </div>

            <div className="bg-white rounded-xl border border-sand-200 p-5 shadow-card">
              <p className="text-xs font-medium text-charcoal-500">Net Income (TTM)</p>
              <p className="mt-1 text-2xl font-bold text-charcoal-900 tracking-tight">
                {data.adjustedNoiTTM != null ? fmtMoney(data.adjustedNoiTTM) : "—"}
              </p>
              <p className="mt-3 text-xs text-charcoal-400">
                {data.adjustedNoiTTM != null
                  ? data.noiMarginPct != null
                    ? `${data.noiMarginPct}% margin · after staff cost`
                    : "after staff cost"
                  : "set staff cost in config"}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-sand-200 p-5 shadow-card">
              <p className="text-xs font-medium text-charcoal-500">Owner Cash (TTM)</p>
              <p className="mt-1 text-2xl font-bold text-charcoal-900 tracking-tight">
                {data.ownerDistributableCash != null ? fmtMoney(data.ownerDistributableCash) : "—"}
              </p>
              <p className="mt-3 text-xs text-charcoal-400">
                {data.ownerDistributableCash != null
                  ? "after debt service"
                  : "set staff cost + debt service"}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-sand-200 p-5 shadow-card">
              <p className="text-xs font-medium text-charcoal-500">DSCR</p>
              <p className="mt-1 text-2xl font-bold text-charcoal-900 tracking-tight">
                {data.dscr != null ? `${data.dscr.toFixed(2)}×` : "—"}
              </p>
              <p className="mt-3 text-xs text-charcoal-400">
                {data.dscr != null
                  ? `target > 1.5× · NOI ÷ debt service`
                  : data.needsStaffCost
                    ? "set staff cost in config"
                    : "set debt service in config"}
              </p>
            </div>
          </div>

          {needsConfig && (
            <button
              onClick={onOpenConfig}
              className="mt-3 text-xs font-medium text-terra-600 hover:text-terra-700"
            >
              ⚙ QuickBooks doesn&apos;t book payroll — enter annual staff cost in config to compute true NOI, owner cash & DSCR →
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ============================================
// Page
// ============================================

export default function DashboardPage() {
  const [kpis, setKpis] = useState<Record<string, KpiState<KpiData>>>(() => {
    const initial: Record<string, KpiState<KpiData>> = {};
    for (const card of KPI_CARDS) {
      initial[card.key] = { data: null, loading: true, error: null };
    }
    return initial;
  });
  const [priorSnapshots, setPriorSnapshots] = useState<Record<string, Record<string, unknown>>>({});
  const [sparklines, setSparklines] = useState<Record<string, SparklinePoint[]>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingKeys, setRefreshingKeys] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [financials, setFinancials] = useState<FinancialsResponse | null>(null);
  const [financialsLoading, setFinancialsLoading] = useState(true);

  // Load cached data from Supabase (instant — no AppFolio API calls)
  const loadCached = useCallback(async () => {
    try {
      const res = await fetch("/api/kpi/cached");
      if (!res.ok) return;
      const cached: Record<string, { value: Record<string, unknown>; capturedAt: string }> = await res.json();

      for (const card of KPI_CARDS) {
        const entry = cached[card.key];
        if (entry) {
          setKpis((prev) => ({
            ...prev,
            [card.key]: { data: entry.value as unknown as KpiData, loading: false, error: null },
          }));
        }
      }

      // Use the most recent capturedAt as lastUpdated
      const timestamps = Object.values(cached).map((e) => new Date(e.capturedAt).getTime());
      if (timestamps.length > 0) {
        setLastUpdated(new Date(Math.max(...timestamps)));
      }
    } catch {
      // Fall through to live fetch
    }

    // Also load sparklines and prior snapshots (fast Supabase queries)
    try {
      const [snapRes, histRes] = await Promise.all([
        fetch("/api/kpi/snapshots"),
        fetch("/api/kpi/snapshots?history=14"),
      ]);
      if (snapRes.ok) {
        setPriorSnapshots(await snapRes.json());
      }
      if (histRes.ok) {
        const data: Record<string, Array<{ date: string; value: Record<string, unknown> }>> = await histRes.json();
        const sparkData: Record<string, SparklinePoint[]> = {};
        for (const card of KPI_CARDS) {
          const history = data[card.key] || [];
          sparkData[card.key] = history.map((h) => ({
            value: card.getSparklineValue(h.value),
          }));
        }
        setSparklines(sparkData);
      }
    } catch {
      // Non-critical
    }
  }, []);

  // Live refresh from AppFolio (slow — batched to avoid 429)
  const refreshLive = useCallback(async () => {
    setRefreshing(true);

    const BATCH_SIZE = 3;
    const fetchCard = async (card: KpiCardConfig) => {
      setRefreshingKeys((prev) => new Set(prev).add(card.key));
      try {
        const res = await fetch(card.endpoint);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setKpis((prev) => ({
          ...prev,
          [card.key]: { data, loading: false, error: null },
        }));
      } catch (err) {
        setKpis((prev) => ({
          ...prev,
          [card.key]: {
            data: prev[card.key].data,
            loading: false,
            error: err instanceof Error ? err.message : "Unknown error",
          },
        }));
      } finally {
        setRefreshingKeys((prev) => {
          const next = new Set(prev);
          next.delete(card.key);
          return next;
        });
      }
    };

    for (let i = 0; i < KPI_CARDS.length; i += BATCH_SIZE) {
      const batch = KPI_CARDS.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(fetchCard));
    }

    setLastUpdated(new Date());
    setRefreshing(false);

    // Refresh sparklines after live data is in
    try {
      const [snapRes, histRes] = await Promise.all([
        fetch("/api/kpi/snapshots"),
        fetch("/api/kpi/snapshots?history=14"),
      ]);
      if (snapRes.ok) setPriorSnapshots(await snapRes.json());
      if (histRes.ok) {
        const data: Record<string, Array<{ date: string; value: Record<string, unknown> }>> = await histRes.json();
        const sparkData: Record<string, SparklinePoint[]> = {};
        for (const card of KPI_CARDS) {
          const history = data[card.key] || [];
          sparkData[card.key] = history.map((h) => ({
            value: card.getSparklineValue(h.value),
          }));
        }
        setSparklines(sparkData);
      }
    } catch {
      // Non-critical
    }
  }, []);

  // On mount: load cached instantly, no automatic live refresh
  useEffect(() => {
    loadCached();
  }, [loadCached]);

  // Load dashboard config (targets, internal vendors, financial inputs)
  useEffect(() => {
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((c) => c && setConfig(c))
      .catch(() => {});
  }, []);

  // Load Section A financials (QuickBooks). Re-run when config changes so the
  // NOI/owner-cash gauges update right after staff cost is saved.
  const loadFinancials = useCallback(async () => {
    setFinancialsLoading(true);
    try {
      const res = await fetch("/api/financials");
      if (res.ok) setFinancials(await res.json());
    } catch {
      // non-critical
    } finally {
      setFinancialsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFinancials();
  }, [loadFinancials, config]);

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8 animate-slide-up">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-terra-500 uppercase tracking-widest mb-1">
              KPI Dashboard
            </p>
            <h1 className="text-2xl font-bold text-charcoal-900 tracking-tight">
              Weekly Metrics
            </h1>
            {lastUpdated && (
              <p className="text-xs text-charcoal-400 mt-1">
                Last updated{" "}
                {lastUpdated.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/Los_Angeles",
                })}{" "}
                PT
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/trends"
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-terra-600 bg-terra-50 border border-terra-200 rounded-lg hover:bg-terra-100 transition-all duration-150 shadow-sm"
            >
              View Trends
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={refreshLive}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-charcoal-600 bg-white border border-sand-200 rounded-lg hover:bg-sand-50 hover:border-sand-300 transition-all duration-150 disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh Live"}
            </button>
            <button
              onClick={() => setConfigOpen(true)}
              title="Dashboard config"
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-charcoal-600 bg-white border border-sand-200 rounded-lg hover:bg-sand-50 hover:border-sand-300 transition-all duration-150 shadow-sm"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <ConfigDrawer
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        onSaved={setConfig}
      />

      {/* Section A — Financials (QuickBooks) */}
      <FinancialsPanel
        data={financials}
        loading={financialsLoading}
        onOpenConfig={() => setConfigOpen(true)}
      />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
        {KPI_CARDS.map((card) => (
          <KpiCard
            key={card.key}
            config={card}
            state={kpis[card.key]}
            priorSnapshot={priorSnapshots[card.key]}
            sparklineData={sparklines[card.key] || []}
            refreshing={refreshingKeys.has(card.key)}
          />
        ))}
      </div>

      {/* Footer note */}
      <div className="mt-8 animate-slide-up" style={{ animationDelay: "200ms" }}>
        <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-card">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-charcoal-300 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-charcoal-400 leading-relaxed">
              <strong className="text-charcoal-500">Data sources:</strong>{" "}
              All tiles pull live from AppFolio v0 except Insurance Compliance, which shows
              placeholder data — AppFolio does not expose renter&apos;s insurance status, so this
              KPI is pending an out-of-band tracking source. Leasing Funnel response time is also
              unavailable from AppFolio and renders &ldquo;data pending&rdquo;; funnel stages themselves are live.
              Sparklines and trend charts populate as daily snapshots accumulate.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
