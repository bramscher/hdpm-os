-- ============================================
-- @habu/core 0003 — staff: the identity map
-- Ported from hdpm-os 20260719_staff.sql + 20260803_staff_access_role.sql,
-- MINUS the HDPM staff roster (staff is tenant data; each org seeds its own).
--
-- Single source for staff → contact identity so channel events (Slack taps,
-- SMS replies) resolve to a human actor for audit attribution.
--   role        = human job title (display/routing)
--   access_role = authorization role (who can do what) — deliberately separate
-- ============================================

CREATE TABLE IF NOT EXISTS staff (
  person TEXT PRIMARY KEY,             -- short name / stable key used across the app
  name TEXT,                           -- full display name
  email TEXT,
  phone TEXT,                          -- E.164 preferred
  slack_user_id TEXT,
  role TEXT,                           -- job title, e.g. 'Maintenance Coordinator'
  access_role TEXT NOT NULL DEFAULT 'staff',
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_access_role_check CHECK (
    access_role IN (
      'admin', 'manager', 'pm', 'maintenance', 'finance',
      'front_desk', 'inspector', 'field', 'staff', 'read_only'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_slack
  ON staff (slack_user_id) WHERE slack_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_email_lower
  ON staff (lower(email)) WHERE email IS NOT NULL;

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to staff" ON staff;
CREATE POLICY "Service role full access to staff" ON staff
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON staff TO service_role;

NOTIFY pgrst, 'reload schema';
