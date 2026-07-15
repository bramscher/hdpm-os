-- Migration: allow capturing a payment without an amount yet
-- Date: 2026-07-15
-- Description:
--   Let a payment be captured by date first and have its amount filled in later
--   (e.g. when the bank/trust figure isn't in hand yet). amount becomes nullable;
--   a null amount just means "not set yet" and the variance stays blank until it's
--   entered.

ALTER TABLE hdms_payments ALTER COLUMN amount DROP NOT NULL;
