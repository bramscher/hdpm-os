-- ============================================
-- @habu/core 0005 — jackets: the core work object (HABU primitive 2, §4 + App A)
-- New schema (no hdpm-os predecessor). A jacket is a piece of work with a
-- COLOR (process identity), a LOCATION (current seat), and a CHECKLIST (steps)
-- — and it moves. Digital replica of HDPM's physical colored folders.
--
-- Per Appendix A.0 (supersedes the §4 draft): color = PROCESS IDENTITY (from
-- the template), not status. Status is a separate derived "traffic light":
-- attention ∈ none|soon|now. Two colors, two meanings — same as the drawer.
-- Templates are DATA, not code: an org admin (or an interviewing agent) defines
-- a template from a paper form.
-- ============================================

CREATE TABLE IF NOT EXISTS jacket_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,                    -- 'move-out' | 'move-in' | 'eviction' | ...
  title TEXT NOT NULL,
  color TEXT NOT NULL                   -- process identity (App A.0)
    CHECK (color IN ('green','yellow','red','black','blue')),
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,  -- step definitions (label/seat_role/requires/track/due_rule/external_match)
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS jacket (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  template_id UUID REFERENCES jacket_template(id) ON DELETE SET NULL,
  title TEXT NOT NULL,                  -- '{anchor date} · {address}' (App A.0 edge label)
  color TEXT NOT NULL                   -- copied from template (process identity)
    CHECK (color IN ('green','yellow','red','black','blue')),
  attention TEXT NOT NULL DEFAULT 'none'  -- DERIVED status dot (§7); 'now' = red "needs you"
    CHECK (attention IN ('none','soon','now')),
  current_seat_id UUID REFERENCES seat(id) ON DELETE SET NULL,  -- whose desk it's on
  subject_type TEXT,                    -- 'work_order' | 'unit' | 'lease' | ...
  subject_id TEXT,                      -- link into the tenant's system of record
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jacket_org_status ON jacket (org_id, status);
CREATE INDEX IF NOT EXISTS idx_jacket_current_seat ON jacket (current_seat_id);
CREATE INDEX IF NOT EXISTS idx_jacket_subject ON jacket (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS jacket_step (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jacket_id UUID NOT NULL REFERENCES jacket(id) ON DELETE CASCADE,
  ordinal INT NOT NULL,                 -- order within the jacket (or within a track)
  track TEXT,                           -- parallel track name (App A.1 move-out); NULL = linear
  label TEXT NOT NULL,                  -- printed checklist line
  seat_id UUID REFERENCES seat(id) ON DELETE SET NULL,  -- who does this step
  requires TEXT NOT NULL DEFAULT 'tap'
    CHECK (requires IN ('tap','external_event','agent_run')),
  external_match JSONB,                 -- {source, event_type, subject_key} — how the loop self-closes (§7)
  due_rule TEXT,                        -- e.g. 'created+3bd' (business-day aware)
  due_on DATE,                          -- computed from due_rule
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','active','done','skipped','blocked')),
  done_at TIMESTAMPTZ,
  done_by TEXT                          -- actor convention (human / agent:<name> / system:<job>)
);

CREATE INDEX IF NOT EXISTS idx_jacket_step_jacket ON jacket_step (jacket_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_jacket_step_seat ON jacket_step (seat_id);
CREATE INDEX IF NOT EXISTS idx_jacket_step_active ON jacket_step (jacket_id) WHERE state = 'active';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['jacket_template','jacket','jacket_step'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access to %1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "Service role full access to %1$s" ON %1$s FOR ALL USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
