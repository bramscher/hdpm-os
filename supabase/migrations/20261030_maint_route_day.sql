-- ============================================
-- Maintenance day routes: Brody schedules Alberto's day
-- Date: 2026-10-30
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- The Open Board route builder becomes the schedule: Brody publishes a day for
-- Alberto, and Alberto gets it by Outlook invite, email (text once his cell is
-- saved), My Day in the Field app and a printed day sheet.
--   maint_route_plan  start time, notes, and when/how the tech was notified
--   maint_route_stop  arrival/departure times and a snapshot of the job details
--                     (task, priority, permission to enter, AppFolio entry
--                     instructions) taken at publish
-- Also closes a gap: both tables were created without row-level security, so
-- the public (publishable) key could read them. All access is server-side with
-- the service role.
-- ============================================

BEGIN;

ALTER TABLE maint_route_plan ADD COLUMN IF NOT EXISTS start_time time NOT NULL DEFAULT '08:00';
ALTER TABLE maint_route_plan ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE maint_route_plan ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE maint_route_plan ADD COLUMN IF NOT EXISTS notify_log jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE maint_route_stop ADD COLUMN IF NOT EXISTS estimated_arrival timestamptz;
ALTER TABLE maint_route_stop ADD COLUMN IF NOT EXISTS estimated_departure timestamptz;
ALTER TABLE maint_route_stop ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One published route per tech per day; publishing again replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS maint_route_plan_one_per_tech_day
  ON maint_route_plan (route_date, lower(assigned_tech)) WHERE status = 'published';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['maint_route_plan', 'maint_route_stop'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Service role full access to ' || t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', 'Service role full access to ' || t, t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
