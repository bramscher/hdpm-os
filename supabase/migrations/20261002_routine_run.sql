-- Routine run log (workstream C). One row per scheduled cron invocation, written by
-- withCronRun (lib/cron/run.ts). Makes silent L0 no-ops visible: a run that returns
-- { halted } or { skipped } is recorded as such instead of disappearing into a 200.
-- Additive. Until this is applied the wrapper's inserts fail softly and crons run as before.
BEGIN;
CREATE TABLE IF NOT EXISTS routine_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL DEFAULT 'hdpm',
 routine_id text NOT NULL, path text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','ok','halted','skipped','error')),
 halt_reason text, items integer, recipients text[] NOT NULL DEFAULT '{}',
 summary jsonb NOT NULL DEFAULT '{}'::jsonb, error text
);
CREATE INDEX IF NOT EXISTS routine_run_routine_idx ON routine_run(routine_id, started_at DESC);
CREATE INDEX IF NOT EXISTS routine_run_started_idx ON routine_run(started_at DESC);

ALTER TABLE routine_run ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to routine_run" ON routine_run;
CREATE POLICY "Service role full access to routine_run" ON routine_run FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON routine_run FROM PUBLIC, anon, authenticated;
GRANT ALL ON routine_run TO service_role;
COMMIT;

NOTIFY pgrst, 'reload schema';
