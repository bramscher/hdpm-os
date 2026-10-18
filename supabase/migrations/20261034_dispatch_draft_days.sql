-- Dispatch board, part 2: draft tech days.
-- Dropping a work order on a tech's day adds it to a DRAFT route for that day.
-- Drafts are never shown to the tech (My Day, field time, day sheets and the
-- morning card all read status = 'published'); the Route Builder opens the
-- draft, and publishing turns it into the published route.
BEGIN;

ALTER TABLE public.maint_route_plan
  DROP CONSTRAINT IF EXISTS maint_route_plan_status_check;
ALTER TABLE public.maint_route_plan
  ADD CONSTRAINT maint_route_plan_status_check
  CHECK (status IN ('draft', 'published', 'canceled'));

-- One draft per tech per day, like the published index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_maint_route_plan_one_draft
  ON public.maint_route_plan (route_date, lower(assigned_tech)) WHERE status = 'draft';

COMMIT;
