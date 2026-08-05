/**
 * Escalation ladder — orchestration (Phase 2, Brief 2C). Daily weekday
 * cron (after the 13:00 tripwire pass and 13:45 estimate chaser):
 *  1. Tripwire exceptions aged past threshold or recurring 3× → issue
 *     (raised_by 'tripwire:<n>', evidence in detail).
 *  2. Estimate-chaser escalation proposals → issue, so escalations can't
 *     evaporate from a Slack DM.
 *  3. Past-due to-dos: first miss rolls once (+7d copy, one Slack nudge);
 *     second miss marks 'missed' and files an issue on the owner's seat.
 * All inserts dedupe on the open-source_ref unique index; every write
 * audits. The ladder escalates visibility — it never solves, never nags
 * twice (doc 06 §5, §9).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { loadTripwireSnapshot, runTripwires } from '@/lib/maintenance/tripwire-engine';
import {
  ESCALATION_ACTOR,
  ESCALATION_LOOKBACK_DAYS,
  TRIPWIRE_RECUR_WINDOW_DAYS,
  MAX_ISSUES_PER_RUNG_PER_RUN,
  todayPacific,
  countEpisodes,
  decideTripwireIssues,
  buildEscalationIssue,
  decideTodoAction,
  buildTodoRoll,
  buildTodoMissedIssue,
  type IssueDraft,
} from './escalation';
import type { Todo } from './types';
import {
  ESTIMATE_CHASER_AGENT,
  ESCALATE_ACTION,
} from '@/lib/agents/estimate-chaser';

const SCREEN_URL = 'https://hdpmchat.highdesertpm.com/company/issues';

export interface EscalationRunResult {
  today: string;
  tripwireIssues: number;
  /** Candidates past the per-run cap — they file on later runs, worst-first. */
  tripwireDeferred: number;
  escalationIssues: number;
  escalationDeferred: number;
  todosRolled: number;
  nudgesSent: number;
  todoIssues: number;
  dryRun: boolean;
}

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** Insert an issue draft; 23505 on the open-source_ref index = already filed (benign). */
async function fileIssue(
  supabase: SupabaseAdmin,
  draft: IssueDraft,
  auditPayload: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase
    .from('issue')
    .insert({
      title: draft.title,
      detail: draft.detail,
      raised_by: draft.raised_by,
      source_ref: draft.source_ref,
      priority: draft.priority,
    })
    .select('id')
    .single();
  if (error) {
    if (!/duplicate|unique/i.test(error.message)) {
      console.error(`[escalation] issue insert failed (${draft.source_ref}):`, error.message);
    }
    return false;
  }
  await logAudit('issue', data.id, 'created', draft.raised_by, auditPayload);
  return true;
}

