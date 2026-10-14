-- ============================================
-- Knowledge Capture quick capture: takes with no owner or property yet
-- Date: 2026-10-25
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- A quick-capture take uploads and transcribes untagged (subject NULL) and
-- waits in the Inbox until someone tags it with an owner or property. Only
-- then can it be reviewed and added to the brain.
-- ============================================

ALTER TABLE kc_recording ALTER COLUMN subject_type DROP NOT NULL;
ALTER TABLE kc_recording ALTER COLUMN subject_id DROP NOT NULL;
ALTER TABLE kc_recording ALTER COLUMN subject_name DROP NOT NULL;

-- Tagged means both type and id; untagged means neither.
ALTER TABLE kc_recording DROP CONSTRAINT IF EXISTS kc_recording_subject_tagged;
ALTER TABLE kc_recording ADD CONSTRAINT kc_recording_subject_tagged CHECK ((subject_type IS NULL) = (subject_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_kc_recording_inbox ON kc_recording (org_id, created_at DESC) WHERE subject_type IS NULL;

NOTIFY pgrst, 'reload schema';
