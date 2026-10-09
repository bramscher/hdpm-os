/**
 * Extend KPI history back 24 months, append-only.
 *
 * scripts/backfill-kpi-history.ts rebuilt 52 weeks of real history in May
 * 2026, but it also deletes rows (every pre-2026-05-21 row, and the daily
 * cron rows of the KPIs it rebuilds), so it must not be re-run. This script
 * only ADDS weekly rows dated before each KPI's earliest saved snapshot,
 * reusing that script's calculations, and never deletes or updates anything.
 *
 * KPIs (their source events carry dates in AppFolio):
 *   work_orders    — CreatedAt/CompletedOn cycle times + open count as-of
 *   days_to_lease  — tenant MoveOutOn -> next tenant lease-sign per unit
 *   lease_renewal  — leases RenewedOn vs tenant MoveOutOn in window
 *   net_doors      — property_directory management start/end dates
 *
 * Not here: guest_cards and leasing_funnel (AppFolio leads are only complete
 * from ~2025-07, which their history already reaches), and point-in-time
 * KPIs AppFolio doesn't expose historically.
 *
 * Rows are stamped value.backfill = '24m' so they can be found later.
 *
 * Usage:
 *   npx tsx scripts/backfill-kpi-history-24m.ts            # dry run: prints what it would insert
 *   npx tsx scripts/backfill-kpi-history-24m.ts --write    # inserts
 *   ... --only=work_orders,net_doors                      # limit to some KPIs
 *
 * The dry run includes a seam check: it recomputes each KPI's earliest saved
 * row from today's AppFolio data. Only write a KPI whose seam matches.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { runReport } from '../lib/appfolio-reports';

const WRITE = process.argv.includes('--write');
const MONTHS_BACK = 24;
const ALL_KPIS = ['work_orders', 'days_to_lease', 'lease_renewal', 'net_doors'] as const;
type Kpi = (typeof ALL_KPIS)[number];
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',');
const KPIS: readonly Kpi[] = onlyArg ? ALL_KPIS.filter((k) => onlyArg.includes(k)) : ALL_KPIS;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const AUTH = Buffer.from(`${process.env.APPFOLIO_CLIENT_ID}:${process.env.APPFOLIO_CLIENT_SECRET}`).toString('base64');
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  'X-AppFolio-Developer-ID': process.env.APPFOLIO_DEVELOPER_ID!,
  Accept: 'application/json',
};

async function v0Pages<T>(pathAndQuery: string, maxPages = 200): Promise<T[]> {
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
interface DirRow {
  property_id: number | string | null;
  units: number | string | null;
  visibility: string;
  management_start_date: string | null;
  management_end_date: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : 0);
const DAY = 86400000;

async function earliestSnapshot(kpi: Kpi): Promise<Date | null> {
  const { data, error } = await supabase
    .from('kpi_snapshots')
    .select('captured_at')
    .eq('kpi_name', kpi)
    .order('captured_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`${kpi}: ${error.message}`);
  return data?.[0] ? new Date(data[0].captured_at as string) : null;
}

async function main() {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - MONTHS_BACK);

  // Weekly anchors per KPI: step back 7 days at a time from its earliest row,
  // keeping the same weekday and 14:00 UTC capture time, down to the cutoff.
  const anchors = new Map<Kpi, Date[]>();
  for (const kpi of KPIS) {
    const first = await earliestSnapshot(kpi);
    if (!first) {
      console.log(`${kpi}: no saved history — skipping (nothing to extend)`);
      continue;
    }
    const start = new Date(first);
    start.setUTCHours(14, 0, 0, 0);
    const list: Date[] = [];
    for (let w = new Date(start.getTime() - 7 * DAY); w >= cutoff; w = new Date(w.getTime() - 7 * DAY)) list.push(w);
    list.reverse();
    anchors.set(kpi, list);
    console.log(`${kpi}: earliest saved ${first.toISOString().slice(0, 10)} → ${list.length} weeks to add from ${list[0]?.toISOString().slice(0, 10) ?? '—'}`);
  }
  if (![...anchors.values()].some((l) => l.length)) {
    console.log('Nothing to add.');
    return;
  }

  // Source data, reaching far enough back for the 90-day windows before the cutoff.
  const since = new Date(cutoff.getTime() - 400 * DAY).toISOString();
  console.log(`\nFetching AppFolio data (updated since ${since.slice(0, 10)})...`);
  const tenants = (
    await v0Pages<Tenant>(`/tenants?filters[LastUpdatedAtFrom]=${encodeURIComponent('2000-01-01T00:00:00Z')}&page[size]=1000`)
  ).filter((t) => !t.HiddenAt);
  console.log(`  tenants: ${tenants.length}`);
  const workOrders = await v0Pages<WorkOrder>(`/work_orders?filters[LastUpdatedAtFrom]=${encodeURIComponent(since)}&page[size]=200`);
  console.log(`  work orders: ${workOrders.length}`);
  const leases = await v0Pages<Lease>(`/leases?filters[LastUpdatedAtFrom]=${encodeURIComponent(since)}&page[size]=200`);
  console.log(`  leases: ${leases.length}`);
  const directory = await runReport<DirRow>('property_directory', {
    property_visibility: 'all',
    columns: ['property_id', 'units', 'visibility', 'management_start_date', 'management_end_date'],
  });
  console.log(`  property_directory: ${directory.length}`);

  const oldestWo = workOrders.map((w) => w.CreatedAt).filter(Boolean).sort()[0];
  console.log(`  oldest work order returned: ${oldestWo?.slice(0, 10) ?? '—'}`);

  const moveOutsByUnit = new Map<string, string[]>();
  for (const t of tenants) {
    if (!t.UnitId || !t.MoveOutOn) continue;
    const arr = moveOutsByUnit.get(t.UnitId) ?? [];
    arr.push(t.MoveOutOn);
    moveOutsByUnit.set(t.UnitId, arr);
  }
  for (const arr of moveOutsByUnit.values()) arr.sort();

  const inWindow = (iso: string | null | undefined, from: Date, to: Date) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d >= from && d < to;
  };

  // Same calculations as scripts/backfill-kpi-history.ts, anchored at W.
  const compute: Record<Kpi, (W: Date) => Record<string, unknown>> = {
    work_orders: (W) => {
      const day = (n: number) => new Date(W.getTime() - n * DAY);
      const closed = workOrders.filter((wo) => inWindow(wo.CompletedOn, day(30), W));
      const avgDaysToClose = closed.length
        ? round1(
            closed.reduce((sum, wo) => {
              const created = wo.CreatedAt ? new Date(wo.CreatedAt) : W;
              return sum + Math.max(0, (new Date(wo.CompletedOn!).getTime() - created.getTime()) / DAY);
            }, 0) / closed.length
          )
        : 0;
      const openCount = workOrders.filter((wo) => {
        if (!wo.CreatedAt || new Date(wo.CreatedAt) >= W) return false;
        if (wo.CompletedOn) return new Date(wo.CompletedOn) >= W;
        return !/cancel|closed|complete/.test((wo.Status || '').toLowerCase());
      }).length;
      return { avgDaysToClose, openCount };
    },
    days_to_lease: (W) => {
      const from = new Date(W.getTime() - 90 * DAY);
      const deltas: number[] = [];
      for (const t of tenants) {
        if (!t.UnitId) continue;
        const signed = t.LeaseSignedDate || t.MoveInOn;
        if (!signed || !inWindow(signed, from, W)) continue;
        const prior = (moveOutsByUnit.get(t.UnitId) || []).filter((m) => m < signed).pop();
        if (!prior) continue;
        const days = Math.round((new Date(signed).getTime() - new Date(prior).getTime()) / DAY);
        if (days >= 0 && days <= 365) deltas.push(days);
      }
      return deltas.length
        ? {
            avgDays: round1(deltas.reduce((a, b) => a + b, 0) / deltas.length),
            fastest: Math.min(...deltas),
            slowest: Math.max(...deltas),
            unitsLeased: deltas.length,
          }
        : { avgDays: 0, fastest: 0, slowest: 0, unitsLeased: 0 };
    },
    lease_renewal: (W) => {
      const from = new Date(W.getTime() - 90 * DAY);
      const renewals = leases.filter((l) => inWindow(l.RenewedOn, from, W)).length;
      const moveOuts = tenants.filter((t) => inWindow(t.MoveOutOn, from, W)).length;
      return { rate: pct(renewals, renewals + moveOuts), renewals, moveOuts };
    },
    net_doors: (W) => {
      const from = new Date(W.getTime() - 30 * DAY);
      const activeAt = (r: DirRow) => {
        const start = r.management_start_date ? new Date(r.management_start_date) : null;
        const end = r.management_end_date ? new Date(r.management_end_date) : null;
        if (r.visibility !== 'Active' && !end) return false; // hidden, end unknown
        if (start && start >= W) return false;
        if (end && end < W) return false;
        return true;
      };
      const unitsOf = (r: DirRow) => Number(r.units) || 1;
      const active = directory.filter(activeAt);
      const started = directory.filter((r) => inWindow(r.management_start_date, from, W));
      const ended = directory.filter((r) => inWindow(r.management_end_date, from, W));
      return {
        currentDoors: active.reduce((s, r) => s + unitsOf(r), 0),
        currentProperties: active.length,
        netThisMonth: started.reduce((s, r) => s + unitsOf(r), 0) - ended.reduce((s, r) => s + unitsOf(r), 0),
      };
    },
  };

  // Seam check: recompute each KPI's earliest saved snapshot from today's
  // AppFolio data. A big gap means the source data has drifted (e.g. rows
  // hidden since), and the new history would step at the join.
  console.log('\nSeam check (earliest saved row vs the same date recomputed now):');
  for (const kpi of anchors.keys()) {
    const { data } = await supabase
      .from('kpi_snapshots')
      .select('captured_at, value')
      .eq('kpi_name', kpi)
      .order('captured_at', { ascending: true })
      .limit(1);
    const saved = data?.[0];
    if (!saved) continue;
    const at = new Date(saved.captured_at as string);
    console.log(`  ${kpi.padEnd(14)} ${at.toISOString().slice(0, 10)}  saved ${JSON.stringify(saved.value)}`);
    console.log(`  ${''.padEnd(14)} ${''.padEnd(10)}  now   ${JSON.stringify(compute[kpi](at))}`);
  }

  // Door drift across the saved weekly history: properties that have since
  // left AppFolio's directory entirely (e.g. a portfolio sold off) vanish
  // from every recomputed date, so recomputed doors run low before they left.
  if (anchors.has('net_doors')) {
    const { data } = await supabase
      .from('kpi_snapshots')
      .select('captured_at, value')
      .eq('kpi_name', 'net_doors')
      .lt('captured_at', '2026-05-21T00:00:00Z')
      .order('captured_at', { ascending: true });
    console.log('\nnet_doors drift (saved − recomputed now), monthly:');
    const seen = new Set<string>();
    for (const r of data || []) {
      const at = new Date(r.captured_at as string);
      const ym = at.toISOString().slice(0, 7);
      if (seen.has(ym)) continue;
      seen.add(ym);
      const saved = (r.value as { currentDoors: number }).currentDoors;
      const now = compute.net_doors(at).currentDoors as number;
      console.log(`  ${at.toISOString().slice(0, 10)}  saved ${saved}  now ${now}  drift ${saved - now}`);
    }
  }

  // net_doors: carry the drift at the earliest saved row back as a constant,
  // so properties since removed from AppFolio (the ~64-door portfolio sold in
  // Dec 2025) still count before they left. The drift was a constant 67 doors
  // across Aug–Nov 2025, which is what makes a constant offset sound.
  let doorsOffset = { doors: 0, properties: 0 };
  if (anchors.has('net_doors')) {
    const { data } = await supabase
      .from('kpi_snapshots')
      .select('captured_at, value')
      .eq('kpi_name', 'net_doors')
      .order('captured_at', { ascending: true })
      .limit(1);
    const saved = data?.[0];
    if (saved) {
      const v = saved.value as { currentDoors: number; currentProperties: number };
      const now = compute.net_doors(new Date(saved.captured_at as string));
      doorsOffset = {
        doors: v.currentDoors - (now.currentDoors as number),
        properties: v.currentProperties - (now.currentProperties as number),
      };
      console.log(`
net_doors offset applied to added rows: +${doorsOffset.doors} doors, +${doorsOffset.properties} properties`);
    }
  }

  const rows: Array<{ kpi_name: Kpi; captured_at: string; value: Record<string, unknown> }> = [];
  for (const [kpi, list] of anchors) {
    for (const W of list) {
      const value: Record<string, unknown> = { ...compute[kpi](W), backfill: '24m' };
      if (kpi === 'net_doors' && (doorsOffset.doors || doorsOffset.properties)) {
        value.currentDoors = (value.currentDoors as number) + doorsOffset.doors;
        value.currentProperties = (value.currentProperties as number) + doorsOffset.properties;
        value.offset = doorsOffset;
      }
      rows.push({ kpi_name: kpi, captured_at: W.toISOString(), value });
    }
  }

  // Monthly sample per KPI so the numbers can be eyeballed before writing.
  console.log(`\nComputed ${rows.length} rows. One sample per month:`);
  for (const kpi of KPIS) {
    const seen = new Set<string>();
    for (const r of rows.filter((x) => x.kpi_name === kpi)) {
      const ym = r.captured_at.slice(0, 7);
      if (seen.has(ym)) continue;
      seen.add(ym);
      const { backfill: _b, ...v } = r.value;
      console.log(`  ${kpi.padEnd(14)} ${r.captured_at.slice(0, 10)}  ${JSON.stringify(v)}`);
    }
  }

  if (!WRITE) {
    console.log('\nDry run — nothing written. Re-run with --write to insert.');
    return;
  }

  // Re-check right before writing: only insert rows still older than each KPI's earliest snapshot.
  const safe: typeof rows = [];
  for (const kpi of KPIS) {
    const first = await earliestSnapshot(kpi);
    safe.push(...rows.filter((r) => r.kpi_name === kpi && (!first || new Date(r.captured_at) < new Date(first.getTime() - 3 * DAY))));
  }
  console.log(`\nInserting ${safe.length} rows...`);
  for (let i = 0; i < safe.length; i += 100) {
    const { error } = await supabase.from('kpi_snapshots').insert(safe.slice(i, i + 100));
    if (error) throw new Error(`insert failed at batch ${i / 100}: ${error.message}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
