/**
 * Fee Schedule — trailing-12-month event volumes that ancillary fees apply
 * to. Read-only AppFolio v0 pulls + the latest maintenance KPI snapshot.
 *
 * The dashboard KPIs use 90-day windows; annualizing a (seasonal) quarter
 * would overstate leasing, so these count the actual last 365 days.
 */

import { getKpiConfig, v0FetchAll } from '@/lib/appfolio-kpi';
import { getSupabaseAdmin } from '@/lib/supabase';

export interface FeeVolumes {
  /** New tenancies: distinct unit + move-in date in the last 365 days (roommates count once). */
  newLeases: number;
  /** Lease renewals: distinct occupancy + renewal date in the last 365 days. */
  renewals: number;
  /** Outside-vendor maintenance spend, trailing 12 months (maintenance_economics KPI) — the base a markup applies to. */
  vendorSpend: number | null;
  /** Properties whose management ended in the window, and the active count — HDPM's own owner churn. */
  endedProperties: number;
  activeProperties: number;
  windowStart: string;
  windowEnd: string;
}

interface Tenant {
  UnitId?: string;
  MoveInOn?: string;
  HiddenAt?: string | null;
}

interface Property {
  HiddenAt?: string | null;
  ManagementEndDate?: string | null;
}

interface Lease {
  OccupancyId: string;
  RenewedOn: string | null;
}

export async function fetchFeeVolumes(): Promise<FeeVolumes> {
  const config = getKpiConfig();
  if (!config) throw new Error('AppFolio API credentials not configured');
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 365);
  const from = start.toISOString();
  const inWindow = (d: string | null | undefined) => !!d && d >= from.slice(0, 10) && d <= end.toISOString().slice(0, 10);

  // Sequential: the v0 API 429s readily.
  const tenants = await v0FetchAll<Tenant>('/tenants', { 'filters[LastUpdatedAtFrom]': from }, config, 1000, 30);
  const leases = await v0FetchAll<Lease>('/leases', { 'filters[LastUpdatedAtFrom]': from }, config, 1000, 30);
  const properties = await v0FetchAll<Property>('/properties', { 'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z' }, config, 1000, 10);

  const moveIns = new Set<string>();
  for (const t of tenants) {
    if (t.HiddenAt || !t.UnitId || !inWindow(t.MoveInOn)) continue;
    moveIns.add(`${t.UnitId}|${t.MoveInOn}`);
  }
  const renewals = new Set<string>();
  for (const l of leases) {
    if (inWindow(l.RenewedOn)) renewals.add(`${l.OccupancyId}|${l.RenewedOn}`);
  }

  const { data } = await getSupabaseAdmin()
    .from('kpi_snapshots')
    .select('value')
    .eq('kpi_name', 'maintenance_economics')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const spend = Number((data?.value as { outsourcedDollars?: number } | undefined)?.outsourcedDollars);

  return {
    newLeases: moveIns.size,
    renewals: renewals.size,
    vendorSpend: Number.isFinite(spend) ? Math.round(spend) : null,
    endedProperties: properties.filter((p) => inWindow(p.ManagementEndDate)).length,
    activeProperties: properties.filter((p) => !p.HiddenAt && !p.ManagementEndDate).length,
    windowStart: from.slice(0, 10),
    windowEnd: end.toISOString().slice(0, 10),
  };
}
