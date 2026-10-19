-- New hires: workweek days before an employee's start date need no opening hours.
-- Apply after 20260916_timekeeping_phone_stipend.sql. Safe to replay.
-- Replaces the payroll context (adds starts_on) and the export validation; saved exports are unchanged.
CREATE OR REPLACE FUNCTION timekeeping_payroll_context(p_period date) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('version',1,
    'employees',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'overtime_status',e.overtime_status,'starts_on',e.starts_on))
      FROM timekeeping_employee e WHERE EXISTS(SELECT 1 FROM timekeeping_sheet s WHERE s.employee_id=e.id AND s.period_start=p_period)), '[]'::jsonb),
    'precedingSheets',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.period_start,s.employee_id)
      FROM timekeeping_sheet s WHERE s.period_start < p_period
      AND s.period_end >= p_period-extract(dow from p_period)::integer
      AND EXISTS(SELECT 1 FROM timekeeping_sheet current WHERE current.period_start=p_period AND current.employee_id=s.employee_id)), '[]'::jsonb),
    'openings',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM timekeeping_week_opening o WHERE o.period_start=p_period
      AND EXISTS(SELECT 1 FROM generate_series(p_period-extract(dow from p_period)::integer,p_period-1,interval '1 day') d
        WHERE NOT EXISTS(SELECT 1 FROM timekeeping_sheet s,jsonb_array_elements(s.days) day
          WHERE s.employee_id=o.employee_id AND s.state='approved' AND day->>'date'=to_char(d,'YYYY-MM-DD')))), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION timekeeping_payroll_context(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION timekeeping_payroll_context(date) TO service_role;

CREATE OR REPLACE FUNCTION timekeeping_export_overtime() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb; day jsonb; shift jsonb; d date; context jsonb; starts date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hdpm-timekeeping'));
  context := timekeeping_payroll_context(NEW.period_start);
  FOR s IN SELECT value FROM jsonb_array_elements(NEW.snapshot->'sheets') LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'employees') e
      WHERE e->>'id'=s->>'employee_id' AND e->>'overtime_status' IN ('non_exempt','exempt')) THEN
      RAISE EXCEPTION 'Confirm overtime eligibility for % in Payroll setup',s->>'employee_name';
    END IF;
    SELECT (e->>'starts_on')::date INTO starts FROM jsonb_array_elements(context->'employees') e
      WHERE e->>'id'=s->>'employee_id';
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'openings') o WHERE o->>'employee_id'=s->>'employee_id') THEN
      FOR d IN SELECT generate_series(NEW.period_start-extract(dow from NEW.period_start)::integer,NEW.period_start-1,interval '1 day')::date LOOP
        CONTINUE WHEN starts IS NOT NULL AND d < starts;
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
