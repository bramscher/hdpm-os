/**
 * agent_proposal CRUD — every agent output is a row here first
 * (pattern generalized from ai_triage_proposal + its apply route).
 */

import { getSupabaseAdmin } from './db';
import type { AgentProposal } from './types';

export interface NewProposal {
  agent: string;
  subject_type: string;
  subject_id?: string | null;
  action_type: string;
  payload?: Record<string, unknown>;
  rationale?: string | null;
}

export async function createProposal(input: NewProposal): Promise<AgentProposal> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('agent_proposal')
    .insert({
      agent: input.agent,
      subject_type: input.subject_type,
      subject_id: input.subject_id ?? null,
      action_type: input.action_type,
      payload: input.payload ?? {},
      rationale: input.rationale ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`Proposal create failed: ${error?.message}`);
  return data as AgentProposal;
}

export async function listProposals(filter: {
  status?: string;
  agent?: string;
  subject_type?: string;
  subject_id?: string;
  limit?: number;
} = {}): Promise<AgentProposal[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('agent_proposal')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 100);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.agent) query = query.eq('agent', filter.agent);
  if (filter.subject_type) query = query.eq('subject_type', filter.subject_type);
  if (filter.subject_id) query = query.eq('subject_id', filter.subject_id);
  const { data, error } = await query;
  if (error) throw new Error(`Proposal list failed: ${error.message}`);
  return (data ?? []) as AgentProposal[];
}

export type ProposalDecision = 'approved' | 'edited' | 'rejected';

/**
 * Decide a pending proposal. Guarded on status='proposed' (idempotent — a
 * second decide returns null → 409 upstream). On 'edited', the human's
 * changes merge over the payload and the agent's original is preserved under
 * payload.original — that's the training signal for autonomy promotion.
 * decidedBy must be a HUMAN actor (enforced at the API layer).
 */
export async function decideProposal(
  id: string,
  decision: ProposalDecision,
  decidedBy: string,
  editedPayload?: Record<string, unknown>
): Promise<AgentProposal | null> {
  const supabase = getSupabaseAdmin();

  const patch: Record<string, unknown> = {
    status: decision,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
  };

  if (decision === 'edited' && editedPayload) {
    const { data: existing } = await supabase
      .from('agent_proposal')
      .select('payload')
      .eq('id', id)
      .maybeSingle();
    const original = (existing?.payload ?? {}) as Record<string, unknown>;
    patch.payload = { ...original, ...editedPayload, original };
  }

  const { data, error } = await supabase
    .from('agent_proposal')
    .update(patch)
    .eq('id', id)
    .eq('status', 'proposed')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Proposal decide failed: ${error.message}`);
  return (data as AgentProposal) ?? null;
}
