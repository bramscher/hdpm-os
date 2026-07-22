-- ============================================
-- Key Manager: AppFolio "Keys Detail" checkout snapshot
-- ============================================
-- AppFolio's key checkout data (who has a key, when it was checked out) lives
-- only in the web-app "Keys Detail" report — no v0 API resource exists (all
-- /keys-ish endpoints 404, verified 2026-07-22). Staff export that report as
-- CSV and reconcile it in at /keys; each reconcile REPLACES this table (it is
-- a snapshot of AppFolio's current state, keyed by appfolio_unit_id). When the
-- Reports API credential lands, the same table gets fed by an API pull instead.

CREATE TABLE IF NOT EXISTS key_af_checkout (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appfolio_unit_id    TEXT NOT NULL,
  key_name            TEXT,          -- report "Key Name" (AppFolio's key label)
  description         TEXT,          -- e.g. "Front Door", "Garage Remote"
  assignee            TEXT NOT NULL, -- who the key is checked out to
  assignee_type       TEXT,          -- Tenant | Owner | Vendor
  number_checked_out  INTEGER,
  checked_out_date    DATE,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_key_af_checkout_unit ON key_af_checkout (appfolio_unit_id);

ALTER TABLE key_af_checkout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to key_af_checkout" ON key_af_checkout;
CREATE POLICY "Service role full access to key_af_checkout" ON key_af_checkout FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON key_af_checkout TO service_role;

NOTIFY pgrst, 'reload schema';
