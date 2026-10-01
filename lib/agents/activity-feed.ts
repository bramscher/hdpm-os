/**
 * One timeline across the agent layer: cron runs, proposals, outbox sends,
 * chase-board actions, parts-order contacts, human work-order events, Dez
 * answers and brain ingests. Served by /api/agents/activity and polled by the
 * /agents hero every 20 seconds.
 *
 * Each source is read independently and a failing source (e.g. a table whose
 * migration isn't applied yet) is skipped, so the feed degrades instead of
 * erroring. The row → item mappers are pure and unit-tested.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { routineById } from '@/lib/routines/registry';
import { actionLabel, agentName } from '@/lib/agents/catalog';

export type FeedSource = 'routine' | 'proposal' | 'outbox' | 'chase' | 'parts' | 'work_order' | 'dez' | 'brain';
export type FeedTone = 'good' | 'warn' | 'bad' | 'neutral' | 'human';

export interface FeedItem {
  id: string;
  at: string;
  source: FeedSource;
  actor: string;
  text: string;
  tone: FeedTone;
  href?: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const woHref = (id: unknown) => (id ? `/maintenance/board/wo/${s(id)}` : undefined);

/** System/agent actors are prefixed (system:sync, agent:estimate_chaser); people are not. */
export const isHumanActor = (actor: string | null | undefined) => !!actor && !/^(system|agent|cron|dez)[:_]/i.test(actor);

export function fromRoutineRun(r: Row): FeedItem {
  const routine = routineById(s(r.routine_id));
  const name = routine?.name ?? s(r.routine_id);
  const status = s(r.status);
  const tone: FeedTone = status === 'ok' ? 'good' : status === 'error' ? 'bad' : status === 'running' ? 'neutral' : 'warn';
  const detail =
    status === 'error' ? `failed: ${s(r.error) || 'unknown error'}` :
    status === 'halted' ? `halted: ${s(r.halt_reason)}` :
    status === 'skipped' ? `skipped: ${s(r.halt_reason)}` :
    status === 'running' ? 'started' :
    typeof r.items === 'number' ? `ran (${r.items} items)` : 'ran';
  return { id: `run:${s(r.id)}`, at: s(r.finished_at) || s(r.started_at), source: 'routine', actor: 'Scheduler', text: `${name} ${detail}`, tone };
}

export function fromProposal(r: Row): FeedItem {
  const status = s(r.status);
  const verb: Record<string, string> = {
    proposed: 'proposed', approved: 'approved', edited: 'approved with edits', rejected: 'rejected', expired: 'expired', auto_applied: 'auto-applied',
  };
  const decided = status !== 'proposed' && r.decided_by;
  return {
    id: `proposal:${s(r.id)}:${status}`,
    at: s(decided ? r.decided_at : r.created_at) || s(r.created_at),
    source: 'proposal',
    actor: decided ? s(r.decided_by) : agentName(s(r.agent)),
    text: `${actionLabel(s(r.agent), s(r.action_type))} ${verb[status] ?? status}`,
    tone: status === 'rejected' ? 'warn' : decided ? 'human' : 'neutral',
    href: s(r.subject_type) === 'work_order' ? woHref(r.subject_id) : undefined,
  };
}

export function fromOutbox(r: Row): FeedItem {
  const status = s(r.status);
  const to = s(r.recipient_person) || s(r.recipient_address) || 'someone';
  const channel: Record<string, string> = { slack: 'Slack', sms_zoom: 'text', outlook_draft: 'Outlook draft', email: 'email', in_app: 'in-app' };
  const what = s(r.subject) ? ` “${s(r.subject).slice(0, 80)}”` : '';
  return {
    id: `outbox:${s(r.id)}`,
    at: s(r.sent_at) || s(r.last_attempt_at) || s(r.created_at),
    source: 'outbox',
    actor: 'Outbox',
    text: `${channel[s(r.channel)] ?? s(r.channel)} to ${to}${what} ${status === 'sent' ? 'sent' : status === 'failed' ? `failed${r.error ? `: ${s(r.error)}` : ''}` : status}`,
    tone: status === 'sent' ? 'good' : status === 'failed' ? 'bad' : 'neutral',
  };
}

export function fromChaseEvent(r: Row): FeedItem {
  return {
    id: `chase:${s(r.id)}`,
    at: s(r.created_at),
    source: 'chase',
    actor: s(r.actor),
    text: `Chase board: ${s(r.action).replace(/_/g, ' ')}`,
    tone: isHumanActor(s(r.actor)) ? 'human' : 'neutral',
    href: woHref(r.work_order_id),
  };
}

