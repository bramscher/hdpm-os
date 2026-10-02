import { describe, it, expect } from 'vitest';
import { bountyDecision, bountyStatus, nextActions, payableAmount, summarizeLedger } from '../bounty';
import type { FeePolicyRow } from '../types';

const TODAY = '2026-10-05';
const policy = (allowed: boolean, partner_type = 'agent'): FeePolicyRow =>
  ({ id: 'p', org_id: 'hdpm', partner_type, fee_kind: 'one_time_bounty', allowed, bounty_mode: null, bounty_amount: null, bounty_trigger: null, trailing_pct: null, trailing_months: null, effective_from: '2026-08-28', effective_to: null }) as FeePolicyRow;
const lead = (over: Record<string, unknown> = {}) => ({ partner_id: 'partner-1', source: 'referral' as const, dup_status: null, doors_under_mgmt: null, ...over });
const terms = (over: Record<string, unknown> = {}) => ({ fee_kind: 'one_time_bounty' as const, active: true, bounty_mode: 'fixed' as const, bounty_amount: 500, bounty_trigger: 'agreement_signed' as const, ...over });
const decide = (o: Partial<Parameters<typeof bountyDecision>[0]> = {}) =>
  bountyDecision({ lead: lead(), partnerType: 'agent', terms: terms(), policies: [policy(true)], alreadyEarned: false, today: TODAY, ...o });

describe('bountyDecision', () => {
  it('earns the fixed amount when everything lines up', () => {
    expect(decide()).toEqual({ earn: true, amount: 500, mode: 'fixed' });
  });

  it('per-door multiplies by doors, and waits for doors', () => {
    expect(decide({ terms: terms({ bounty_mode: 'per_door', bounty_amount: 75 }), lead: lead({ doors_under_mgmt: 4 }) })).toEqual({ earn: true, amount: 300, mode: 'per_door' });
    expect(decide({ terms: terms({ bounty_mode: 'per_door', bounty_amount: 75 }) })).toMatchObject({ earn: false, code: 'needs_doors' });
  });

  it('respects the fee policy switch (Oregon gate)', () => {
    expect(decide({ policies: [policy(false)] })).toMatchObject({ earn: false, code: 'not_allowed' });
    expect(decide({ policies: [] })).toMatchObject({ earn: false, code: 'not_allowed' });
    expect(decide({ policies: [policy(true, 'owner')] })).toMatchObject({ earn: false, code: 'not_allowed' });
  });

  it('skips organic leads, duplicates, missing terms and repeats', () => {
    expect(decide({ lead: lead({ partner_id: null, source: 'organic' }) })).toMatchObject({ code: 'organic' });
    expect(decide({ lead: lead({ dup_status: 'suspected' }) })).toMatchObject({ code: 'duplicate' });
    expect(decide({ lead: lead({ dup_status: 'confirmed' }) })).toMatchObject({ code: 'duplicate' });
    expect(decide({ lead: lead({ dup_status: 'cleared' }) })).toMatchObject({ earn: true });
    expect(decide({ terms: null })).toMatchObject({ code: 'no_terms' });
    expect(decide({ terms: terms({ active: false }) })).toMatchObject({ code: 'no_terms' });
    expect(decide({ alreadyEarned: true })).toMatchObject({ code: 'already_earned' });
    expect(decide({ partnerStatus: 'paused' })).toMatchObject({ code: 'partner_inactive' });
    expect(decide({ partnerStatus: 'active' })).toMatchObject({ earn: true });
  });

  it('rejects unusable terms', () => {
    expect(decide({ terms: terms({ bounty_amount: 0 }) })).toMatchObject({ code: 'bad_terms' });
    expect(decide({ terms: terms({ bounty_trigger: 'first_rent' }) })).toMatchObject({ code: 'bad_terms' });
    expect(decide({ terms: terms({ bounty_mode: 'weird' }) })).toMatchObject({ code: 'bad_terms' });
  });
});

const e = (entry_type: 'earned' | 'adjusted' | 'approved' | 'paid' | 'voided', amount: number) => ({ entry_type, amount });

describe('ledger arithmetic', () => {
  it('walks earned → approved → paid', () => {
    const earned = [e('earned', 500)];
    expect(summarizeLedger(earned)).toEqual({ earned: 500, pendingApproval: 500, approvedUnpaid: 0, paid: 0 });
    expect(bountyStatus(earned)).toBe('pending_approval');
    expect(nextActions(earned)).toEqual({ approve: true, markPaid: false, void: true });

    const approved = [...earned, e('approved', 500)];
    expect(summarizeLedger(approved)).toEqual({ earned: 500, pendingApproval: 0, approvedUnpaid: 500, paid: 0 });
    expect(nextActions(approved)).toEqual({ approve: false, markPaid: true, void: true });

    const paid = [...approved, e('paid', 500)];
    expect(summarizeLedger(paid)).toEqual({ earned: 500, pendingApproval: 0, approvedUnpaid: 0, paid: 500 });
    expect(bountyStatus(paid)).toBe('paid');
    expect(nextActions(paid)).toEqual({ approve: false, markPaid: false, void: false });
  });

  it('a void before approval zeroes it out', () => {
    const v = [e('earned', 500), e('voided', -500)];
    expect(summarizeLedger(v)).toEqual({ earned: 0, pendingApproval: 0, approvedUnpaid: 0, paid: 0 });
    expect(bountyStatus(v)).toBe('voided');
    expect(nextActions(v)).toEqual({ approve: false, markPaid: false, void: false });
  });

  it('adjustments change the payable amount', () => {
    const rows = [e('earned', 500), e('adjusted', -100)];
    expect(payableAmount(rows)).toBe(400);
    expect(summarizeLedger([...rows, e('approved', 400)]).pendingApproval).toBe(0);
  });

  it('sums across many leads for the referrer dashboard', () => {
    const all = [e('earned', 500), e('approved', 500), e('paid', 500), e('earned', 300), e('approved', 300), e('earned', 250)];
    expect(summarizeLedger(all)).toEqual({ earned: 1050, pendingApproval: 250, approvedUnpaid: 300, paid: 500 });
  });

  it('nothing earned means no status', () => {
    expect(bountyStatus([])).toBe('none');
  });
});
