/**
 * One-time bounty (Batch 5) — the pure decision and ledger arithmetic.
 *
 * A bounty is earned once, when a referred lead first reaches agreement_signed,
 * and only if the referrer has active one_time_bounty terms AND the fee policy
 * for their type allows it today (the Oregon attorney gate). Status then moves
 * by appending ledger rows: earned → approved (human) → paid; voided only
 * before payment. No DB here, so every rule is unit-tested; the writes live in
 * lib/referrals/ledger.ts.
 */

import { isFeeAllowed } from './fee-policy';
import type { FeePolicyRow, LedgerEntry, PartnerTermsRow, PartnerType, ReferralLead } from './types';

export type BountyDecision =
  | { earn: true; amount: number; mode: 'fixed' | 'per_door' }
  | { earn: false; reason: string; code: BountySkipCode };

export type BountySkipCode =
  | 'organic'
  | 'partner_inactive'
  | 'duplicate'
  | 'already_earned'
  | 'no_terms'
  | 'not_allowed'
  | 'needs_doors'
  | 'bad_terms';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function bountyDecision(input: {
  lead: Pick<ReferralLead, 'partner_id' | 'source' | 'dup_status' | 'doors_under_mgmt'>;
  partnerType: PartnerType | null;
  /** referral_partner.status; only active referrers earn. */
  partnerStatus?: string | null;
  terms: Pick<PartnerTermsRow, 'fee_kind' | 'active' | 'bounty_mode' | 'bounty_amount' | 'bounty_trigger'> | null;
  policies: FeePolicyRow[];
  alreadyEarned: boolean;
  today: string;
}): BountyDecision {
  const { lead, partnerType, partnerStatus, terms, policies, alreadyEarned, today } = input;
  if (!lead.partner_id || lead.source !== 'referral' || !partnerType) {
    return { earn: false, code: 'organic', reason: 'Not a referral lead (no referrer attached).' };
  }
  if (partnerStatus && partnerStatus !== 'active') {
    return { earn: false, code: 'partner_inactive', reason: `Referrer is ${partnerStatus}, not active.` };
  }
  if (alreadyEarned) return { earn: false, code: 'already_earned', reason: 'A bounty was already earned for this lead.' };
  if (lead.dup_status === 'suspected' || lead.dup_status === 'confirmed') {
    return { earn: false, code: 'duplicate', reason: `Lead is flagged as a ${lead.dup_status} duplicate; resolve it first.` };
  }
  if (!terms || !terms.active || terms.fee_kind !== 'one_time_bounty') {
    return { earn: false, code: 'no_terms', reason: 'Referrer has no active one-time bounty terms.' };
  }
  if (!isFeeAllowed(policies, partnerType, 'one_time_bounty', today)) {
    return { earn: false, code: 'not_allowed', reason: `One-time bounties are not allowed for ${partnerType} referrers (fee policy).` };
  }
  if (terms.bounty_trigger && terms.bounty_trigger !== 'agreement_signed') {
    return { earn: false, code: 'bad_terms', reason: `Bounty trigger "${terms.bounty_trigger}" is not supported yet.` };
  }
  const base = Number(terms.bounty_amount);
  if (!Number.isFinite(base) || base <= 0) {
    return { earn: false, code: 'bad_terms', reason: 'Bounty amount is missing or not positive.' };
  }
  if (terms.bounty_mode === 'per_door') {
    const doors = lead.doors_under_mgmt ?? 0;
    if (doors <= 0) {
      return { earn: false, code: 'needs_doors', reason: 'Per-door bounty: link the AppFolio doors under management, then earn it.' };
    }
    return { earn: true, amount: round2(base * doors), mode: 'per_door' };
  }
  if (terms.bounty_mode && terms.bounty_mode !== 'fixed') {
    return { earn: false, code: 'bad_terms', reason: `Unknown bounty mode "${terms.bounty_mode}".` };
  }
  return { earn: true, amount: round2(base), mode: 'fixed' };
}

export type BountyStatus = 'none' | 'pending_approval' | 'approved' | 'paid' | 'voided';

export interface LedgerSummary {
  /** Net earned: earned + adjusted + voided (voids are negative). */
  earned: number;
  pendingApproval: number;
  approvedUnpaid: number;
  paid: number;
}

type Entry = Pick<LedgerEntry, 'entry_type' | 'amount'>;

export function summarizeLedger(entries: Entry[]): LedgerSummary {
  let earned = 0;
  let approved = 0;
  let paid = 0;
  for (const e of entries) {
    const amt = Number(e.amount) || 0;
    if (e.entry_type === 'earned' || e.entry_type === 'adjusted' || e.entry_type === 'voided') earned += amt;
    else if (e.entry_type === 'approved') approved += amt;
    else if (e.entry_type === 'paid') paid += amt;
  }
  return {
    earned: round2(earned),
    pendingApproval: round2(Math.max(0, earned - approved)),
    approvedUnpaid: round2(Math.max(0, approved - paid)),
    paid: round2(paid),
  };
}

/** Status of one lead's bounty from its ledger rows. */
export function bountyStatus(entries: Entry[]): BountyStatus {
  const has = (t: LedgerEntry['entry_type']) => entries.some((e) => e.entry_type === t);
  if (!has('earned')) return 'none';
  if (has('paid')) return 'paid';
  if (has('voided')) return 'voided';
  if (has('approved')) return 'approved';
  return 'pending_approval';
}

export interface BountyActions {
  approve: boolean;
  markPaid: boolean;
  void: boolean;
}

/** Which admin buttons are valid for one lead's bounty. */
export function nextActions(entries: Entry[]): BountyActions {
  const status = bountyStatus(entries);
  return {
    approve: status === 'pending_approval',
    markPaid: status === 'approved',
    void: status === 'pending_approval' || status === 'approved',
  };
}

/** The amount an approve / paid row should carry: the lead's current net earned. */
export function payableAmount(entries: Entry[]): number {
  return summarizeLedger(entries).earned;
}

export const BOUNTY_STATUS_LABEL: Record<BountyStatus, string> = {
  none: 'No bounty',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  paid: 'Paid',
  voided: 'Voided',
};
