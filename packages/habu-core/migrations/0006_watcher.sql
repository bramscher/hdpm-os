-- ============================================
-- @habu/core 0006 — watcher_rule: the generalized tripwire engine (primitive 3, §5)
-- New schema. Watchers are per-org rules that scan open jackets and flag
-- exceptions (aged beyond N, recurring M in W days, no owner, waiting on
-- external > N days). The tripwire *engine* is extracted from hdpm-os
-- tripwire-engine.ts (PR-A7); the RULES are org config, seeded per tenant.
-- HDPM's 12 tripwires become the first watcher set — as tenant data, not core.
--
-- Watcher hits drive jacket color/attention (§4), the Brief (§6), and the
-- escalation ladder (§3).
-- ============================================

CREATE TABLE IF NOT EXISTS watcher_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL                    -- the exception shape the engine evaluates
    CHECK (kind IN ('aged','recurring','no_owner','waiting_external')),
  params JSONB NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"days":21} | {"episodes":3,"window_days":28}
  severity TEXT NOT NULL DEFAULT 'soon'  -- maps to jacket.attention when hit
    CHECK (severity IN ('soon','now')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watcher_rule_org ON watcher_rule (org_id) WHERE active;

-- A watcher hit against a jacket (the engine writes these; readers drive
-- color/brief/escalation off them). Kept append-friendly: one open row per
-- (rule, jacket) until cleared.
CREATE TABLE IF NOT EXISTS watcher_hit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  rule_id UUID NOT NULL REFERENCES watcher_rule(id) ON DELETE CASCADE,
  jacket_id UUID REFERENCES jacket(id) ON DELETE CASCADE,
  detail TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('soon','now')),
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watcher_hit_open
  ON watcher_hit (rule_id, jacket_id) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_watcher_hit_jacket ON watcher_hit (jacket_id) WHERE cleared_at IS NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['watcher_rule','watcher_hit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access to %1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "Service role full access to %1$s" ON %1$s FOR ALL USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
