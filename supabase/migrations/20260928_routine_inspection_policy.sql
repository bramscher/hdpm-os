ALTER TABLE public.inspection_properties
  ADD COLUMN IF NOT EXISTS routine_inspections_enabled BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN public.inspection_properties.routine_inspections_enabled IS 'Local routine/biannual inspection policy; preserved by AppFolio sync. Other inspection types remain allowed.';
NOTIFY pgrst, 'reload schema';
