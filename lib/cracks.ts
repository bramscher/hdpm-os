import { getSupabaseAdmin } from './supabase';
import { loadTripwireSnapshot, runTripwires } from './maintenance/tripwire-engine';
import type { TripwireException } from './maintenance/types';

/**
 * Cracks Radar (2026-08-05): one ranked answer to "what is nobody touching,
 * and whose is it". Pure derivation from surfaces that already exist —
 * tripwire exceptions, no-next-date WOs, agent proposals nobody decided,
 * and overdue/missed EOS to-dos. Feeds the home-dashboard card
 * (/api/maintenance/cracks) and the Monday meeting-prep packet.
 */

export type CrackKind = 'exception' | 'overdue_todo' | 'stale_nudge' | 'needs_date' | 'missed_todo';

export interface Crack {
  kind: CrackKind;
  /** Short chip label, e.g. "Exception", "Overdue to-do". */
  label: string;
  /** The situation: what/where it is (no fix appended). */
  detail: string;
  /** The recommended next step, kept separate so UIs can lay it out as its own line. */
  action: string | null;
  /** Accountable person, when the source knows one. */
  owner: string | null;
  ageDays: number;
  /** Deep link to the thing itself. */
  href: string | null;
}

export const KIND_LABELS: Record<CrackKind, string> = {
  exception: 'Exception',
  overdue_todo: 'Overdue to-do',
  stale_nudge: 'Unanswered nudge',
  needs_date: 'No next action',
  missed_todo: 'Missed to-do',
};

/** How long a proposal can sit undecided before it counts as a crack. */
export const STALE_NUDGE_DAYS = 2;

const KIND_ORDER: Record<CrackKind, number> = {
  exception: 0,
  overdue_todo: 1,
  stale_nudge: 2,
  needs_date: 3,
  missed_todo: 4,
};

/** Severity kind first, then oldest first within a kind. */
export function rankCracks(cracks: Crack[]): Crack[] {
  return [...cracks].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.ageDays - a.ageDays
  );
}

export function exceptionCracks(
  exceptions: TripwireException[],
  kind: 'exception' | 'needs_date'
): Crack[] {
  return exceptions.map((ex) => ({
    kind,
    label: kind === 'exception' ? ex.label : KIND_LABELS.needs_date,
    detail: ex.item,
    action: ex.fixRequired || null,
    owner: ex.owner || null,
    ageDays: ex.ageDays ?? 0,
    href: ex.workOrderId ? `/maintenance/board/wo/${ex.workOrderId}` : '/maintenance/board',
  }));
}

export function proposalCracks(
  proposals: {
    id: string;
    agent: string;
    subject_type: string;
    subject_id: string;
    action_type: string;
    created_at: string;
  }[],
  recipientByProposal: Map<string, string>,
  now: Date
): Crack[] {
  return proposals.flatMap((p): Crack[] => {
    const ageDays = Math.floor((now.getTime() - new Date(p.created_at).getTime()) / 86_400_000);
    if (ageDays < STALE_NUDGE_DAYS) return [];
    return [
      {
        kind: 'stale_nudge' as const,
        label: KIND_LABELS.stale_nudge,
        detail: `${p.agent}: ${p.action_type.replace(/_/g, ' ')} awaiting a decision`,
        action: null,
        owner: recipientByProposal.get(p.id) ?? null,
        ageDays,
        href:
          p.subject_type === 'work_order' ? `/maintenance/board/wo/${p.subject_id}` : '/agents',
      },
    ];
  });
}

export function todoCracks(
  todos: { title: string; owner_person: string | null; due_on: string; status: string }[],
  today: string
): Crack[] {
  const days = (from: string) =>
    Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000));
  return todos.flatMap((t): Crack[] => {
    if (t.status === 'open' && t.due_on < today) {
      return [
        {
          kind: 'overdue_todo' as const,
          label: KIND_LABELS.overdue_todo,
          detail: t.title,
          action: null,
          owner: t.owner_person,
          ageDays: days(t.due_on),
          href: '/company/issues',
        },
      ];
    }
    if (t.status === 'missed') {
      return [
        {
          kind: 'missed_todo' as const,
          label: KIND_LABELS.missed_todo,
          detail: t.title,
          action: null,
          owner: t.owner_person,
          ageDays: days(t.due_on),
          href: '/company/issues',
        },
      ];
    }
    return [];
  });
}

export interface CracksReport {
  cracks: Crack[];
  counts: Record<CrackKind, number>;
  generatedAt: string;
}

export async function collectCracks(now: Date = new Date()): Promise<CracksReport> {
  const supabase = getSupabaseAdmin();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(now);

  // Tripwire exceptions + no-next-date WOs — one live engine run.
  const snapshot = await loadTripwireSnapshot();
  const result = runTripwires(snapshot);

  // Agent proposals still undecided after STALE_NUDGE_DAYS.
  const cutoff = new Date(now.getTime() - STALE_NUDGE_DAYS * 86_400_000).toISOString();
  const { data: proposals } = await supabase
    .from('agent_proposal')
    .select('id, agent, subject_type, subject_id, action_type, created_at')
    .eq('org_id', 'hdpm')
    .eq('status', 'proposed')
    .lt('created_at', cutoff)
    .order('created_at')
    .limit(50);
  const proposalIds = (proposals ?? []).map((p) => p.id);
  const recipientByProposal = new Map<string, string>();
  if (proposalIds.length) {
    const { data: outbox } = await supabase
      .from('agent_outbox')
      .select('proposal_id, recipient_person')
      .in('proposal_id', proposalIds);
    for (const row of outbox ?? []) {
      if (row.proposal_id && row.recipient_person) {
        recipientByProposal.set(row.proposal_id, row.recipient_person);
      }
    }
  }

  // Overdue open to-dos + recently missed ones.
  const missedSince = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const { data: todos } = await supabase
    .from('todo')
    .select('title, owner_person, due_on, status')
    .eq('org_id', 'hdpm')
    .or(`and(status.eq.open,due_on.lt.${today}),and(status.eq.missed,due_on.gte.${missedSince})`)
    .order('due_on')
    .limit(50);

  const cracks = rankCracks([
    ...exceptionCracks(result.exceptions, 'exception'),
    ...exceptionCracks(result.needsDate ?? [], 'needs_date'),
    ...proposalCracks(proposals ?? [], recipientByProposal, now),
    ...todoCracks(todos ?? [], today),
  ]);

  const counts = { exception: 0, overdue_todo: 0, stale_nudge: 0, needs_date: 0, missed_todo: 0 };
  for (const c of cracks) counts[c.kind] += 1;

  return { cracks, counts, generatedAt: now.toISOString() };
}
