/**
 * EOS provisional seed (Phase 2, Brief 2A). Idempotent: upserts by
 * (org_id, name); safe to re-run after edits. Run AFTER 20260804_eos_core.sql:
 *
 *   npx tsx --env-file=.env.local scripts/eos/seed-eos.ts
 *
 * EVERYTHING HERE IS PROVISIONAL — Craig edits this file (seat occupancy,
 * reports-to, metric goals) and re-runs, or edits rows directly. Occupants
 * below come only from facts already recorded in docs/agent-os/01 and repo
 * memory (no guesses about the org beyond those).
 */
import { getSupabaseAdmin } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';

// name → { roles, person (staff.person), reportsTo (seat name) }
// Occupancy per Craig, 2026-08-04. Reports-to lines are still provisional.
const SEATS: Record<
  string,
  { roles: string[]; person?: string; reportsTo?: string; sort: number }
> = {
  Visionary: {
    roles: ['Vision & culture', 'Big relationships', 'Sep-4 platform decisions'],
    person: 'Craig',
    sort: 0,
  },
  Integrator: {
    roles: ['Runs the weekly cadence', 'Removes obstacles', 'Owns the scorecard'],
    person: 'Craig', // dual-hat with Visionary until someone earns the seat (2026-08-05)
    reportsTo: 'Visionary',
    sort: 1,
  },
  'Finance & Operations': {
    roles: ['Trust accounting (AppFolio)', 'Owner statements', 'AP/AR', 'Office operations'],
    person: 'Penny',
    reportsTo: 'Integrator',
    sort: 2,
  },
  'Sr. Property Manager & Maintenance': {
    roles: ['Senior PM portfolio', 'Maintenance oversight', 'Vendor relationships'],
    person: 'Matt',
    reportsTo: 'Integrator',
    sort: 3,
  },
  'Property Manager': {
    roles: ['PM portfolio', 'Owner & tenant relations', 'Leasing & renewals'],
    person: 'Jen',
    reportsTo: 'Sr. Property Manager & Maintenance',
    sort: 4,
  },
  'Assistant Property Manager': {
    roles: ['Supports the PM lane', 'Applications & screening', 'Move-in/out logistics'],
    person: 'Kennedy',
    reportsTo: 'Sr. Property Manager & Maintenance',
    sort: 5,
  },
  'Maintenance Coordinator': {
    roles: ['WO intake & dispatch', 'Vendor follow-up', 'Estimate queue'],
    person: 'Cheryl',
    reportsTo: 'Sr. Property Manager & Maintenance',
    sort: 6,
  },
  'Inspections & Maintenance': {
    roles: ['Move-in/out & cadence inspections', 'Turn scoping', 'Maintenance support'],
    person: 'Brody',
    reportsTo: 'Sr. Property Manager & Maintenance',
    sort: 7,
  },
  'Maintenance Tech': {
    roles: ['In-house repairs', 'Turn work', 'Field response'],
    person: 'Alberto',
    reportsTo: 'Maintenance Coordinator',
    sort: 8,
  },
  'Front Office Support': {
    roles: ['Main line & walk-ins', 'Tenant first contact', 'Key checkout'],
    person: 'Ashley',
    reportsTo: 'Finance & Operations',
    sort: 9,
  },
  'License & Oversight': {
    roles: ['CCB license holder', 'High-level compliance oversight'],
    person: 'Bryce',
    reportsTo: 'Visionary',
    sort: 10,
  },
};

