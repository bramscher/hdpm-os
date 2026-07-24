-- ============================================
-- Craigslist listing lifecycle: publish + renewals
-- Date: 2026-07-24
-- Run this migration manually in the Supabase SQL Editor.
--
-- saved_listings only stored generated copy (history). This adds the posting
-- lifecycle: staff mark a listing POSTED with the live Craigslist URL, log
-- 48-hour renewals, and archive when the unit leases or the post comes down.
-- Craigslist mechanics: renewable every 48h, post expires ~30 days after
-- posting — the UI derives "renew due" / "expiring" / "expired" from
-- posted_at + last_renewed_at rather than storing them.
-- ============================================

ALTER TABLE saved_listings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',  -- draft | posted | archived
  ADD COLUMN IF NOT EXISTS craigslist_url text,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by text,
  ADD COLUMN IF NOT EXISTS last_renewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE INDEX IF NOT EXISTS idx_saved_listings_status ON saved_listings(status);

NOTIFY pgrst, 'reload schema';
