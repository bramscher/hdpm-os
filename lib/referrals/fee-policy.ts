/**
 * Fee-policy eligibility gate (Batch 1) — the pure decision layer.
 *
 * Oregon law restricts paying compensation to unlicensed persons for real
 * estate activity. The plan makes eligibility a DATA switch, not code:
 * referral_fee_policy.allowed per (partner_type, fee_kind), seeded false, only
 * flipped true after attorney sign-off. This module answers "may this referrer
 * be given this kind of fee?" from policy rows — no hardcoded rules.
 *
 * Kept pure (no DB) so the gate is unit-testable; the DB read + write live in
 * lib/referrals/admin.ts.
 */

import type { FeeKind, FeePolicyRow, PartnerType } from './types';

/** The active policy for a (type, kind), or null if none/expired. `today` ISO date. */
export function activePolicy(
  policies: FeePolicyRow[],
  partnerType: PartnerType,
  feeKind: FeeKind,
  today: string
): FeePolicyRow | null {
  const matches = policies.filter(
    (p) =>
      p.partner_type === partnerType &&
      p.fee_kind === feeKind &&
      p.effective_from <= today &&
      (p.effective_to == null || p.effective_to >= today)
  );
  if (matches.length === 0) return null;
  // Most recently effective wins.
  matches.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return matches[0];
}

export function isFeeAllowed(
  policies: FeePolicyRow[],
  partnerType: PartnerType,
  feeKind: FeeKind,
  today: string
): boolean {
  return activePolicy(policies, partnerType, feeKind, today)?.allowed === true;
}

export class FeeNotAllowedError extends Error {
  constructor(
    public readonly partnerType: PartnerType,
    public readonly feeKind: FeeKind
  ) {
    super(
      `Fee kind "${feeKind}" is not permitted for referrer type "${partnerType}". ` +
        `This is a compensation-eligibility policy (referral_fee_policy.allowed), ` +
        `flipped on only after Oregon legal sign-off — it is not a bug. ` +
        `Enable it on the Fee Policy admin page once counsel confirms.`
    );
    this.name = 'FeeNotAllowedError';
  }
}

/** Throws FeeNotAllowedError when the combination is disallowed. */
export function assertFeeAllowed(
  policies: FeePolicyRow[],
  partnerType: PartnerType,
  feeKind: FeeKind,
  today: string
): void {
  if (!isFeeAllowed(policies, partnerType, feeKind, today)) {
    throw new FeeNotAllowedError(partnerType, feeKind);
  }
}
