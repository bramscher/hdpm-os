/**
 * Rebuild kpi_snapshots history from REAL AppFolio data.
 *
 * The original backfill-kpi-snapshots.ts fabricated history (current values +
 * random variance). This script replaces it: for the six KPIs whose underlying
 * events carry dates in AppFolio, it recomputes true weekly values for the
 * past 52 weeks:
 *
 *   guest_cards     — leads by CreatedAt (complete for created >= 2025-07)
 *   leasing_funnel  — 90-day lead cohorts with eventual outcomes (cohort
 *                     semantics: a lead counts as converted at every snapshot
 *                     once its eventual outcome is conversion; AppFolio does
 *                     not expose when the conversion happened)
 *   days_to_lease   — tenant MoveOutOn -> next tenant lease-sign per unit
 *   work_orders     — CreatedAt/CompletedOn cycle times + open count as-of
 *   lease_renewal   — leases RenewedOn vs tenant MoveOutOn in window
 *   net_doors       — property_directory management start/end dates
 *
 * Then it deletes the fabricated rows (all pre-2026-05-21 rows, stamped
 * exactly 14:00:00) and the broken truncated-pagination rows (2026-05-21+)
 * for these six KPIs, and inserts the recomputed weekly rows.
 *
 * Not reconstructible (point-in-time state AppFolio doesn't expose
 * historically): delinquency, vacancy, insurance, owner_retention,
 * maintenance_cost, notices. Their fabricated pre-05-21 rows are deleted too;
 * their real history accumulates from the daily cron.
 *
 * Usage: npx tsx scripts/backfill-kpi-history.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { SOURCE_BUCKETS } from '../lib/appfolio-kpi';
import { runReport } from '../lib/appfolio-reports';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AUTH = Buffer.from(
  `${process.env.APPFOLIO_CLIENT_ID}:${process.env.APPFOLIO_CLIENT_SECRET}`
).toString('base64');
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  'X-AppFolio-Developer-ID': process.env.APPFOLIO_DEVELOPER_ID!,
  Accept: 'application/json',
};

async function v0Pages<T>(pathAndQuery: string, maxPages = 120): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = `https://api.appfolio.com/api/v0${pathAndQuery}`;
  for (let p = 0; p < maxPages && url; p++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      p--;
      continue;
    }
    if (!res.ok) throw new Error(`${pathAndQuery.split('?')[0]} HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T[]; next_page_path?: string | null };
    rows.push(...(json.data || []));
    url = json.next_page_path ? `https://api.appfolio.com${json.next_page_path}` : null;
    await new Promise((r) => setTimeout(r, 350));
  }
  return rows;
}

interface Lead {
  Id: string;
  CreatedAt: string;
  LastUpdatedAt: string;
  Source: string | null;
  Status: string;
  InactiveReason: string | null;
  RentalApplicationId: string | null;
  RentalApplicationGroupId: string | null;
}
interface Tenant {
  Id: string;
  UnitId?: string;
  MoveInOn?: string;
  MoveOutOn?: string;
  LeaseSignedDate?: string;
  HiddenAt?: string | null;
}
interface WorkOrder {
  Id: string;
  CreatedAt?: string;
  CompletedOn?: string | null;
  Status?: string;
}
interface Lease {
  Id: string;
  RenewedOn?: string | null;
}
interface RentalApp {
  Id: string;
  Status: string;
  StatusChangedAt: string | null;
}
interface DirRow {
  property_id: number | string | null;
  units: number | string | null;
  visibility: string;
  management_start_date: string | null;
  management_end_date: string | null;
}

const LEGACY_APPLIED = new Set([
  'applied_review',
  'applied_canceled',
  'applied_denied',
  'converted',
]);

const isConverted = (l: Lead) =>
  l.Status === 'converted' || l.InactiveReason === 'converted_to_tenant';
const isApplication = (l: Lead) =>
  !!l.RentalApplicationGroupId ||
  !!l.RentalApplicationId ||
  LEGACY_APPLIED.has(l.Status) ||
  isConverted(l);

function normalizeSource(raw: string | null): string {
  if (!raw) return 'Other';
  return SOURCE_BUCKETS[raw] ?? 'Other';
}

function sourceBreakdown(leads: Lead[]): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const s = normalizeSource(l.Source);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : 0);

async function main() {
  const since = '2025-04-01T00:00:00Z';
  console.log('Fetching source datasets (one pass each)...');

  const leads = await v0Pages<Lead>(
    `/leads?filters[LastUpdatedAtFrom]=${encodeURIComponent(since)}&page[size]=100`
  );
  console.log(`  leads: ${leads.length}`);

  const tenants = (
    await v0Pages<Tenant>(
      `/tenants?filters[LastUpdatedAtFrom]=${encodeURIComponent('2000-01-01T00:00:00Z')}&page[size]=1000`
    )
  ).filter((t) => !t.HiddenAt);
  console.log(`  tenants: ${tenants.length}`);

  const workOrders = await v0Pages<WorkOrder>(
    `/work_orders?filters[LastUpdatedAtFrom]=${encodeURIComponent(since)}&page[size]=200`
  );
  console.log(`  work orders: ${workOrders.length}`);

  const leases = await v0Pages<Lease>(
    `/leases?filters[LastUpdatedAtFrom]=${encodeURIComponent(since)}&page[size]=200`
  );
  console.log(`  leases: ${leases.length}`);

  const directory = await runReport<DirRow>('property_directory', {
    property_visibility: 'all',
    columns: ['property_id', 'units', 'visibility', 'management_start_date', 'management_end_date'],
  });
  console.log(`  property_directory: ${directory.length}`);

  // Rental applications per distinct group referenced by any lead.
  const groupIds = [
    ...new Set(leads.map((l) => l.RentalApplicationGroupId).filter((g): g is string => !!g)),
  ];
  const groupApps = new Map<string, RentalApp[]>();
  console.log(`  fetching ${groupIds.length} application groups...`);
  for (const gid of groupIds) {
    try {
      const apps = await v0Pages<RentalApp>(
        `/rental_applications?filters[GroupId]=${gid}&page[size]=100`,
        2
      );
      groupApps.set(gid, apps);
    } catch (err) {
      console.warn(`    group ${gid} failed: ${err}`);
    }
  }
  const isGroupApproved = (gid: string | null) =>
    !!gid &&
    (groupApps.get(gid) || []).some((a) => (a.Status || '').toLowerCase().includes('approved'));
  const isApproval = (l: Lead) => isConverted(l) || isGroupApproved(l.RentalApplicationGroupId);

  // Pre-index tenant move-outs per unit for days_to_lease (sorted ascending).
  const moveOutsByUnit = new Map<string, string[]>();
  for (const t of tenants) {
    if (!t.UnitId || !t.MoveOutOn) continue;
    const arr = moveOutsByUnit.get(t.UnitId) ?? [];
    arr.push(t.MoveOutOn);
    moveOutsByUnit.set(t.UnitId, arr);
  }
  for (const arr of moveOutsByUnit.values()) arr.sort();

  // ── Weekly snapshots ─────────────────────────────────────────────
  console.log('\nComputing 52 weekly snapshots...');
  const WEEKS = 52;
  const now = new Date();
  const rows: Array<{ kpi_name: string; value: unknown; captured_at: string }> = [];

  for (let i = 0; i < WEEKS; i++) {
    const W = new Date(now);
    W.setUTCDate(W.getUTCDate() - (WEEKS - 1 - i) * 7);
    W.setUTCHours(14, 0, 0, 0);
    const wMs = W.getTime();
    const day = (n: number) => new Date(wMs - n * 86400000);
    const inWindow = (iso: string | null | undefined, from: Date, to: Date) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d >= from && d < to;
    };

    // guest_cards — leads by CreatedAt. Complete for CreatedAt >= 2025-07.
    const gcLeads = (from: Date, to: Date) => leads.filter((l) => inWindow(l.CreatedAt, from, to));
    const thisWeekLeads = gcLeads(day(7), W);
    const thisMonthLeads = gcLeads(day(30), W);
    rows.push({
      kpi_name: 'guest_cards',
      captured_at: W.toISOString(),
      value: {
        today: gcLeads(day(1), W).length,
        thisWeek: thisWeekLeads.length,
        thisMonth: thisMonthLeads.length,
        lastWeek: gcLeads(day(14), day(7)).length,
        lastMonth: gcLeads(day(60), day(30)).length,
        weekOverWeekDelta: thisWeekLeads.length - gcLeads(day(14), day(7)).length,
        monthOverMonthDelta: thisMonthLeads.length - gcLeads(day(60), day(30)).length,
        sourceBreakdownWeek: sourceBreakdown(thisWeekLeads),
        sourceBreakdownMonth: sourceBreakdown(thisMonthLeads),
      },
    });

    // leasing_funnel — 90-day cohort, eventual outcomes.
    const cohort = gcLeads(day(90), W);
    const guestCards = cohort.length;
    const applications = cohort.filter(isApplication).length;
    const approvals = cohort.filter(isApproval).length;
    const moveIns = cohort.filter(isConverted).length;
    let totalDays = 0;
    let nDays = 0;
    for (const l of cohort) {
      if (!isConverted(l)) continue;
      const apps = l.RentalApplicationGroupId ? groupApps.get(l.RentalApplicationGroupId) || [] : [];
      const endIso = apps.find((a) => a.StatusChangedAt)?.StatusChangedAt ?? l.LastUpdatedAt;
      const days = (new Date(endIso).getTime() - new Date(l.CreatedAt).getTime()) / 86400000;
      if (days >= 0 && days <= 180) {
        totalDays += days;
        nDays++;
      }
    }
    const tenantMoveIns = tenants.filter((t) => inWindow(t.MoveInOn, day(90), W)).length;
    rows.push({
      kpi_name: 'leasing_funnel',
      captured_at: W.toISOString(),
      value: {
        period: 'last_90_days',
        funnel: { guestCards, applications, approvals, moveIns },
        conversionRates: {
          guestCardToApplication: pct(applications, guestCards),
          applicationToApproval: pct(approvals, applications),
          approvalToMoveIn: pct(moveIns, approvals),
          overallConversion: pct(moveIns, guestCards),
        },
        avgDaysLeadToLease: nDays > 0 ? round1(totalDays / nDays) : 0,
        timeToFirstContact: {
          avgHoursToFirstContact: null,
          pctContactedUnder1Hour: null,
          pctContactedUnder24Hours: null,
          pctNeverContacted: null,
          dataSource: 'unavailable',
        },
        dataQuality: { tenantMoveIns, leadLinkageSparse: tenantMoveIns > moveIns * 2 },
      },
    });

    // days_to_lease — same logic as KPI 8, anchored at W.
    const deltas: number[] = [];
    for (const t of tenants) {
      if (!t.UnitId) continue;
      const signed = t.LeaseSignedDate || t.MoveInOn;
      if (!signed || !inWindow(signed, day(90), W)) continue;
      const prior = (moveOutsByUnit.get(t.UnitId) || [])
        .filter((m) => m < signed)
        .pop();
      if (!prior) continue;
      const days = Math.round(
        (new Date(signed).getTime() - new Date(prior).getTime()) / 86400000
      );
      if (days >= 0 && days <= 365) deltas.push(days);
    }
    rows.push({
      kpi_name: 'days_to_lease',
      captured_at: W.toISOString(),
      value: deltas.length
        ? {
            avgDays: round1(deltas.reduce((a, b) => a + b, 0) / deltas.length),
            fastest: Math.min(...deltas),
            slowest: Math.max(...deltas),
            unitsLeased: deltas.length,
          }
        : { avgDays: 0, fastest: 0, slowest: 0, unitsLeased: 0 },
    });

    // work_orders — cycle time for WOs completed in [W-30, W); open as-of W.
    // (Canceled WOs without CompletedOn are treated as never-open; AppFolio
    // doesn't expose when they were canceled.)
    const closed = workOrders.filter((wo) => inWindow(wo.CompletedOn, day(30), W));
    const avgClose = closed.length
      ? round1(
          closed.reduce((sum, wo) => {
            const created = wo.CreatedAt ? new Date(wo.CreatedAt) : W;
            return (
              sum +
              Math.max(0, (new Date(wo.CompletedOn!).getTime() - created.getTime()) / 86400000)
            );
          }, 0) / closed.length
        )
      : 0;
    const openCount = workOrders.filter((wo) => {
      if (!wo.CreatedAt || new Date(wo.CreatedAt) >= W) return false;
      if (wo.CompletedOn) return new Date(wo.CompletedOn) >= W;
      const status = (wo.Status || '').toLowerCase();
      return !/cancel|closed|complete/.test(status);
    }).length;
    rows.push({
      kpi_name: 'work_orders',
      captured_at: W.toISOString(),
      value: { avgDaysToClose: avgClose, openCount },
    });

    // lease_renewal — RenewedOn vs actual MoveOutOn in trailing 90 days.
    const renewals = leases.filter((l) => inWindow(l.RenewedOn, day(90), W)).length;
    const moveOuts = tenants.filter((t) => inWindow(t.MoveOutOn, day(90), W)).length;
    rows.push({
      kpi_name: 'lease_renewal',
      captured_at: W.toISOString(),
      value: { rate: pct(renewals, renewals + moveOuts), renewals, moveOuts },
    });

    // net_doors — from management agreement start/end dates.
    const activeAt = (r: DirRow, at: Date) => {
      const start = r.management_start_date ? new Date(r.management_start_date) : null;
      const end = r.management_end_date ? new Date(r.management_end_date) : null;
      // Hidden with no end date: lost at an unknown time — never count it,
      // otherwise it inflates every week (57 of 603 hidden lack end dates).
      if (r.visibility !== 'Active' && !end) return false;
      if (start && start >= at) return false;
      if (end && end < at) return false;
      return true;
    };
    const unitsOf = (r: DirRow) => Number(r.units) || 1;
    const activeProps = directory.filter((r) => activeAt(r, W));
    const startedThisMonth = directory.filter((r) =>
      inWindow(r.management_start_date, day(30), W)
    );
    const endedThisMonth = directory.filter((r) => inWindow(r.management_end_date, day(30), W));
    rows.push({
      kpi_name: 'net_doors',
      captured_at: W.toISOString(),
      value: {
        currentDoors: activeProps.reduce((s, r) => s + unitsOf(r), 0),
        currentProperties: activeProps.length,
        netThisMonth:
          startedThisMonth.reduce((s, r) => s + unitsOf(r), 0) -
          endedThisMonth.reduce((s, r) => s + unitsOf(r), 0),
      },
    });
  }

  console.log(`Computed ${rows.length} snapshot rows.`);

  // ── Purge fabricated + broken rows, insert real ones ─────────────
  const RECONSTRUCTED = [
    'guest_cards',
    'leasing_funnel',
    'days_to_lease',
    'work_orders',
    'lease_renewal',
    'net_doors',
  ];

  console.log('\nDeleting fabricated pre-2026-05-21 rows (all KPIs)...');
  const del1 = await supabase
    .from('kpi_snapshots')
    .delete({ count: 'exact' })
    .lt('captured_at', '2026-05-21T00:00:00Z');
  console.log(`  deleted: ${del1.count}${del1.error ? ` ERROR ${del1.error.message}` : ''}`);

  console.log('Deleting broken 2026-05-21+ rows for reconstructed KPIs...');
  const del2 = await supabase
    .from('kpi_snapshots')
    .delete({ count: 'exact' })
    .gte('captured_at', '2026-05-21T00:00:00Z')
    .in('kpi_name', RECONSTRUCTED);
  console.log(`  deleted: ${del2.count}${del2.error ? ` ERROR ${del2.error.message}` : ''}`);

  console.log('Inserting recomputed weekly rows...');
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase.from('kpi_snapshots').insert(batch);
    if (error) {
      console.error(`  batch failed: ${error.message}`);
      return;
    }
    inserted += batch.length;
  }
  console.log(`  inserted: ${inserted}`);

  // Sanity: print the latest week per KPI.
  console.log('\nLatest week values:');
  for (const name of RECONSTRUCTED) {
    const latest = rows.filter((r) => r.kpi_name === name).pop();
    console.log(`  ${name}: ${JSON.stringify(latest?.value).slice(0, 160)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
