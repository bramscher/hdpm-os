import { describe, it, expect } from 'vitest';
import { activePolicy, isFeeAllowed, assertFeeAllowed, FeeNotAllowedError } from '../fee-policy';
import type { FeePolicyRow } from '../types';

function policy(p: Partial<FeePolicyRow>): FeePolicyRow {
  return {
    id: p.id ?? 'x',
    org_id: 'hdpm',
    partner_type: p.partner_type ?? 'owner',
    fee_kind: p.fee_kind ?? 'one_time_bounty',
    allowed: p.allowed ?? false,
    bounty_mode: null,
    bounty_amount: null,
    bounty_trigger: null,
    trailing_pct: null,
    trailing_months: null,
    effective_from: p.effective_from ?? '2026-01-01',
    effective_to: p.effective_to ?? null,
  };
}

const TODAY = '2026-08-28';

describe('fee-policy eligibility gate', () => {
  it('blocks a disallowed combination (the seeded default)', () => {
    const rows = [policy({ partner_type: 'owner', fee_kind: 'one_time_bounty', allowed: false })];
    expect(isFeeAllowed(rows, 'owner', 'one_time_bounty', TODAY)).toBe(false);
    expect(() => assertFeeAllowed(rows, 'owner', 'one_time_bounty', TODAY)).toThrow(FeeNotAllowedError);
  });

  it('allows once the switch is flipped on', () => {
    const rows = [policy({ partner_type: 'agent', fee_kind: 'trailing', allowed: true })];
    expect(isFeeAllowed(rows, 'agent', 'trailing', TODAY)).toBe(true);
    expect(() => assertFeeAllowed(rows, 'agent', 'trailing', TODAY)).not.toThrow();
  });

  it('treats a missing policy row as not allowed', () => {
    expect(isFeeAllowed([], 'vendor', 'trailing', TODAY)).toBe(false);
  });

  it('ignores an expired policy window', () => {
    const rows = [policy({ partner_type: 'owner', fee_kind: 'trailing', allowed: true, effective_to: '2026-06-30' })];
    expect(activePolicy(rows, 'owner', 'trailing', TODAY)).toBeNull();
    expect(isFeeAllowed(rows, 'owner', 'trailing', TODAY)).toBe(false);
  });

  it('picks the most recently effective policy', () => {
    const rows = [
      policy({ id: 'old', partner_type: 'owner', fee_kind: 'one_time_bounty', allowed: false, effective_from: '2026-01-01' }),
      policy({ id: 'new', partner_type: 'owner', fee_kind: 'one_time_bounty', allowed: true, effective_from: '2026-07-01' }),
    ];
    expect(activePolicy(rows, 'owner', 'one_time_bounty', TODAY)?.id).toBe('new');
    expect(isFeeAllowed(rows, 'owner', 'one_time_bounty', TODAY)).toBe(true);
  });

  it('does not leak eligibility across type or kind', () => {
    const rows = [policy({ partner_type: 'agent', fee_kind: 'trailing', allowed: true })];
    expect(isFeeAllowed(rows, 'owner', 'trailing', TODAY)).toBe(false); // different type
    expect(isFeeAllowed(rows, 'agent', 'one_time_bounty', TODAY)).toBe(false); // different kind
  });
});
