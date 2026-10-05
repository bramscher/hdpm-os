-- Add Lisa Coffey: Property Manager with delegated admin areas
-- (Company KPIs, Fee Management, Hiring, Partners — see `delegable` in
-- lib/access/sections.ts). Further changes go through Admin → User settings.
-- Idempotent.

INSERT INTO staff (person, name, email, role, access_role, active)
VALUES ('Lisa', 'Lisa Coffey', 'lisa@highdesertpm.com', 'Property Manager', 'pm', true)
ON CONFLICT (person) DO UPDATE
  SET name = EXCLUDED.name, email = EXCLUDED.email, access_role = 'pm', active = true;

INSERT INTO staff_section_access (person, overrides, version, updated_by)
VALUES ('Lisa', '{"kpis": true, "fee_management": true, "hiring": true, "referrals_admin": true}'::jsonb, 1, 'craig@highdesertpm.com')
ON CONFLICT (person) DO NOTHING;

INSERT INTO staff_section_access_audit (person, actor, before_overrides, after_overrides, reason)
SELECT 'Lisa', 'craig@highdesertpm.com', '{}'::jsonb,
       '{"kpis": true, "fee_management": true, "hiring": true, "referrals_admin": true}'::jsonb,
       'Hybrid admin: KPIs, Fee Management, Hiring, Partners (no tax documents)'
WHERE NOT EXISTS (SELECT 1 FROM staff_section_access_audit WHERE person = 'Lisa');
