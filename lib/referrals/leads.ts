/**
 * Referral lead service layer (Batch 3) — service-role (admin + system path).
 *
 * Two submission paths funnel here:
 *  - Referrer portal: the route RLS-inserts the lead as the referrer, then calls
 *    finalizeNewLead() (event + dedupe) here.
 *  - Website intake (S2S): createIntakeLead() inserts + finalizes.
 *
 * Dedupe, stage changes, and the append-only referral_lead_event are all
 * service-role (a referrer submits a lead but never drives the pipeline).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchAppFolioOwnerContacts } from '@/lib/appfolio';
import { logAudit } from '@/lib/audit';
import { findDuplicate, type DedupeCandidate, type Prospect } from './dedupe';
import { notifyLeadSubmitted, notifyStatusChange } from './notify';
import {
  OPEN_LEAD_STAGES,
  type LeadEvent,
  type LeadSource,
  type LeadStage,
  type ReferralLead,
} from './types';

async function writeLeadEvent(
  leadId: string,
  eventType: string,
  payload: Record<string, unknown>,
  actor: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('referral_lead_event')
    .insert({ lead_id: leadId, event_type: eventType, payload, actor });
  if (error) throw new Error(`writeLeadEvent(${eventType}): ${error.message}`);
}

/** Resolve a referral code to a partner id, or null (unknown code → organic). */
export async function resolvePartnerByCode(code: string | null): Promise<string | null> {
  if (!code) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('referral_partner')
    .select('id')
    .eq('referral_code', code.trim())
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Best-effort dedupe against open leads + current AppFolio owners. AppFolio is
 * wrapped so a slow/failed owner fetch never blocks a submission.
 */
export async function runDedupe(prospect: Prospect, excludeLeadId?: string) {
  const supabase = getSupabaseAdmin();
  const candidates: DedupeCandidate[] = [];

  const { data: leads, error } = await supabase
    .from('referral_lead')
    .select('id, prospect_name, prospect_email, prospect_phone, first_touch_at, stage')
    .in('stage', OPEN_LEAD_STAGES);
  if (error) throw new Error(`runDedupe leads: ${error.message}`);
  for (const l of leads ?? []) {
    if (excludeLeadId && l.id === excludeLeadId) continue;
    candidates.push({
      kind: 'lead',
      id: l.id,
      name: l.prospect_name,
      email: l.prospect_email,
      phone: l.prospect_phone,
      firstTouchAt: l.first_touch_at,
    });
  }

  try {
    const owners = await fetchAppFolioOwnerContacts();
    for (const o of owners) {
      candidates.push({ kind: 'owner', id: o.appfolioId, name: o.name, email: o.email, phone: o.phoneRaw });
    }
  } catch (err) {
    console.warn('[referrals] owner dedupe skipped (AppFolio fetch failed):', err instanceof Error ? err.message : err);
  }

  return findDuplicate(prospect, candidates);
}

/** After a lead exists: write the 'created' event and flag suspected duplicates. */
export async function finalizeNewLead(leadId: string, actor: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await supabase
    .from('referral_lead')
    .select('id, prospect_name, prospect_email, prospect_phone, source, ref_code, partner_id')
    .eq('id', leadId)
    .single();
  if (error) throw new Error(`finalizeNewLead read: ${error.message}`);

  await writeLeadEvent(leadId, 'created', { source: lead.source, ref_code: lead.ref_code }, actor);

  // Notify referral ops of the new lead (best-effort; never blocks).
  try {
    await notifyLeadSubmitted({
      id: lead.id,
      prospect_name: lead.prospect_name,
      source: lead.source,
      partner_id: lead.partner_id,
    });
  } catch (err) {
    console.error('[referrals] notifyLeadSubmitted failed:', err instanceof Error ? err.message : err);
  }

  const hit = await runDedupe(
    { name: lead.prospect_name, email: lead.prospect_email, phone: lead.prospect_phone },
    leadId
  );
  if (hit) {
    const patch: Record<string, unknown> = { dup_status: 'suspected', updated_at: new Date().toISOString() };
    // First-touch wins: point at the earlier LEAD; owner matches are noted only.
    if (hit.candidate.kind === 'lead') patch.dup_of_lead_id = hit.candidate.id;
    await supabase.from('referral_lead').update(patch).eq('id', leadId);
    await writeLeadEvent(
      leadId,
      'dedupe',
      { matched_kind: hit.candidate.kind, matched_id: hit.candidate.id, reason: hit.reason },
      'system:dedupe'
    );
  }
}

export interface IntakeLeadInput {
  prospect_name: string;
  prospect_email?: string | null;
  prospect_phone?: string | null;
  property_addresses?: string[] | null;
  unit_count?: number | null;
  notes?: string | null;
  ref_code?: string | null;
  utm?: Record<string, unknown> | null;
  landing_page?: string | null;
  hdpm_web_lead_id?: string | null;
}

/** Website intake (S2S): resolve attribution, insert, finalize. Returns the lead id. */
export async function createIntakeLead(input: IntakeLeadInput, actor: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const partnerId = await resolvePartnerByCode(input.ref_code ?? null);
  const source: LeadSource = partnerId ? 'referral' : 'organic';

  const { data, error } = await supabase
    .from('referral_lead')
    .insert({
      partner_id: partnerId,
      source,
      stage: 'submitted',
      prospect_name: input.prospect_name,
      prospect_email: input.prospect_email ?? null,
      prospect_phone: input.prospect_phone ?? null,
      property_addresses: input.property_addresses ?? null,
      unit_count: input.unit_count ?? null,
      notes: input.notes ?? null,
      ref_code: input.ref_code ?? null,
      utm: input.utm ?? null,
      landing_page: input.landing_page ?? null,
      hdpm_web_lead_id: input.hdpm_web_lead_id ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createIntakeLead: ${error.message}`);

  await finalizeNewLead(data.id, actor);
  return data.id;
}

// ---- Admin pipeline ----

export async function listLeads(filters: {
  stage?: LeadStage;
  source?: LeadSource;
  partnerId?: string;
} = {}): Promise<ReferralLead[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase.from('referral_lead').select('*').eq('org_id', 'hdpm');
  if (filters.stage) q = q.eq('stage', filters.stage);
  if (filters.source) q = q.eq('source', filters.source);
  if (filters.partnerId) q = q.eq('partner_id', filters.partnerId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(`listLeads: ${error.message}`);
  return (data ?? []) as ReferralLead[];
}

export async function getLeadWithEvents(
  id: string
): Promise<{ lead: ReferralLead; events: LeadEvent[] } | null> {
  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await supabase.from('referral_lead').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getLeadWithEvents: ${error.message}`);
  if (!lead) return null;
  const { data: events, error: evErr } = await supabase
    .from('referral_lead_event')
    .select('*')
    .eq('lead_id', id)
    .order('created_at', { ascending: false });
  if (evErr) throw new Error(`getLeadWithEvents events: ${evErr.message}`);
  return { lead: lead as ReferralLead, events: (events ?? []) as LeadEvent[] };
}

export async function setLeadStage(id: string, stage: LeadStage, actor: string): Promise<ReferralLead> {
  const supabase = getSupabaseAdmin();
  const { data: prev } = await supabase.from('referral_lead').select('stage').eq('id', id).single();
  const { data, error } = await supabase
    .from('referral_lead')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`setLeadStage: ${error.message}`);
  await writeLeadEvent(id, 'stage_change', { from: prev?.stage ?? null, to: stage }, actor);
  // Notify the referrer of the status change (best-effort; never blocks).
  try {
    await notifyStatusChange(
      { id: data.id, prospect_name: data.prospect_name, partner_id: data.partner_id },
      (prev?.stage as LeadStage) ?? null,
      stage
    );
  } catch (err) {
    console.error('[referrals] notifyStatusChange failed:', err instanceof Error ? err.message : err);
  }
  return data as ReferralLead;
}

/** Admin dedupe decision: confirm (keep flagged) or clear (false positive). */
export async function resolveDedupe(
  id: string,
  decision: 'confirmed' | 'cleared',
  actor: string,
  reason?: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const patch: Record<string, unknown> = { dup_status: decision, updated_at: new Date().toISOString() };
  if (decision === 'cleared') patch.dup_of_lead_id = null;
  const { error } = await supabase.from('referral_lead').update(patch).eq('id', id);
  if (error) throw new Error(`resolveDedupe: ${error.message}`);
  await writeLeadEvent(id, 'dedupe', { decision, reason: reason ?? null }, actor);
  await logAudit('referral_lead', id, `dedupe_${decision}`, actor, { reason: reason ?? null });
}

export interface LinkAppFolioInput {
  appfolio_owner_id?: string | null;
  appfolio_property_ids?: string[] | null;
  doors_under_mgmt?: number | null;
}

export async function linkAppFolio(id: string, input: LinkAppFolioInput, actor: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('referral_lead')
    .update({
      appfolio_owner_id: input.appfolio_owner_id ?? null,
      appfolio_property_ids: input.appfolio_property_ids ?? null,
      doors_under_mgmt: input.doors_under_mgmt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`linkAppFolio: ${error.message}`);
  await writeLeadEvent(id, 'link_appfolio', { ...input }, actor);
}
