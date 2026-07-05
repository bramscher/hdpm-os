/**
 * Maintenance OS — vendor profiles, sync, and ranking.
 *
 * The sync only maintains {appfolio_vendor_id, name}; every profile field
 * (trades, license, insurance, rates, …) is seeded manually by Cheryl and
 * survives sync upserts because the sync payload never includes them.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type { Vendor, VendorAssignment } from './types';

// ============================================
// Sync (called from the AppFolio work-order sync route)
// ============================================

/**
 * Upsert AppFolio vendors into the vendor table by appfolio_vendor_id.
 * Payload = {appfolio_vendor_id, name} ONLY — manual profile fields survive.
 */
export async function syncVendors(vendorMap: Map<string, string>): Promise<number> {
  if (vendorMap.size === 0) return 0;
  const supabase = getSupabaseAdmin();

  const rows = Array.from(vendorMap.entries()).map(([appfolioVendorId, name]) => ({
    appfolio_vendor_id: appfolioVendorId,
    name: name || 'Unknown Vendor',
  }));

  let count = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('vendor')
      .upsert(batch, { onConflict: 'appfolio_vendor_id' });
    if (error) {
      console.error('[Vendors] Sync upsert failed:', error.message);
    } else {
      count += batch.length;
    }
  }
  return count;
}

// ============================================
// CRUD
// ============================================

export async function listVendors(activeOnly = false): Promise<Vendor[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase.from('vendor').select('*').order('name');
  if (activeOnly) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) {
    console.error('[Vendors] List failed:', error.message);
    return [];
  }
  return (data ?? []) as Vendor[];
}

export async function createVendor(fields: Partial<Vendor> & { name: string }): Promise<Vendor> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('vendor').insert(fields).select('*').single();
  if (error || !data) throw new Error(`Failed to create vendor: ${error?.message}`);
  return data as Vendor;
}

export async function updateVendor(id: string, fields: Partial<Vendor>): Promise<Vendor> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('vendor')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new Error(`Failed to update vendor: ${error?.message}`);
  return data as Vendor;
}

// ============================================
// Distribution helpers (pure)
// ============================================

/** Median of a numeric array. Returns null when empty. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 90th percentile (nearest-rank). Returns null when empty. */
export function p90Of(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
}

// ============================================
// Historical cycle-time stats (Session C) — pure
//
// Seeds the scoreboard from the closed-WO mirror (incl. grandfathered rows)
// so vendor rankings mean something on day one, before the rolling-90d
// assignment metrics accumulate. Cycle time = AppFolio created → completed,
// calendar days. Rows lacking either date (or with negative durations from
// data noise) are excluded.
//
// Note: the redirect brief asked for "overdue-at-close rate", but historical
// rows carry no promised dates — %-of-jobs-over-30-days is the substitute.
// ============================================

export interface VendorHistory {
  n: number;
  medianDays: number;
  p90Days: number;
  pctOver30: number;
}

export interface HistoryRow {
  vendor_id: string | null;
  appfolio_created_at: string | null;
  completed_date: string | null;
}

/** Per-AppFolio-vendor-id cycle-time stats from closed WOs. Pure. */
export function computeVendorHistory(rows: HistoryRow[]): Map<string, VendorHistory> {
  const cycleDaysByVendor = new Map<string, number[]>();

  for (const row of rows) {
    if (!row.vendor_id || !row.appfolio_created_at || !row.completed_date) continue;
    const days =
      (new Date(row.completed_date).getTime() - new Date(row.appfolio_created_at).getTime()) /
      86_400_000;
    if (days < 0) continue; // data noise
    const list = cycleDaysByVendor.get(row.vendor_id) ?? [];
    list.push(days);
    cycleDaysByVendor.set(row.vendor_id, list);
  }

  const result = new Map<string, VendorHistory>();
  for (const [vendorId, days] of cycleDaysByVendor) {
    result.set(vendorId, {
      n: days.length,
      medianDays: Math.round(medianOf(days)!),
      p90Days: Math.round(p90Of(days)!),
      pctOver30: Math.round((days.filter((d) => d > 30).length / days.length) * 100),
    });
  }
  return result;
}

