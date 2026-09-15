-- Apply after 20260915_timekeeping.sql. Safe to replay.
-- Allow active company administrators to update an employee's future schedule
-- without impersonating that employee or rewriting approved payroll history.
CREATE OR REPLACE FUNCTION timekeeping_admin_schedule(
  p_actor text, p_employee_id uuid, p_version integer, p_schedule jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a timekeeping_employee; e timekeeping_employee; previous jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hdpm-timekeeping'));
  SELECT te.* INTO a FROM timekeeping_employee te JOIN staff st ON st.person=te.staff_person
    WHERE te.email=lower(p_actor) AND lower(st.email)=lower(p_actor)
      AND st.active AND st.access_role='admin';
  IF a.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: active administrator required'; END IF;
  SELECT * INTO e FROM timekeeping_employee WHERE id=p_employee_id FOR UPDATE;
  IF e.id IS NULL OR lower(trim(e.staff_person))='craig' THEN
    RAISE EXCEPTION 'FORBIDDEN: choose an employee who records time';
  END IF;
  IF p_version IS NULL OR e.version<>p_version THEN
    RAISE EXCEPTION 'CONFLICT: reload employee defaults before saving';
  END IF;
  -- Full schedule/time validation is performed by the authenticated application.
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule)<>'object'
    OR NOT (p_schedule ?& ARRAY['weekdays','start','end','unpaidBreak','paidBreak'])
    OR jsonb_typeof(p_schedule->'weekdays')<>'array' THEN
    RAISE EXCEPTION 'A valid employee schedule is required';
  END IF;
  previous:=to_jsonb(e);
  UPDATE timekeeping_employee SET schedule=p_schedule,version=version+1,updated_at=now()
    WHERE id=e.id RETURNING * INTO e;
  INSERT INTO timekeeping_event(employee_id,actor,action,reason,before_data,after_data)
    VALUES(e.id,lower(p_actor),'admin_schedule','Administrator updated employee defaults',previous,to_jsonb(e));
  RETURN to_jsonb(e);
END $$;
REVOKE ALL ON FUNCTION timekeeping_admin_schedule(text,uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION timekeeping_admin_schedule(text,uuid,integer,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
