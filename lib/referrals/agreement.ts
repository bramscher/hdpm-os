/**
 * Referral agreement text + versioning (Batch 2).
 *
 * The simplest defensible e-sign (plan § referrer side): a checkbox
 * acknowledgment of a versioned agreement, with the exact text hashed and the
 * acceptance timestamp/IP recorded. If the text changes, bump AGREEMENT_VERSION
 * so past acceptances remain attributable to what was actually agreed.
 *
 * ⚠️ PLACEHOLDER TEXT — HDPM's attorney must review/replace before go-live.
 * Compensation eligibility itself is enforced separately by referral_fee_policy.
 */

import { createHash } from 'crypto';

export const AGREEMENT_VERSION = '2026-08-v1-DRAFT';

export const AGREEMENT_TEXT = `HIGH DESERT PROPERTY MANAGEMENT — REFERRAL PARTNER AGREEMENT (DRAFT)

1. Referrals. You may refer prospective property owners to High Desert Property
   Management ("HDPM"). Each referral is submitted through this portal and tracked
   under your unique referral code.

2. Compensation. Any referral fee is governed by the fee terms HDPM sets for your
   partner type and is payable only where permitted by Oregon law. Some referrer
   types are not eligible for certain fees; HDPM determines eligibility and may
   decline to pay where prohibited. No fee is earned until the conditions in your
   fee terms are met (e.g., a signed management agreement).

3. First-touch attribution. Where two referrers submit the same prospect, the
   first submission of record prevails. HDPM resolves disputes in good faith.

4. Independent parties. You are an independent referral source, not an employee,
   agent, or partner of HDPM, and you will not represent otherwise.

5. Tax reporting. You will provide a completed Form W-9. HDPM will report
   compensation as required (Form 1099-NEC).

6. Term. Either party may end this arrangement at any time. Fees already earned
   under signed agreements survive termination per their terms.

By checking the acknowledgment box you agree to the terms above.`;

export function agreementSha256(text: string = AGREEMENT_TEXT): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