// ============================================
// Ranking (pure) — rolling 90 days
// score = 0.3*acceptSpeed + 0.25*completionSpeed + 0.25*(1-callbackRate) + 0.2*docsCompliance
// (seed formula from docs/maintenance-os/05-data-model.md; tune at Monday reviews)
// ============================================

export interface VendorPerformance {
  vendorId: string;
  name: string;
  assignments90d: number;
  avgAcceptHours: number | null;
  avgCompletionDays: number | null;
  callbackRate: number;
  docsCompliance: number;
  demoted: boolean;
  score: number;
}

const NINETY_DAYS_MS = 90 * 86_400_000;

/** Normalize accept latency: ≤4h → 1, ≥72h → 0, linear between. */
function acceptSpeedScore(hours: number | null): number {
  if (hours === null) return 0.5; // no data — neutral
  if (hours <= 4) return 1;
  if (hours >= 72) return 0;
  return 1 - (hours - 4) / 68;
}

/** Normalize completion time: ≤3d → 1, ≥14d → 0, linear between. */
function completionSpeedScore(days: number | null): number {
  if (days === null) return 0.5; // no data — neutral
  if (days <= 3) return 1;
  if (days >= 14) return 0;
  return 1 - (days - 3) / 11;
}

/** Profile-based docs compliance: insurance unexpired, W-9, license valid where required. */
export function docsComplianceScore(vendor: Vendor, now: Date): number {
  const checks: boolean[] = [];
  const today = now.toISOString().slice(0, 10);

  checks.push(!!vendor.insurance_expiry && vendor.insurance_expiry >= today);
  checks.push(vendor.w9_on_file);
  const licenseRequired = (vendor.license_required_trades?.length ?? 0) > 0;
  if (licenseRequired) {
    checks.push(
      !!vendor.license_number && !!vendor.license_expiry && vendor.license_expiry >= today
    );
  }

  return checks.filter(Boolean).length / checks.length;
}

/**
 * Compute 90-day performance + ranking score per vendor. Pure.
 * `demoted` (Monday-review override) forces score 0 — bottom of every list.
 */
export function computeVendorScores(
  vendors: Vendor[],
  assignments: VendorAssignment[],
  now: Date
): VendorPerformance[] {
  const cutoff = now.getTime() - NINETY_DAYS_MS;

  return vendors
    .map((vendor) => {
      const recent = assignments.filter(
        (a) => a.vendor_id === vendor.id && new Date(a.sent_at).getTime() >= cutoff
      );

      const acceptLatencies = recent
        .filter((a) => a.accepted_at)
        .map((a) => (new Date(a.accepted_at!).getTime() - new Date(a.sent_at).getTime()) / 3600_000);
      const avgAcceptHours =
        acceptLatencies.length > 0
          ? acceptLatencies.reduce((s, v) => s + v, 0) / acceptLatencies.length
          : null;

      const completionTimes = recent
        .filter((a) => a.accepted_at && a.completed_at)
        .map(
          (a) =>
            (new Date(a.completed_at!).getTime() - new Date(a.accepted_at!).getTime()) / 86_400_000
        );
      const avgCompletionDays =
        completionTimes.length > 0
          ? completionTimes.reduce((s, v) => s + v, 0) / completionTimes.length
          : null;

      const completed = recent.filter((a) => a.completed_at);
      const callbackRate =
        completed.length > 0 ? completed.filter((a) => a.callback).length / completed.length : 0;

      const docsCompliance = docsComplianceScore(vendor, now);

      const score = vendor.demoted
        ? 0
        : 0.3 * acceptSpeedScore(avgAcceptHours) +
          0.25 * completionSpeedScore(avgCompletionDays) +
          0.25 * (1 - callbackRate) +
          0.2 * docsCompliance;

      return {
        vendorId: vendor.id,
        name: vendor.name,
        assignments90d: recent.length,
        avgAcceptHours,
        avgCompletionDays,
        callbackRate,
        docsCompliance,
        demoted: vendor.demoted,
        score: Math.round(score * 1000) / 1000,
      };
    })
    .sort((a, b) => b.score - a.score);
}
