-- ============================================
-- Knowledge Capture: archive takes instead of deleting them
-- Date: 2026-10-27
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- "Delete" on a take now archives it: its brain chunks go and the profile is
-- rebuilt without it, but the audio, raw transcript and any edited original
-- stay so the take can be revisited, split or turned into AppFolio notes.
-- ============================================

ALTER TABLE kc_recording ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE kc_recording ADD COLUMN IF NOT EXISTS archived_by TEXT;

CREATE INDEX IF NOT EXISTS idx_kc_recording_archived ON kc_recording (org_id, archived_at DESC) WHERE archived_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
