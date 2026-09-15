-- Apply after 20260915_timekeeping.sql. Safe to replay.
-- Enroll an untouched first-time profile, with its own authenticated actor.
-- The application supplies its configured reviewer; public clients cannot call this RPC.
CREATE OR REPLACE FUNCTION timekeeping_auto_enroll(p_actor text, p_manager_staff text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a timekeeping_employee; m timekeeping_employee; reviewer staff; previous jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hdpm-timekeeping'));
  SELECT te.* INTO a FROM timekeeping_employee te JOIN staff st ON st.person=te.staff_person
    WHERE te.email=lower(p_actor) AND lower(st.email)=lower(p_actor) AND st.active FOR UPDATE OF te;
  IF a.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: active staff account required'; END IF;
  -- Respect every previously configured or ended enrollment, including manual opt-outs.
  IF a.enabled OR a.version<>1 OR a.ends_on IS NOT NULL OR a.manager_id IS NOT NULL
    OR a.payroll_id<>'' OR a.schedule IS NOT NULL OR a.pay_basis<>'hourly'
    OR EXISTS(SELECT 1 FROM timekeeping_sheet WHERE employee_id=a.id)
    OR a.staff_person=p_manager_staff THEN RETURN to_jsonb(a); END IF;
  SELECT * INTO reviewer FROM staff WHERE person=p_manager_staff AND active AND email IS NOT NULL;
  IF reviewer.person IS NULL THEN RAISE EXCEPTION 'The default approving manager needs an active staff account'; END IF;
  INSERT INTO timekeeping_employee(staff_person,name,email)
    VALUES(reviewer.person,coalesce(reviewer.name,reviewer.person),lower(reviewer.email)) ON CONFLICT(staff_person) DO NOTHING;
  SELECT * INTO m FROM timekeeping_employee WHERE staff_person=reviewer.person;
  IF m.email<>lower(reviewer.email) THEN RAISE EXCEPTION 'Reconcile the default manager account email before enrollment'; END IF;
  previous:=to_jsonb(a);
  UPDATE timekeeping_employee SET enabled=true,manager_id=m.id,
    starts_on=(now() AT TIME ZONE 'America/Los_Angeles')::date,version=version+1,updated_at=now()
    WHERE id=a.id RETURNING * INTO a;
  INSERT INTO timekeeping_event(employee_id,actor,action,reason,before_data,after_data)
    VALUES(a.id,p_actor,'auto_enroll','First Timekeeping visit; configured default manager',previous,to_jsonb(a));
  RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION timekeeping_auto_enroll(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION timekeeping_auto_enroll(text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
