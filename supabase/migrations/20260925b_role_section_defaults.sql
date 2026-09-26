-- User settings → Roles: admin-edited section defaults per access role.
-- Overrides { "<section_key>": true|false } layered over the code defaults
-- in lib/access/sections.ts. Missing key = code default. Safe to replay.
CREATE TABLE IF NOT EXISTS role_section_defaults (
  org_id text NOT NULL DEFAULT 'hdpm',
  role text PRIMARY KEY,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS role_section_defaults_audit (
  org_id text NOT NULL DEFAULT 'hdpm',
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role text NOT NULL,
  actor text NOT NULL,
  before_overrides jsonb NOT NULL,
  after_overrides jsonb NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Role changes (staff.access_role) are recorded here too.
CREATE TABLE IF NOT EXISTS staff_role_audit (
  org_id text NOT NULL DEFAULT 'hdpm',
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person text NOT NULL REFERENCES staff(person),
  actor text NOT NULL,
  from_role text,
  to_role text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE role_section_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_section_defaults_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_role_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to role_section_defaults" ON role_section_defaults;
CREATE POLICY "Service role full access to role_section_defaults" ON role_section_defaults FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access to role_section_defaults_audit" ON role_section_defaults_audit;
CREATE POLICY "Service role full access to role_section_defaults_audit" ON role_section_defaults_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access to staff_role_audit" ON staff_role_audit;
CREATE POLICY "Service role full access to staff_role_audit" ON staff_role_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON role_section_defaults, role_section_defaults_audit, staff_role_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON role_section_defaults, role_section_defaults_audit, staff_role_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE role_section_defaults_audit_id_seq, staff_role_audit_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
