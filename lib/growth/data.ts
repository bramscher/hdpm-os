/**
 * Server-side reads for the /growth dashboard. Read-only: KPI snapshots,
 * referral leads/partners (Supabase, service role) and the website's owner
 * board feed. The math lives in metrics.ts.
 */
import { getSupabaseAdmin } from '@/lib/supabase';
import { webAdminFetch } from '@/lib/hdpm-web-admin';
import { computeDoorMovement, type DoorRoster } from '@/lib/door-movement';
import { GROWTH_SETTINGS } from './config';
import { BOARD_FEED_PATH, type BoardResponse } from './lead-api';
import {
  addMonths,
  firstOnOrAfter,
  funnel,
  latestPerDay,
  leadsBySourceByMonth,
  monthlyMovement,
  monthlyPace,
  netDoorsSeries,
  openWeightedDoors,
  ownerChurnSeries,
  partnerLeaderboard,
  pipelineByStage,
  thinDaily,
} from './metrics';

type Row<T> = { captured_at: string; value: T };

/** All snapshot rows for one KPI since a day, paged (Supabase caps a page at 1000). */
async function readSnapshots<T>(kpi: string, sinceDay: string, columns = 'captured_at, value'): Promise<Row<T>[]> {
  const db = getSupabaseAdmin();
  const out: Row<T>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('kpi_snapshots')
      .select(columns)
      .eq('kpi_name', kpi)
      .gte('captured_at', `${sinceDay}T00:00:00Z`)
      .order('captured_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`kpi_snapshots ${kpi}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row<T>[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Door rosters are large, so read the dates first and then only the first
 * roster of each month plus the latest one.
 */
async function readMonthlyRosters(sinceDay: string): Promise<Record<string, DoorRoster>> {
  const db = getSupabaseAdmin();
  const stamps = await readSnapshots<never>('door_roster', sinceDay, 'captured_at, id');
  const rows = stamps as unknown as { captured_at: string; id: string }[];
  if (!rows.length) return {};
  const pick = new Map<string, string>();
  for (const r of rows) if (!pick.has(r.captured_at.slice(0, 7))) pick.set(r.captured_at.slice(0, 7), r.id);
  const ids = new Set([...pick.values(), rows[rows.length - 1].id]);
  const { data, error } = await db.from('kpi_snapshots').select('captured_at, value').in('id', [...ids]);
  if (error) throw new Error(`kpi_snapshots door_roster: ${error.message}`);
  const out: Record<string, DoorRoster> = {};
  for (const r of (data ?? []) as Row<{ roster?: DoorRoster }>[]) {
    if (r.value?.roster) out[r.captured_at.slice(0, 10)] = r.value.roster;
  }
  return out;
}

async function readLeaderboard() {
  const db = getSupabaseAdmin();
  const [leads, partners] = await Promise.all([
    db.from('referral_lead').select('partner_id, stage, doors_under_mgmt, unit_count').eq('org_id', 'hdpm').not('partner_id', 'is', null),
    db.from('referral_partner').select('id, display_name, company').eq('org_id', 'hdpm'),
  ]);
  if (leads.error) throw new Error(`referral_lead: ${leads.error.message}`);
  if (partners.error) throw new Error(`referral_partner: ${partners.error.message}`);
  return partnerLeaderboard(leads.data ?? [], partners.data ?? []).slice(0, 10);
}

/** Settle each part separately so one failing source doesn't blank the whole page. */
async function part<T>(label: string, fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    console.error(`[growth] ${label}:`, e);
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadGrowthSummary(actorEmail: string, now: Date = new Date()) {
  const { startDate, targetNetDoors, months, churnTargetPct } = GROWTH_SETTINGS;
  const historyFrom = addMonths(startDate, -12);

  const [doors, movement, churn, leaderboard, board] = await Promise.all([
    part('net doors', async () => {
      const rows = await readSnapshots<{ currentDoors?: number }>('net_doors', startDate);
      const baselineRow = firstOnOrAfter(rows, startDate);
      const baselineDoors = baselineRow?.value?.currentDoors ?? null;
      const byDay: Record<string, number> = {};
      for (const [day, v] of Object.entries(latestPerDay(rows))) if (typeof v?.currentDoors === 'number') byDay[day] = v.currentDoors;
      const days = Object.keys(byDay).sort();
      const currentDoors = days.length ? byDay[days[days.length - 1]] : null;
      return {
        baselineDoors,
        baselineAt: baselineRow?.captured_at.slice(0, 10) ?? null,
        currentDoors,
        netSinceStart: baselineDoors != null && currentDoors != null ? currentDoors - baselineDoors : null,
        series: thinDaily(netDoorsSeries(byDay, baselineDoors, startDate, months, targetNetDoors)),
      };
    }),
    part('door movement', async () => monthlyMovement(await readMonthlyRosters(historyFrom), computeDoorMovement)),
    part('owner churn', async () => {
      const rows = await readSnapshots<{ cancellationsLast30Days?: number; totalOwners?: number }>('owner_retention', historyFrom);
      return thinDaily(ownerChurnSeries(latestPerDay(rows), churnTargetPct));
    }),
    part('partner leaderboard', readLeaderboard),
    part('owner leads', async () => {
      const res = await webAdminFetch(BOARD_FEED_PATH, actorEmail);
      const data = await res.json().catch(() => ({ error: 'Unexpected response from the website' }));
      if (!res.ok) throw new Error(data.error || `Website returned ${res.status}`);
      return data as BoardResponse;
    }),
  ]);

  const leads = board.data?.leads ?? [];
  const stages = pipelineByStage(leads);
  return {
    settings: { ...GROWTH_SETTINGS, monthlyPace: monthlyPace(targetNetDoors, months), endDate: addMonths(startDate, months) },
    asOf: now.toISOString(),
    doors: doors.data,
    movement: movement.data,
    churn: churn.data,
    leaderboard: leaderboard.data,
    pipeline: board.data
      ? {
          stages,
          openWeightedDoors: openWeightedDoors(stages),
          funnel: funnel(leads, now),
          bySource: leadsBySourceByMonth(leads),
          truncated: board.data.truncated,
          totalLeads: leads.length,
        }
      : null,
    errors: {
      doors: doors.error,
      movement: movement.error,
      churn: churn.error,
      leaderboard: leaderboard.error,
      pipeline: board.error,
    },
  };
}

export type GrowthSummary = Awaited<ReturnType<typeof loadGrowthSummary>>;
