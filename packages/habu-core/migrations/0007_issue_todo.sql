-- ============================================
-- @habu/core 0007 — issue + todo: what the escalation ladder files (§3)
-- Generalized from hdpm-os 20260804_eos_core.sql (issue/todo portions only).
-- Agents file Issues, never solve them; a filed issue routes UP a human
-- escalation path (issue.escalation_seat_id → seat). To-dos roll once, then
-- file an issue on the second miss.
-- ============================================

CREATE TABLE IF NOT EXISTS issue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  raised_by TEXT NOT NULL,             -- actor: system:escalation | agent:<name> | watcher:<rule>
  source_ref TEXT,                     -- stable dedupe key (watcher:<rule>:<jacket>, todo:<id>)
  escalation_seat_id UUID REFERENCES seat(id) ON DELETE SET NULL,  -- the human path it routes to
  priority INT NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','discussed','solved','parked')),
  solved_decision_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open issue per source_ref (idempotent filing).
CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_open_source
  ON issue (org_id, source_ref) WHERE status = 'open' AND source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issue_org_status ON issue (org_id, status);

CREATE TABLE IF NOT EXISTS todo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_person TEXT REFERENCES staff(person) ON DELETE SET NULL,
  due_on DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('meeting','issue','decision','agent','manual')),
  source_id TEXT,                      -- rolled copy points at the original todo id
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','missed','rolled')),
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_todo_org_status_due ON todo (org_id, status, due_on);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['issue','todo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access to %1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "Service role full access to %1$s" ON %1$s FOR ALL USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
