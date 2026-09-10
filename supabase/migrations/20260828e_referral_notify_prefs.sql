-- ============================================
-- Referral Partner Portal — Batch 4: notification preference
-- Plan: docs/partners/00-referral-portal-plan.md §5 (Batch 4), §Notifications
--
-- Referrer emails are OPT-OUTABLE ("optional email notification on status change
-- and payout"). Default on. referral_notification_log already exists (Batch 0)
-- and records every send/skip/failure.
--
-- Convention: applied manually in the Supabase SQL Editor; idempotent.
-- ============================================

ALTER TABLE referral_partner
  ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT true;
