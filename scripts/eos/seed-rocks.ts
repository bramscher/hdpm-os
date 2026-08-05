/**
 * Q3-2026 Rocks seed (Phase 2, Brief 2E operator step). Idempotent:
 * skips any rock whose (quarter, title) already exists — safe to re-run
 * after edits. Content set with Craig 2026-08-05.
 *
 *   npx tsx --env-file=.env.local scripts/eos/seed-rocks.ts
 */
import { getSupabaseAdmin } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';

const QUARTER = '2026-Q3';

const ROCKS: Array<{
  title: string;
  owner: string;
  due_on: string;
  notes?: string;
}> = [
  {
    title: 'AppFolio Write API go/no-go decision',
    owner: 'Craig',
    due_on: '2026-09-04',
    notes: 'Decide with wo_event touch counts as evidence (~$850/mo at Tier 1).',
  },
  {
    title: 'Turn backlog down: open turns ≤45, median days vacant ≤25',
    owner: 'Brody',
    due_on: '2026-09-30',
    notes: 'From 61 open / 27.6d vacant at quarter seed (2026-08-05).',
  },
  {
    title: 'Estimate queue burn-down: stuck estimates ≤35, latency <7d held',
    owner: 'Cheryl',
    due_on: '2026-09-30',
    notes: 'From 44 stuck at quarter seed (2026-08-05).',
  },
  {
    title: 'Run 4 consecutive weekly meetings in-tool, decisions in the brain',
    owner: 'Craig',
    due_on: '2026-09-07',
    notes: 'Phase 2 acceptance gate; first packet lands Mon 2026-08-10.',
  },
];

async function main() {
  const supabase = getSupabaseAdmin();
  for (const r of ROCKS) {
    const { data: existing } = await supabase
      .from('rock')
      .select('id')
      .eq('org_id', 'hdpm')
      .eq('quarter', QUARTER)
      .eq('title', r.title)
      .maybeSingle();
    if (existing) {
      console.log(`rock exists, skipped: ${r.title}`);
      continue;
    }
    const { data, error } = await supabase
      .from('rock')
      .insert({
        org_id: 'hdpm',
        title: r.title,
        owner_person: r.owner,
        quarter: QUARTER,
        due_on: r.due_on,
        status: 'on',
        notes: r.notes ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.error(`rock FAILED: ${r.title}:`, error.message);
      continue;
    }
    await logAudit('rock', data.id, 'created', 'system:seed-rocks', {
      quarter: QUARTER,
      owner: r.owner,
    });
    console.log(`rock ✓ ${r.title} → ${r.owner}`);
  }
}

main();
