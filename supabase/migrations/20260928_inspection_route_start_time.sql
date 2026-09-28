-- Null preserves existing Outlook event times until a route start time is explicitly saved.
ALTER TABLE public.route_plans ADD COLUMN IF NOT EXISTS start_time TIME;
COMMENT ON COLUMN public.route_plans.start_time IS 'Route departure time in America/Los_Angeles; null uses legacy 08:00 default.';
NOTIFY pgrst, 'reload schema';
