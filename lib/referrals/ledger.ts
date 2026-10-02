/**
 * One-time bounty ledger — server side (Batch 5). Admin path, service role.
 *
 * Earning happens when a referred lead first reaches agreement_signed
 * (accrueBountyOnSigning, called from setLeadStage); approve / mark paid /
 * void are admin actions. The rules live in ./bounty.ts (pure, tested). Every
 * write is a new append-only ledger row; the partial unique indexes from
 * 20261005_referral_bounty_ledger.sql make each step happen at most once per
 * lead, and a unique conflict here means "already done", never a double-pay.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { isAgentActor } from '@/lib/agents/actor';
import { getFeePolicies } from './admin';
import { bountyDecision, nextActions, payableAmount, type BountyDecision } from './bounty';
import { notifyAccrual, notifyPayout } from './notify';
import type { FeeAgreementRow, LedgerEntry, PartnerTermsRow, ReferralLead } from './types';

/** A refused admin action (wrong state, missing input). Routes map it to 409/400. */
export class BountyActionError extends Error {
  constructor(message: string, public readonly status: 400 | 409 = 409) {
    super(message);
    this.name = 'BountyActionError';
  }
}

const SIGNED_OR_LATER = new Set(['agreement_signed', 'onboarding', 'active', 'closed']);
const today = () => new Date().toISOString().slice(0, 10);
const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505';

async function leadEvent(leadId: string, eventType: string, payload: Record<string, unknown>, actor: string) {
  const { error } = await getSupabaseAdmin().from('referral_lead_event').insert({ lead_id: leadId, event_type: eventType, payload, actor });
  if (error) console.error(`[referrals] lead event ${eventType} failed:`, error.message);
}

