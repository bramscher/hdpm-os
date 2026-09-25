-- User settings: per-person section access (Admin → User settings → Sections).
-- Overrides are { "<section_key>": true|false } on top of role defaults
-- declared in lib/access/sections.ts. Missing key = role default.
-- Safe to replay. Mirrors staff_capability_policy / _audit.
CREATE TABLE IF NOT EXISTS staff_section_access (
  org_id text NOT NULL DEFAULT 'hdpm',
  person text PRIMARY KEY REFERENCES staff(person),
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_section_access_audit (
  org_id text NOT NULL DEFAULT 'hdpm',
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person text NOT NULL REFERENCES staff(person),
  actor text NOT NULL,
  before_overrides jsonb NOT NULL,
  after_overrides jsonb NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE staff_section_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_section_access_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to staff_section_access" ON staff_section_access;
CREATE POLICY "Service role full access to staff_section_access" ON staff_section_access
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access to staff_section_access_audit" ON staff_section_access_audit;
CREATE POLICY "Service role full access to staff_section_access_audit" ON staff_section_access_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON staff_section_access, staff_section_access_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON staff_section_access, staff_section_access_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE staff_section_access_audit_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
