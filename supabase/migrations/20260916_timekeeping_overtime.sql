-- Sunday-Saturday overtime context is frozen into each new payroll export.
-- Apply after the base timekeeping migration. Safe to replay.
ALTER TABLE timekeeping_employee ADD COLUMN IF NOT EXISTS overtime_status text
  NOT NULL DEFAULT 'non_exempt' CHECK (overtime_status IN ('non_exempt','exempt','unconfirmed'));

CREATE TABLE IF NOT EXISTS timekeeping_week_opening (
  employee_id uuid NOT NULL REFERENCES timekeeping_employee(id),
  period_start date NOT NULL REFERENCES timekeeping_period(start_date),
  org_id text NOT NULL DEFAULT 'hdpm',
  worked_minutes numeric NOT NULL CHECK (worked_minutes >= 0 AND worked_minutes <= 8640),
  note text NOT NULL CHECK (length(trim(note)) > 0 AND length(note) <= 2000),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(employee_id, period_start)
);
ALTER TABLE timekeeping_week_opening ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timekeeping_week_opening FROM anon, authenticated;
GRANT ALL ON timekeeping_week_opening TO service_role;
DROP POLICY IF EXISTS timekeeping_service_access ON timekeeping_week_opening;
CREATE POLICY timekeeping_service_access ON timekeeping_week_opening FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION timekeeping_payroll_context(p_period date) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('version',1,
    'employees',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'overtime_status',e.overtime_status))
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

CREATE OR REPLACE FUNCTION timekeeping_payroll_setup(p_actor text, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e timekeeping_employee; old jsonb; result jsonb; period date; minutes numeric;
  opening timekeeping_week_opening; reason text := trim(coalesce(p_request->>'reason',''));
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hdpm-timekeeping'));
  IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(p_actor) AND active AND access_role='admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator required';
  END IF;
  IF length(reason)=0 OR length(reason)>2000 THEN RAISE EXCEPTION 'Enter the source or reason for this payroll setting'; END IF;
  SELECT * INTO e FROM timekeeping_employee WHERE id=(p_request->>'employeeId')::uuid FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF p_request->>'setting'='eligibility' THEN
    IF e.version IS DISTINCT FROM (p_request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload before saving'; END IF;
    IF coalesce(p_request->>'overtimeStatus','') NOT IN ('non_exempt','exempt') THEN RAISE EXCEPTION 'Choose overtime eligibility'; END IF;
    old := to_jsonb(e);
    UPDATE timekeeping_employee SET overtime_status=p_request->>'overtimeStatus',version=version+1,updated_at=now()
      WHERE id=e.id RETURNING to_jsonb(timekeeping_employee.*) INTO result;
  ELSIF p_request->>'setting'='opening' THEN
    period := (p_request->>'period')::date;
    IF NOT EXISTS(SELECT 1 FROM timekeeping_sheet WHERE period_start=period AND employee_id=e.id) OR extract(dow from period)=0 THEN
      RAISE EXCEPTION 'Choose a pay period that starts partway through a workweek';
    END IF;
    -- Existing complete approved records are authoritative; opening hours fill gaps only.
    IF NOT EXISTS(SELECT 1 FROM generate_series(period-extract(dow from period)::integer,period-1,interval '1 day') d
      WHERE NOT EXISTS(SELECT 1 FROM timekeeping_sheet s, jsonb_array_elements(s.days) day
        WHERE s.employee_id=e.id AND s.state='approved' AND day->>'date'=to_char(d,'YYYY-MM-DD'))) THEN
      RAISE EXCEPTION 'Approved prior timecards already provide these opening hours';
    END IF;
    SELECT * INTO opening FROM timekeeping_week_opening WHERE employee_id=e.id AND period_start=period FOR UPDATE;
    IF coalesce(opening.version,0) IS DISTINCT FROM (p_request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload before saving'; END IF;
    old := CASE WHEN opening.employee_id IS NULL THEN NULL ELSE to_jsonb(opening) END;
    minutes := (p_request->>'workedMinutes')::numeric;
    IF minutes IS NULL OR minutes < 0 OR minutes > extract(dow from period)*1440 THEN RAISE EXCEPTION 'Check opening worked hours'; END IF;
    INSERT INTO timekeeping_week_opening(employee_id,period_start,worked_minutes,note)
      VALUES(e.id,period,minutes,reason)
      ON CONFLICT(employee_id,period_start) DO UPDATE SET worked_minutes=excluded.worked_minutes,note=excluded.note,
        version=timekeeping_week_opening.version+1,updated_at=now()
      RETURNING to_jsonb(timekeeping_week_opening.*) INTO result;
  ELSE RAISE EXCEPTION 'Unknown payroll setting'; END IF;
  INSERT INTO timekeeping_event(employee_id,actor,action,reason,before_data,after_data)
    VALUES(e.id,p_actor,'payroll_'||(p_request->>'setting'),reason,old,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION timekeeping_payroll_setup(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION timekeeping_payroll_setup(text,jsonb) TO service_role;

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
        IF (coalesce((day->>'emergency')::boolean,false) OR coalesce((day->>'emergencyPhone')::boolean,false))
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
