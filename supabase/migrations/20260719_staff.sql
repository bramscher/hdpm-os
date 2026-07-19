-- ============================================
-- Agent-OS Brief B: staff — the identity map
-- Date: 2026-07-19
-- Run this migration manually in the Supabase SQL Editor.
--
-- Single source for staff → contact identity so channel events (Slack taps,
-- SMS replies) resolve to a human actor for wo_event audit attribution.
-- Seeds all 11 real staff (roles per the Notion "Roles and Responsibilities"
-- doc, 2026-07-09) — the hardcoded 7-person PEOPLE const in
-- lib/maintenance/types.ts stays untouched (it types maintenance owner
-- routing). Contact fields are NULL until filled in by Craig.
-- maint_digest_recipient is deliberately untouched (digests read it);
-- consolidating it into this table is a later chore.
-- ============================================

CREATE TABLE IF NOT EXISTS staff (
  person TEXT PRIMARY KEY,             -- short name used across the app
  name TEXT,                           -- full display name
  email TEXT,
  phone TEXT,                          -- E.164 preferred
  slack_user_id TEXT,
  role TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_slack
  ON staff (slack_user_id) WHERE slack_user_id IS NOT NULL;

INSERT INTO staff (person, name, role) VALUES
  ('Cheryl',  'Cheryl Waterman',  'Ops & Maintenance Coordinator'),
  ('Brody',   'Brody Bramscher',  'Property Inspector'),
  ('Alberto', 'Alberto Flores',   'Maintenance Lead Tech'),
  ('Bryce',   'Bryce Bramscher',  'CCB License Holder'),
  ('Penny',   'Penny Free',       'Sr Finance, Process Oversight'),
  ('Jen',     'Jennifer Bertran', 'Senior Property Manager'),
  ('Craig',   'Craig Bramscher',  'CEO / Owner'),
  ('Matt',    'Matt Free',        'Executive Property Manager'),
  ('Ashley',  'Ashley Bessey',    'Front Desk'),
  ('Bianca',  'Bianca Nyseth',    'Assistant Property Manager'),
  ('Kennedy', 'Kennedy James',    'Assistant Property Manager')
ON CONFLICT (person) DO NOTHING;

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to staff" ON staff;
CREATE POLICY "Service role full access to staff" ON staff
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON staff TO service_role;

NOTIFY pgrst, 'reload schema';
