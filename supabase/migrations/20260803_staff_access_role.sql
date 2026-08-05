-- ============================================
-- HDPM-OS Phase 0, Brief A: DB-backed access roles
-- Date: 2026-08-03
-- Run this migration manually in the Supabase SQL Editor.
--
-- Adds staff.access_role — the authorization role (who can do what in the
-- app). Deliberately separate from the existing staff.role column, which
-- holds the human job title ("Ops & Maintenance Coordinator") and is used
-- for display/routing, not authorization.
--
-- Seeds admin from the current ADMIN_EMAILS env allowlist (craig@). After
-- this migration + deploy, admin changes are a staff row update — no
-- redeploy. The env allowlist remains only as a bootstrap fallback (used
-- when the table has no active admin, e.g. disaster recovery) and its use
-- is logged.
--
-- RLS: staff already has RLS enabled with the service-role policy
-- (20260719_staff.sql) — no change needed here.
-- ============================================

ALTER TABLE staff ADD COLUMN IF NOT EXISTS access_role TEXT NOT NULL DEFAULT 'staff';

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_access_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_access_role_check CHECK (
  access_role IN (
    'admin', 'manager', 'pm', 'maintenance', 'finance',
    'front_desk', 'inspector', 'field', 'staff', 'read_only'
  )
);

-- Seed: mirror the current ADMIN_EMAILS env allowlist.
UPDATE staff SET access_role = 'admin', updated_at = now()
WHERE lower(email) IN ('craig@highdesertpm.com');

-- Fast lookup by email (role resolution path).
CREATE INDEX IF NOT EXISTS idx_staff_email_lower ON staff (lower(email)) WHERE email IS NOT NULL;