// Weekly metrics wired to live metrics_snapshot keys ('<metric>.<field>').
// Goals are PROVISIONAL — set real targets with Craig before the first L10.
const METRICS: Array<{
  name: string;
  owner?: string;
  unit: string;
  goal_op: 'gte' | 'lte';
  goal_value: number;
  source: 'metrics_snapshot' | 'manual';
  source_ref?: string;
  sort: number;
}> = [
  { name: 'Open exceptions', owner: 'Cheryl', unit: 'count', goal_op: 'lte', goal_value: 150, source: 'metrics_snapshot', source_ref: 'open_exceptions.total', sort: 0 },
  { name: 'Staff actions via agent surfaces (7d)', owner: 'Craig', unit: 'count', goal_op: 'gte', goal_value: 25, source: 'metrics_snapshot', source_ref: 'staff_actions.last7Days', sort: 1 },
  // Q3 step-down goals set with Craig 2026-08-05 (from 44 actual); tighten quarterly.
  { name: 'Stuck estimates (open)', owner: 'Cheryl', unit: 'count', goal_op: 'lte', goal_value: 35, source: 'metrics_snapshot', source_ref: 'estimate_approval_latency.openCount', sort: 2 },
  { name: 'Estimate decision latency (median)', owner: 'Cheryl', unit: 'days', goal_op: 'lte', goal_value: 7, source: 'metrics_snapshot', source_ref: 'estimate_approval_latency.medianDaysToDecision', sort: 3 },
  { name: 'Vendor accepted-unworked WOs', owner: 'Brody', unit: 'count', goal_op: 'lte', goal_value: 30, source: 'metrics_snapshot', source_ref: 'vendor_stuck_pools.acceptedUnworkedCount', sort: 4 },
  { name: 'Open unit turns', owner: 'Brody', unit: 'count', goal_op: 'lte', goal_value: 45, source: 'metrics_snapshot', source_ref: 'turns.openTurns', sort: 5 },
  { name: 'Median days vacant (turns)', owner: 'Brody', unit: 'days', goal_op: 'lte', goal_value: 25, source: 'metrics_snapshot', source_ref: 'turns.medianDaysVacant', sort: 6 },
  // Target band is 30–36 (Craig 2026-08-05); scorecard tracks the floor.
  { name: 'Billable hours (week)', owner: 'Brody', unit: 'hours', goal_op: 'gte', goal_value: 30, source: 'metrics_snapshot', source_ref: 'billable_hours.weekHours', sort: 7 },
];

async function main() {
  const supabase = getSupabaseAdmin();

  // Seats — two passes so reports_to can reference any seat.
  const seatIds = new Map<string, string>();
  for (const [name, def] of Object.entries(SEATS)) {
    const { data, error } = await supabase
      .from('seat')
      .upsert(
        { org_id: 'hdpm', name, roles: def.roles, person: def.person ?? null, sort: def.sort },
        { onConflict: 'org_id,name' }
      )
      .select('id')
      .single();
    if (error) {
      console.error(`seat ${name} FAILED:`, error.message);
      continue;
    }
    seatIds.set(name, data.id);
    console.log(`seat ${name} → ${def.person ?? 'OPEN'}`);
  }
  for (const [name, def] of Object.entries(SEATS)) {
    if (!def.reportsTo) continue;
    const id = seatIds.get(name);
    const to = seatIds.get(def.reportsTo);
    if (id && to) {
      await supabase.from('seat').update({ reports_to_seat_id: to }).eq('id', id);
    }
  }

  // Retire seats no longer in this file (renames leave old rows behind).
  const { data: stale } = await supabase
    .from('seat')
    .select('id, name')
    .eq('org_id', 'hdpm')
    .eq('active', true);
  for (const row of stale ?? []) {
    if (!(row.name in SEATS)) {
      await supabase.from('seat').update({ active: false }).eq('id', row.id);
      console.log(`seat ${row.name} retired (not in seed)`);
    }
  }

  // Scorecard metrics.
  for (const m of METRICS) {
    const { error } = await supabase.from('scorecard_metric').upsert(
      {
        org_id: 'hdpm',
        name: m.name,
        owner_person: m.owner ?? null,
        cadence: 'weekly',
        unit: m.unit,
        goal_op: m.goal_op,
        goal_value: m.goal_value,
        source: m.source,
        source_ref: m.source_ref ?? null,
        sort: m.sort,
      },
      { onConflict: 'org_id,name' }
    );
    console.log(error ? `metric ${m.name} FAILED: ${error.message}` : `metric ${m.name} ✓`);
  }

  await logAudit('seat', 'seed', 'seeded', 'system:seed-eos', {
    seats: Object.keys(SEATS).length,
    metrics: METRICS.length,
    provisional: true,
  });
  console.log('\nSeed complete (all occupancy/goals PROVISIONAL — edit & re-run).');
}

main();