export function fromPartsEvent(r: Row): FeedItem {
  const order = (r.parts_order ?? {}) as Row;
  const mins = typeof r.minutes_spent === 'number' && r.minutes_spent > 0 ? ` (${r.minutes_spent} min)` : '';
  const note = s(r.note) ? `: ${s(r.note).slice(0, 80)}` : '';
  return {
    id: `parts:${s(r.id)}`,
    at: s(r.at),
    source: 'parts',
    actor: s(r.actor),
    text: `Parts order ${s(order.item) ? `“${s(order.item)}” ` : ''}${s(r.kind)}${mins}${note}`,
    tone: 'human',
    href: woHref(order.work_order_id),
  };
}

export function fromWoEvent(r: Row): FeedItem {
  return {
    id: `wo:${s(r.id)}`,
    at: s(r.created_at),
    source: 'work_order',
    actor: s(r.actor),
    text: `Work order ${s(r.event_type).replace(/_/g, ' ')}`,
    tone: 'human',
    href: woHref(r.work_order_id),
  };
}

export function fromDez(r: Row): FeedItem {
  return { id: `dez:${s(r.id)}`, at: s(r.created_at), source: 'dez', actor: s(r.actor_person) || 'Dez', text: s(r.summary), tone: s(r.kind) === 'question' ? 'human' : 'neutral' };
}

export function fromBrainIngest(r: Row): FeedItem {
  const action = s(r.action);
  return {
    id: `brain:${s(r.id)}`,
    at: s(r.at),
    source: 'brain',
    actor: 'Brain',
    text: `${action === 'add' ? 'Learned' : action === 'update' ? 'Updated' : action === 'error' ? 'Failed to ingest' : action === 'redact' ? 'Redacted' : 'Skipped'} ${s(r.ref) || s(r.source)}${r.reason ? ` (${s(r.reason)})` : ''}`,
    tone: action === 'error' ? 'bad' : action === 'add' || action === 'update' ? 'good' : 'neutral',
  };
}

/** Newest first, de-duplicated by id, capped. */
export function mergeFeed(lists: FeedItem[][], limit = 80): FeedItem[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((i) => i.at && !seen.has(i.id) && seen.add(i.id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export async function loadActivityFeed(since: Date, limit = 80): Promise<FeedItem[]> {
  const supabase = getSupabaseAdmin();
  const iso = since.toISOString();
  const per = Math.min(limit, 60);

  const read = async (label: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>, map: (r: Row) => FeedItem) => {
    try {
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map(map);
    } catch (e) {
      console.warn(`[Activity] ${label} skipped:`, (e as Error).message);
      return [];
    }
  };

  const lists = await Promise.all([
    // Successful continuous syncs would drown the feed; show their problems only.
    read('routine_run', supabase.from('routine_run').select('*').gte('started_at', iso).order('started_at', { ascending: false }).limit(per * 3), fromRoutineRun).then((items) =>
      items.filter((i) => i.tone !== 'good' || !/sync|resolver|snapshot|periods/i.test(i.text))
    ),
    read('agent_proposal', supabase.from('agent_proposal').select('id, agent, action_type, subject_type, subject_id, status, decided_by, decided_at, created_at').or(`created_at.gte.${iso},decided_at.gte.${iso}`).order('created_at', { ascending: false }).limit(per), fromProposal),
    read('agent_outbox', supabase.from('agent_outbox').select('id, channel, recipient_person, recipient_address, subject, status, error, created_at, last_attempt_at, sent_at').gte('created_at', iso).order('created_at', { ascending: false }).limit(per), fromOutbox),
    read('estimate_followup_event', supabase.from('estimate_followup_event').select('id, work_order_id, actor, action, created_at').gte('created_at', iso).order('created_at', { ascending: false }).limit(per), fromChaseEvent),
    read('parts_order_event', supabase.from('parts_order_event').select('id, kind, minutes_spent, actor, note, at, parts_order(item, work_order_id)').gte('at', iso).order('at', { ascending: false }).limit(per), fromPartsEvent),
    read('wo_event', supabase.from('wo_event').select('id, work_order_id, event_type, actor, created_at').gte('created_at', iso).not('actor', 'like', 'system:%').not('actor', 'like', 'agent:%').order('created_at', { ascending: false }).limit(per), fromWoEvent).then((items) => items.filter((i) => isHumanActor(i.actor))),
    read('dez_activity', supabase.from('dez_activity').select('id, created_at, kind, actor_person, summary').gte('created_at', iso).order('created_at', { ascending: false }).limit(per), fromDez),
    read('brain_ingest_log', supabase.from('brain_ingest_log').select('id, source, ref, action, reason, at').gte('at', iso).neq('action', 'skip').order('at', { ascending: false }).limit(per), fromBrainIngest),
  ]);
  return mergeFeed(lists, limit);
}
