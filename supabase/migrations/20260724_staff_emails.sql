-- ============================================
-- Staff email backfill
-- Date: 2026-07-24
-- Run this migration manually in the Supabase SQL Editor.
--
-- Company convention: firstname@highdesertpm.com. The `person` column already
-- holds the short name used in the address (e.g. 'Jen' for Jennifer Bertran →
-- jen@highdesertpm.com), so lower(person) is the exact local part for all 11.
-- WHERE email IS NULL so any address filled in by hand is never clobbered.
-- Unblocks the /api/staff-backed inspector picker (StaffSelect) showing the
-- full roster instead of its 3-person fallback.
-- ============================================

UPDATE staff
SET email = lower(person) || '@highdesertpm.com',
    updated_at = now()
WHERE email IS NULL;
