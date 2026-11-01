-- Review requests: one row per Google-review ask to a tenant or owner.
-- The daily cron (/api/reviews/cron/daily) proposes rows from AppFolio and
-- DMs Craig a batch card; Send/Skip taps (Slack rr:*) move them on. Every
-- email gets the same Google review link (no gating on sentiment).
-- One row per (reason, contact, subject) so a missed or re-run day never
-- asks twice for the same repair, move-in, renewal or new property.

CREATE TABLE IF NOT EXISTS review_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  audience TEXT NOT NULL CHECK (audience IN ('tenant', 'owner')),
  reason TEXT NOT NULL CHECK (reason IN ('repair', 'move_in', 'renewal', 'owner_90d')),
  appfolio_contact_id TEXT NOT NULL,
  name TEXT NOT NULL,
  first_name TEXT,
  email TEXT NOT NULL,
  property TEXT,
  detail TEXT,
  subject_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'sending', 'sent', 'skipped', 'failed', 'expired')),
  batch_date DATE NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reason, appfolio_contact_id, subject_ref)
);

CREATE INDEX IF NOT EXISTS review_request_email_idx ON review_request (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS review_request_status_idx ON review_request (status, batch_date);

ALTER TABLE review_request ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to review_request" ON review_request;
CREATE POLICY "Service role full access to review_request" ON review_request
  FOR ALL TO service_role USING (true) WITH CHECK (true);
