/**
 * Maintenance OS — batch AI triage (Session B).
 *
 * Runs the existing per-WO AI triage (lib/maintenance/ai-triage.ts) across a
 * pool of open work orders and stores the results as PROPOSALS in
 * ai_triage_proposal. Nothing touches a work order until a human applies a
 * proposal — applies go through updateWorkOrderWorkflow (the single write
 * path), so the audit trail reads exactly like manual triage.
 *
 * The AI classifies; the numbers are code:
 *  - next-action date derives from the recommended priority per the SLA table
 *  - owner derives from blocker/status rules
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchWorkOrderDetails } from '@/lib/appfolio';
import type { AiTriage } from './ai-triage';
import { generateTriage } from './ai-triage';
import { listEvents } from './events';
import { nextBusinessDay, toDateString } from './business-days';
import type { MaintWorkOrder, Stage, TriageProposal } from './types';

// ============================================
// Pure derivation (unit-tested)
// ============================================

/** Business days of runway per priority class (SLA table, 02-functional-spec §4). */
const RUNWAY_BUSINESS_DAYS: Record<AiTriage['priority']['recommended'], number> = {
  P1: 0, // act today
  P2: 2, // schedule <= 48 hrs
  P3: 5, // schedule <= 7 days
  P4: 10, // planned
};

export interface DerivedProposal {
  proposed_priority_class: AiTriage['priority']['recommended'];
  proposed_next_action_date: string;
  proposed_owner_name: 'Cheryl' | 'Jen';
  proposed_stage: Stage | null;
}

/** Derive the applyable fields from an AI triage. Pure. */
export function proposalFrom(
  triage: AiTriage,
  wo: Pick<MaintWorkOrder, 'stage' | 'appfolio_status'>,
  today: Date
): DerivedProposal {
  const priority = triage.priority.recommended;

  // Date rule is code, not model output: P1 = today, else N business days out.
  let date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = 0; i < RUNWAY_BUSINESS_DAYS[priority]; i++) {
    date = nextBusinessDay(date);
  }

  // Role correction 2026-07-18 (docs/agent-os/01 Q3): Cheryl owns vendor
  // estimates AND owner approvals for maintenance; PMs do no maintenance work.
  const owner = 'Cheryl';

  return {
    proposed_priority_class: priority,
    proposed_next_action_date: toDateString(date),
    proposed_owner_name: owner,
    proposed_stage: wo.stage === 'NEW' ? 'TRIAGED' : null,
  };
}

// ============================================
// Batch runner
// ============================================

export interface BatchResult {
  processed: number;
  remaining: number;
  errors: { workOrderId: string; error: string }[];
}

/**
 * Generate proposals for up to `limit` open WOs in `stages` that don't have a
 * proposal row yet (oldest first). Resumable by construction — call again
 * until remaining = 0. Per-WO error capture: one failure never aborts a batch.
 */
// 8/chunk: measured ~24s per WO live (AppFolio fetch + adaptive thinking)
// → ~195s per invocation, safe margin under Vercel's 300s maxDuration.
export async function runTriageBatch(stages: Stage[], limit = 8): Promise<BatchResult> {
  const supabase = getSupabaseAdmin();

  // Pool: open WOs in the requested stages, minus those already proposed.
  const { data: proposed, error: propErr } = await supabase
    .from('ai_triage_proposal')
    .select('work_order_id');
  if (propErr) throw new Error(`Proposal lookup failed: ${propErr.message}`);
  const proposedIds = new Set((proposed ?? []).map((p) => p.work_order_id));

  const { data: pool, error: poolErr } = await supabase
    .from('work_orders')
    .select('*')
    .in('stage', stages)
    .order('appfolio_created_at', { ascending: true, nullsFirst: false })
    .limit(limit + proposedIds.size); // over-fetch to survive the filter
  if (poolErr) throw new Error(`Pool lookup failed: ${poolErr.message}`);

  const candidates = ((pool ?? []) as MaintWorkOrder[])
    .filter((wo) => !proposedIds.has(wo.id))
    .slice(0, limit);

  const errors: BatchResult['errors'] = [];
  let processed = 0;
  const now = new Date();

  for (const wo of candidates) {
    try {
      const [events, detail] = await Promise.all([
        listEvents(wo.id),
        fetchWorkOrderDetails(wo.appfolio_id),
      ]);
      const triage = await generateTriage(wo, events, { appfolio: detail });
      const derived = proposalFrom(triage, wo, now);

      const { error: upErr } = await supabase.from('ai_triage_proposal').upsert(
        {
          work_order_id: wo.id,
          triage: triage as unknown as Record<string, unknown>,
          ...derived,
          status: 'pending',
          created_at: now.toISOString(),
        },
        { onConflict: 'work_order_id' }
      );
      if (upErr) throw new Error(upErr.message);
      processed++;
    } catch (err) {
      errors.push({
        workOrderId: wo.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Remaining = pool count minus proposal rows (post-run)
  const { count: poolCount } = await supabase
    .from('work_orders')
    .select('*', { count: 'exact', head: true })
    .in('stage', stages);
  const { data: afterProposed } = await supabase
    .from('ai_triage_proposal')
    .select('work_order_id');
  const afterIds = new Set((afterProposed ?? []).map((p) => p.work_order_id));
  const { data: poolIds } = await supabase
    .from('work_orders')
    .select('id')
    .in('stage', stages);
  const remaining = ((poolIds ?? []) as { id: string }[]).filter((r) => !afterIds.has(r.id)).length;
  void poolCount;

  return { processed, remaining, errors };
}

// ============================================
// Counts + listing for the review UI
// ============================================

export async function proposalCounts(): Promise<{
  pending: number;
  applied: number;
  skipped: number;
}> {
  const supabase = getSupabaseAdmin();
  const counts = { pending: 0, applied: 0, skipped: 0 };
  for (const status of ['pending', 'applied', 'skipped'] as const) {
    const { count } = await supabase
      .from('ai_triage_proposal')
      .select('*', { count: 'exact', head: true })
      .eq('status', status);
    counts[status] = count ?? 0;
  }
  return counts;
}

/** Pending proposals joined with their WOs, for the review list. */
export async function listPendingProposals(): Promise<
  { proposal: TriageProposal; workOrder: MaintWorkOrder }[]
> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ai_triage_proposal')
    .select('*, work_orders(*)')
    .eq('status', 'pending');
  if (error) throw new Error(`Proposal list failed: ${error.message}`);

  return ((data ?? []) as (TriageProposal & { work_orders: MaintWorkOrder })[])
    .filter((row) => row.work_orders)
    .map((row) => {
      const { work_orders: workOrder, ...proposal } = row;
      return { proposal: proposal as TriageProposal, workOrder };
    });
}
