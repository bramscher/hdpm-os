-- ============================================
-- Knowledge capture: whose knowledge is in each recording
-- Date: 2026-10-16
-- Run this migration manually in the Supabase SQL Editor.
--
-- voices = emails of the people talking (Matt, Penny, or both together),
-- separate from speaker_email (who pressed record; edit/delete permission).
-- Existing rows are backfilled with their recorder.
-- ============================================

ALTER TABLE kc_recording ADD COLUMN IF NOT EXISTS voices TEXT[];

UPDATE kc_recording SET voices = ARRAY[lower(speaker_email)] WHERE voices IS NULL;
