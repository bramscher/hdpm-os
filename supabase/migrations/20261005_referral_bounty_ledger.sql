-- Referral partner portal, Batch 5: one-time bounty ledger.
-- Additive and idempotent; apply in the Supabase SQL Editor.
--
-- referral_ledger already exists (20260828_referrals_core.sql) with an
-- append-only trigger. This adds what the bounty flow relies on:
--   * entry_type is constrained to the five documented values;
--   * each lead can be earned, approved and paid at most once, so a retry or a
--     double-click can never double-pay (the app treats a unique conflict as
--     "already done");
--   * one frozen fee agreement per lead and fee kind.

BEGIN;

ALTER TABLE referral_ledger DROP CONSTRAINT IF EXISTS referral_ledger_entry_type_check;
ALTER TABLE referral_ledger ADD CONSTRAINT referral_ledger_entry_type_check
  CHECK (entry_type IN ('earned', 'adjusted', 'approved', 'paid', 'voided'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_ledger_lead_earned
  ON referral_ledger(lead_id) WHERE entry_type = 'earned';
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_ledger_lead_approved
  ON referral_ledger(lead_id) WHERE entry_type = 'approved';
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_ledger_lead_paid
  ON referral_ledger(lead_id) WHERE entry_type = 'paid';
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_ledger_lead_voided
  ON referral_ledger(lead_id) WHERE entry_type = 'voided';

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_fee_agreement_lead_kind
  ON referral_fee_agreement(lead_id, fee_kind);

COMMIT;

NOTIFY pgrst, 'reload schema';
