-- Phone carrying is stipend-only, not evidence of after-hours emergency work.
-- Apply after 20260916_timekeeping_overtime.sql. Safe to replay.
-- Replaces only the export validation function; signed timecards and saved exports are unchanged.
CREATE OR REPLACE FUNCTION timekeeping_export_overtime() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb; day jsonb; shift jsonb; d date; context jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hdpm-timekeeping'));
  context := timekeeping_payroll_context(NEW.period_start);
  FOR s IN SELECT value FROM jsonb_array_elements(NEW.snapshot->'sheets') LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'employees') e
      WHERE e->>'id'=s->>'employee_id' AND e->>'overtime_status' IN ('non_exempt','exempt')) THEN
      RAISE EXCEPTION 'Confirm overtime eligibility for % in Payroll setup',s->>'employee_name';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'openings') o WHERE o->>'employee_id'=s->>'employee_id') THEN
      FOR d IN SELECT generate_series(NEW.period_start-extract(dow from NEW.period_start)::integer,NEW.period_start-1,interval '1 day')::date LOOP
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'precedingSheets') previous,
          jsonb_array_elements(previous->'days') pd
          WHERE previous->>'employee_id'=s->>'employee_id' AND previous->>'state'='approved' AND pd->>'date'=d::text) THEN
          RAISE EXCEPTION 'Confirm opening hours for % before % in Payroll setup',s->>'employee_name',NEW.period_start;
        END IF;
      END LOOP;
    END IF;
    FOR day IN SELECT value FROM jsonb_array_elements(s->'days') LOOP
      FOR shift IN SELECT value FROM jsonb_array_elements(day->'shifts') LOOP
        IF shift->>'source'='scheduled' OR shift->>'end' IS NULL THEN RAISE EXCEPTION 'Confirm actual worked hours before export'; END IF;
        IF coalesce((day->>'emergency')::boolean,false)
          AND jsonb_typeof(shift->'emergencyAfterHours') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'Identify after-hours emergency intervals for % on % before export',s->>'employee_name',day->>'date';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  NEW.snapshot := NEW.snapshot || jsonb_build_object('overtime',context);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION timekeeping_export_overtime() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS timekeeping_export_overtime ON timekeeping_export;
CREATE TRIGGER timekeeping_export_overtime BEFORE INSERT ON timekeeping_export
  FOR EACH ROW EXECUTE FUNCTION timekeeping_export_overtime();
