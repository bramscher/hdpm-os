-- ============================================
-- Knowledge capture: Matt & Penny's owner/property knowledge → the brain
-- Date: 2026-10-14
-- Run this migration manually in the Supabase SQL Editor.
--
-- Matt and Penny record audio about each AppFolio owner and property as they
-- transition out. Each recording is stored privately, transcribed, distilled
-- into structured notes, and ingested into the company brain (brain_chunk,
-- keyed 'kc:rec:<id>#<n>'). Per subject, all notes roll up into a living
-- profile (kc_profile + the subject's brain_node summary).
-- ============================================

CREATE TABLE IF NOT EXISTS kc_recording (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  subject_type TEXT NOT NULL CHECK (subject_type IN ('owner','property')),
  subject_id TEXT NOT NULL,                 -- AppFolio v0 owner / property id
  subject_name TEXT NOT NULL,
  speaker_email TEXT NOT NULL,
  speaker_name TEXT,
  storage_path TEXT NOT NULL,               -- knowledge-capture bucket
  mime_type TEXT NOT NULL,
  size_bytes BIGINT,
  duration_sec INT,
  status TEXT NOT NULL DEFAULT 'pending_upload' CHECK (status IN (
    'pending_upload','uploaded','processing','done','error'
  )),
  error TEXT,
  transcript TEXT,
  transcript_model TEXT,
  notes_md TEXT,                            -- structured notes distilled from the transcript
  chunk_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kc_recording_subject
  ON kc_recording (org_id, subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kc_profile (
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  subject_type TEXT NOT NULL CHECK (subject_type IN ('owner','property')),
  subject_id TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  profile_md TEXT NOT NULL,
  recording_count INT NOT NULL DEFAULT 0,
  model TEXT,
  brain_node_id UUID REFERENCES brain_node(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, subject_type, subject_id)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['kc_recording','kc_profile']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access to %s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "Service role full access to %s" ON %I FOR ALL USING (true) WITH CHECK (true)',
      t, t);
  END LOOP;
END $$;

-- Private audio bucket. Browsers upload via short-lived signed upload URLs
-- minted by the API; playback via signed URLs. No public access.
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-capture', 'knowledge-capture', false)
ON CONFLICT (id) DO NOTHING;

-- Transcript corrections: the first machine transcript is kept for reference;
-- notes, brain chunks and the profile are rebuilt from the edited text.
ALTER TABLE kc_recording ADD COLUMN IF NOT EXISTS transcript_original TEXT;
ALTER TABLE kc_recording ADD COLUMN IF NOT EXISTS transcript_edited_at TIMESTAMPTZ;
ALTER TABLE kc_recording ADD COLUMN IF NOT EXISTS transcript_edited_by TEXT;