export async function getLeadLedger(leadId: string): Promise<LedgerEntry[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('referral_ledger')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getLeadLedger: ${error.message}`);
  return (data ?? []) as LedgerEntry[];
}

export async function getLeadAgreement(leadId: string): Promise<FeeAgreementRow | null> {
  const { data } = await getSupabaseAdmin()
    .from('referral_fee_agreement')
    .select('*')
    .eq('lead_id', leadId)
    .eq('fee_kind', 'one_time_bounty')
    .maybeSingle();
  return (data as FeeAgreementRow | null) ?? null;
}

async function loadLead(leadId: string): Promise<ReferralLead> {
  const { data, error } = await getSupabaseAdmin().from('referral_lead').select('*').eq('id', leadId).maybeSingle();
  if (error) throw new Error(`loadLead: ${error.message}`);
  if (!data) throw new BountyActionError('Lead not found.', 400);
  return data as ReferralLead;
}

/** Work out (but don't write) whether this lead's bounty would be earned now. */
export async function previewBounty(lead: ReferralLead, entries?: LedgerEntry[]): Promise<BountyDecision> {
  const supabase = getSupabaseAdmin();
  const ledger = entries ?? (await getLeadLedger(lead.id));
  if (!lead.partner_id) {
    return bountyDecision({ lead, partnerType: null, terms: null, policies: [], alreadyEarned: false, today: today() });
  }
  const [{ data: partner }, { data: terms }, policies] = await Promise.all([
    supabase.from('referral_partner').select('type, status').eq('id', lead.partner_id).maybeSingle(),
    supabase.from('referral_partner_terms').select('*').eq('partner_id', lead.partner_id).eq('fee_kind', 'one_time_bounty').maybeSingle(),
    getFeePolicies(),
  ]);
  return bountyDecision({
    lead,
    partnerType: partner?.type ?? null,
    partnerStatus: partner?.status ?? null,
    terms: (terms as PartnerTermsRow | null) ?? null,
    policies,
    alreadyEarned: ledger.some((e) => e.entry_type === 'earned'),
    today: today(),
  });
}

/**
 * Earn the bounty if the rules allow. Writes the frozen fee agreement, the
 * `earned` ledger row and a lead event, then emails the referrer. Returns the
 * decision; a skip is recorded as a `bounty_skipped` lead event.
 */
async function earn(lead: ReferralLead, actor: string): Promise<BountyDecision> {
  const supabase = getSupabaseAdmin();
  const decision = await previewBounty(lead);
  if (!decision.earn) {
    if (decision.code !== 'already_earned' && decision.code !== 'organic') {
      await leadEvent(lead.id, 'bounty_skipped', { code: decision.code, reason: decision.reason }, actor);
    }
    return decision;
  }

  const { data: terms } = await supabase
    .from('referral_partner_terms')
    .select('bounty_mode, bounty_amount, bounty_trigger')
    .eq('partner_id', lead.partner_id!)
    .eq('fee_kind', 'one_time_bounty')
    .maybeSingle();
  const { error: agErr } = await supabase.from('referral_fee_agreement').insert({
    lead_id: lead.id,
    partner_id: lead.partner_id,
    fee_kind: 'one_time_bounty',
    bounty_mode: terms?.bounty_mode ?? decision.mode,
    bounty_amount: terms?.bounty_amount ?? null,
    bounty_trigger: terms?.bounty_trigger ?? 'agreement_signed',
  });
  if (agErr && !isUniqueViolation(agErr)) throw new Error(`fee agreement: ${agErr.message}`);

  const reason =
    decision.mode === 'per_door'
      ? `One-time bounty: $${terms?.bounty_amount} per door × ${lead.doors_under_mgmt} doors, on agreement signed`
      : `One-time bounty: $${terms?.bounty_amount} fixed, on agreement signed`;
  const { error } = await supabase.from('referral_ledger').insert({
    partner_id: lead.partner_id,
    lead_id: lead.id,
    entry_type: 'earned',
    amount: decision.amount,
    reason,
    actor,
  });
  if (isUniqueViolation(error)) return { earn: false, code: 'already_earned', reason: 'A bounty was already earned for this lead.' };
  if (error) throw new Error(`ledger earned: ${error.message}`);

  await leadEvent(lead.id, 'bounty_earned', { amount: decision.amount, mode: decision.mode }, actor);
  await logAudit('referral_lead', lead.id, 'bounty_earned', actor, { amount: decision.amount, mode: decision.mode });
  await notifyAccrual({ id: lead.id, prospect_name: lead.prospect_name, partner_id: lead.partner_id! }, decision.amount);
  return decision;
}

/** Hook for setLeadStage: earn on the first move into agreement_signed. Never throws. */
export async function accrueBountyOnSigning(lead: ReferralLead, previousStage: string | null, actor: string): Promise<void> {
  if (lead.stage !== 'agreement_signed' || previousStage === 'agreement_signed') return;
  try {
    await earn(lead, actor);
  } catch (err) {
    console.error('[referrals] bounty accrual failed:', err instanceof Error ? err.message : err);
    await leadEvent(lead.id, 'bounty_error', { error: err instanceof Error ? err.message : String(err) }, actor);
  }
}

/** Admin "Earn bounty": for a signed lead that was skipped (e.g. per-door before doors were linked). */
export async function earnBountyNow(leadId: string, actor: string): Promise<BountyDecision> {
  const lead = await loadLead(leadId);
  if (!SIGNED_OR_LATER.has(lead.stage)) throw new BountyActionError('The lead must be at agreement signed or later.');
  const decision = await earn(lead, actor);
  if (!decision.earn) throw new BountyActionError(decision.reason);
  return decision;
}

export async function approveBounty(leadId: string, actor: string): Promise<void> {
  if (isAgentActor(actor)) throw new BountyActionError('Bounties must be approved by a person.', 400);
  const entries = await getLeadLedger(leadId);
  if (!nextActions(entries).approve) throw new BountyActionError('This bounty is not waiting for approval.');
  const lead = await loadLead(leadId);
  const amount = payableAmount(entries);
  const { error } = await getSupabaseAdmin().from('referral_ledger').insert({
    partner_id: lead.partner_id,
    lead_id: leadId,
    entry_type: 'approved',
    amount,
    reason: 'Approved for payment',
    actor,
  });
  if (isUniqueViolation(error)) return;
  if (error) throw new Error(`ledger approved: ${error.message}`);
  await leadEvent(leadId, 'bounty_approved', { amount }, actor);
  await logAudit('referral_lead', leadId, 'bounty_approved', actor, { amount });
}

export async function markBountyPaid(leadId: string, actor: string, reference: string): Promise<void> {
  if (isAgentActor(actor)) throw new BountyActionError('Payments must be recorded by a person.', 400);
  const ref = reference.trim().slice(0, 120);
  if (!ref) throw new BountyActionError('Enter a payment reference (check number, QuickBooks ref, …).', 400);
  const entries = await getLeadLedger(leadId);
  if (!nextActions(entries).markPaid) throw new BountyActionError('Approve the bounty before marking it paid.');
  const lead = await loadLead(leadId);
  const amount = payableAmount(entries);
  const { error } = await getSupabaseAdmin().from('referral_ledger').insert({
    partner_id: lead.partner_id,
    lead_id: leadId,
    entry_type: 'paid',
    amount,
    reason: 'Paid',
    qbo_reference: ref,
    actor,
  });
  if (isUniqueViolation(error)) return;
  if (error) throw new Error(`ledger paid: ${error.message}`);
  await leadEvent(leadId, 'bounty_paid', { amount, reference: ref }, actor);
  await logAudit('referral_lead', leadId, 'bounty_paid', actor, { amount, reference: ref });
  await notifyPayout({ id: leadId, prospect_name: lead.prospect_name, partner_id: lead.partner_id! }, amount, ref);
}

export async function voidBounty(leadId: string, actor: string, reason: string): Promise<void> {
  if (isAgentActor(actor)) throw new BountyActionError('Bounties must be voided by a person.', 400);
  const why = reason.trim().slice(0, 500);
  if (!why) throw new BountyActionError('Give a reason for voiding the bounty.', 400);
  const entries = await getLeadLedger(leadId);
  if (!nextActions(entries).void) throw new BountyActionError('Only an unpaid bounty can be voided.');
  const lead = await loadLead(leadId);
  const amount = payableAmount(entries);
  const { error } = await getSupabaseAdmin().from('referral_ledger').insert({
    partner_id: lead.partner_id,
    lead_id: leadId,
    entry_type: 'voided',
    amount: -amount,
    reason: why,
    actor,
  });
  if (isUniqueViolation(error)) return;
  if (error) throw new Error(`ledger voided: ${error.message}`);
  await leadEvent(leadId, 'bounty_voided', { amount, reason: why }, actor);
  await logAudit('referral_lead', leadId, 'bounty_voided', actor, { amount, reason: why });
}

/** Every ledger row (admin hub totals). */
export async function getAllLedger(): Promise<LedgerEntry[]> {
  const { data, error } = await getSupabaseAdmin().from('referral_ledger').select('entry_type, amount, lead_id, partner_id');
  if (error) return [];
  return (data ?? []) as LedgerEntry[];
}