export async function runEscalation(opts: { dryRun?: boolean; now?: Date } = {}): Promise<EscalationRunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const supabase = getSupabaseAdmin();
  const today = todayPacific(now);
  const result: EscalationRunResult = {
    today,
    tripwireIssues: 0,
    tripwireDeferred: 0,
    escalationIssues: 0,
    escalationDeferred: 0,
    todosRolled: 0,
    nudgesSent: 0,
    todoIssues: 0,
    dryRun,
  };

  // ── 1. Tripwire rung: aged or recurring exceptions ────────────────────
  const snapshot = await loadTripwireSnapshot();
  const { exceptions } = runTripwires(snapshot);
  const woExceptions = exceptions.filter((ex) => ex.workOrderId);

  // Episode counts per (WO, tripwire) from wo_event exception history in
  // the window. Chunked .in() keeps URLs and row counts sane.
  const woIds = [...new Set(woExceptions.map((ex) => ex.workOrderId as string))];
  const since = new Date(now.getTime() - TRIPWIRE_RECUR_WINDOW_DAYS * 86_400_000).toISOString();
  const eventDays = new Map<string, string[]>();
  for (let i = 0; i < woIds.length; i += 50) {
    const chunk = woIds.slice(i, i + 50);
    const { data: eventRows, error } = await supabase
      .from('wo_event')
      .select('work_order_id, payload, created_at')
      .eq('event_type', 'exception')
      .gte('created_at', since)
      .in('work_order_id', chunk)
      .limit(3000);
    if (error) {
      console.error('[escalation] wo_event read failed:', error.message);
      continue;
    }
    for (const row of eventRows ?? []) {
      const tw = (row.payload as Record<string, unknown>)?.tripwire;
      if (typeof tw !== 'number') continue;
      const key = `${row.work_order_id}:${tw}`;
      if (!eventDays.has(key)) eventDays.set(key, []);
      eventDays.get(key)!.push(String(row.created_at).slice(0, 10));
    }
  }
  const episodes = new Map<string, number>();
  for (const [key, dates] of eventDays) episodes.set(key, countEpisodes(dates));

  // Cap counts successful files: already-open drafts (dedupe) don't use a
  // slot, so the backlog drains a full cap's worth per run, worst-first.
  const tripwireDrafts = decideTripwireIssues(woExceptions, episodes);
  for (const [i, draft] of tripwireDrafts.entries()) {
    if (result.tripwireIssues >= MAX_ISSUES_PER_RUNG_PER_RUN) {
      result.tripwireDeferred = tripwireDrafts.length - i;
      break;
    }
    if (dryRun) {
      result.tripwireIssues++;
      continue;
    }
    const filed = await fileIssue(supabase, draft, {
      reason: 'tripwire_aged_or_recurring',
      source_ref: draft.source_ref,
    });
    if (filed) result.tripwireIssues++;
  }

  // ── 2. Agent-escalation rung: chaser escalations → issue ──────────────
  const sinceProposals = new Date(
    now.getTime() - ESCALATION_LOOKBACK_DAYS * 86_400_000
  ).toISOString();
  const { data: proposalRows, error: propErr } = await supabase
    .from('agent_proposal')
    .select('id, subject_id, payload, rationale')
    .eq('agent', ESTIMATE_CHASER_AGENT)
    .eq('action_type', ESCALATE_ACTION)
    .gte('created_at', sinceProposals)
    .order('created_at', { ascending: false });
  if (propErr) {
    console.error('[escalation] agent_proposal read failed:', propErr.message);
  }
  const seenRefs = new Set<string>();
  const escalationDrafts: { draft: NonNullable<ReturnType<typeof buildEscalationIssue>>; proposalId: string }[] = [];
  for (const proposal of proposalRows ?? []) {
    const draft = buildEscalationIssue(
      proposal as { id: string; subject_id: string | null; payload: Record<string, unknown>; rationale: string | null }
    );
    if (!draft || seenRefs.has(draft.source_ref)) continue;
    seenRefs.add(draft.source_ref);
    escalationDrafts.push({ draft, proposalId: proposal.id });
  }
  for (const [i, { draft, proposalId }] of escalationDrafts.entries()) {
    if (result.escalationIssues >= MAX_ISSUES_PER_RUNG_PER_RUN) {
      result.escalationDeferred = escalationDrafts.length - i;
      break;
    }
    if (dryRun) {
      result.escalationIssues++;
      continue;
    }
    const filed = await fileIssue(supabase, draft, {
      reason: 'agent_escalation',
      proposal_id: proposalId,
    });
    if (filed) result.escalationIssues++;
  }

  // ── 3. To-do rung: roll once, then file ───────────────────────────────
  const { data: dueRows, error: todoErr } = await supabase
    .from('todo')
    .select('*')
    .eq('org_id', 'hdpm')
    .eq('status', 'open')
    .lt('due_on', today);
  if (todoErr) throw new Error(`todo read failed: ${todoErr.message}`);
  const pastDue = (dueRows ?? []) as Todo[];

  // A todo whose source_id points at another todo IS a rolled copy.
  const sourceIds = [...new Set(pastDue.map((t) => t.source_id).filter(Boolean))] as string[];
  const parentTodoIds = new Set<string>();
  if (sourceIds.length > 0) {
    const { data: parents } = await supabase.from('todo').select('id').in('id', sourceIds);
    for (const p of parents ?? []) parentTodoIds.add(p.id);
  }
  // Re-run guard: todos already rolled today (a copy pointing at them exists).
  const alreadyRolled = new Set<string>();
  if (pastDue.length > 0) {
    const { data: copies } = await supabase
      .from('todo')
      .select('source_id')
      .in('source_id', pastDue.map((t) => t.id));
    for (const c of copies ?? []) if (c.source_id) alreadyRolled.add(c.source_id);
  }

  let nudgesQueued = 0;
  for (const t of pastDue) {
    const isRoll = t.source_id !== null && parentTodoIds.has(t.source_id);
    const action = decideTodoAction(t, isRoll, today);
    if (action === 'roll') {
      if (dryRun) {
        result.todosRolled++;
        result.nudgesSent++;
        continue;
      }
      let rolled = alreadyRolled.has(t.id);
      if (!rolled) {
        const { insert, nudge } = buildTodoRoll(t, today);
        const { data: copyRow, error: copyErr } = await supabase
          .from('todo')
          .insert(insert)
          .select('id')
          .single();
        if (copyErr) {
          console.error(`[escalation] todo roll insert failed (${t.id}):`, copyErr.message);
          continue;
        }
        rolled = true;
        await logAudit('todo', t.id, 'rolled', ESCALATION_ACTOR, {
          rolled_to: copyRow.id,
          due_was: t.due_on,
          due_now: insert.due_on,
        });
        // The single nudge, at roll time. No nudge on the second miss —
        // the issue is the visibility.
        if (t.owner_person) {
          const owner = await resolveStaffByPersonOrEmail(t.owner_person);
          if (owner?.slack_user_id) {
            await enqueueOutbox({
              channel: 'slack',
              recipient_person: t.owner_person,
              recipient_address: owner.slack_user_id,
              subject: nudge.subject,
              body: nudge.body(SCREEN_URL),
              payload: { todo_id: t.id, rolled_to: copyRow.id },
            });
            nudgesQueued++;
            result.nudgesSent++;
          } else {
            console.warn(`[escalation] no slack_user_id for ${t.owner_person} — rolled without nudge`);
          }
        }
      }
      const { error: upErr } = await supabase
        .from('todo')
        .update({ status: 'rolled' })
        .eq('id', t.id);
      if (upErr) console.error(`[escalation] todo roll update failed (${t.id}):`, upErr.message);
      else result.todosRolled++;
    } else if (action === 'file_issue') {
      if (dryRun) {
        result.todoIssues++;
        continue;
      }
      let seatName: string | null = null;
      let originalDueOn: string | null = null;
      if (t.owner_person) {
        const { data: seatRow } = await supabase
          .from('seat')
          .select('name')
          .eq('person', t.owner_person)
          .eq('active', true)
          .limit(1)
          .maybeSingle();
        seatName = seatRow?.name ?? null;
      }
      const { data: original } = await supabase
        .from('todo')
        .select('due_on')
        .eq('id', t.source_id as string)
        .maybeSingle();
      originalDueOn = original?.due_on ?? null;

      const { error: missErr } = await supabase
        .from('todo')
        .update({ status: 'missed' })
        .eq('id', t.id);
      if (missErr) {
        console.error(`[escalation] todo missed update failed (${t.id}):`, missErr.message);
        continue;
      }
      await logAudit('todo', t.id, 'missed', ESCALATION_ACTOR, {
        root_todo: t.source_id,
        due_on: t.due_on,
      });
      const filed = await fileIssue(supabase, buildTodoMissedIssue(t, originalDueOn, seatName), {
        reason: 'todo_missed_twice',
        todo_id: t.id,
        root_todo: t.source_id,
        owner: t.owner_person,
      });
      if (filed) result.todoIssues++;
    }
  }

  if (!dryRun && nudgesQueued > 0) {
    await dispatchOutbox({ channel: 'slack', now });
  }

  console.log('[escalation]', JSON.stringify(result));
  return result;
}
