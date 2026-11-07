-- Timekeeping: fix or cancel a running clock (Craig, 2026-11-07).
-- Paste the whole file into the Supabase SQL Editor and run it. Safe to run twice; it only
-- replaces two functions and ends with a read-only check. No table changes, no data changes.
--
-- 1. timekeeping_apply (last defined in 20261041_timekeeping_remove_sheet.sql) is the same except
--    for its clock branch: a worker's "Missed clock-out?", "Fix start time" and "Cancel this
--    clock-in" need a reason, are labelled clock_correct / clock_fix_start / clock_cancel in
--    timekeeping_event, and are filed under the sheet of the shift's start day so they show in
--    that sheet's change history. Requests without clockAction (the code before this PR) behave
--    exactly as before.
-- 2. New timekeeping_admin_clock: an administrator (access_role 'admin', not reviewers) fixes the
--    start, cancels, or stops another employee's running clock. A reason is always required.
--    Every change writes timekeeping_event rows with the admin as actor. Nothing is deleted.
-- Both refuse a fix whose running shift starts, or would start, on a submitted/approved/removed
-- sheet (looked up by the employee's period, not trusted from the request): reopen it first.

CREATE OR REPLACE FUNCTION timekeeping_apply(p_actor text, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a timekeeping_employee; e timekeeping_employee; s timekeeping_sheet; c timekeeping_clock;
  is_admin boolean; op text := p_request->>'op'; reason text := coalesce(p_request->>'reason','');
  old jsonb; item jsonb; result jsonb; current_id uuid; period date; export_version integer;
  today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  clock_action text := coalesce(nullif(p_request->>'clockAction',''),'clock'); event_action text; clock_sheet uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hdpm-timekeeping'));
  SELECT te.* INTO a FROM timekeeping_employee te JOIN staff st ON st.person = te.staff_person
    WHERE lower(st.email) = lower(p_actor) AND st.active AND te.email = lower(p_actor);
  IF a.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: active staff account required'; END IF;
  SELECT access_role = 'admin' INTO is_admin FROM staff WHERE person = a.staff_person;

  IF op IN ('employee', 'schedule') THEN
    SELECT * INTO e FROM timekeeping_employee WHERE id = (p_request->>'employeeId')::uuid FOR UPDATE;
    IF e.id IS NULL OR (op = 'employee' AND NOT is_admin) OR (op = 'schedule' AND e.id <> a.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF e.version <> (p_request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload before saving'; END IF;
    old := to_jsonb(e);
    IF op = 'schedule' THEN
      UPDATE timekeeping_employee SET schedule = p_request->'schedule', version = version + 1, updated_at = now() WHERE id = e.id RETURNING * INTO e;
    ELSE
      IF (p_request->>'enabled')::boolean AND nullif(p_request->>'managerId','') IS NULL THEN RAISE EXCEPTION 'Choose a reviewer before enrolling an employee'; END IF;
      UPDATE timekeeping_employee SET payroll_id = p_request->>'payrollId', pay_basis = p_request->>'payBasis',
        manager_id = nullif(p_request->>'managerId','')::uuid, enabled = (p_request->>'enabled')::boolean,
        starts_on = (p_request->>'startsOn')::date, ends_on = nullif(p_request->>'endsOn','')::date,
        version = version + 1, updated_at = now() WHERE id = e.id RETURNING * INTO e;
    END IF;
    INSERT INTO timekeeping_event(employee_id, actor, action, before_data, after_data) VALUES(e.id,p_actor,op,old,to_jsonb(e));
    RETURN to_jsonb(e);
  END IF;

  IF op = 'export' THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    period := (p_request->>'period')::date;
    IF NOT EXISTS(SELECT 1 FROM timekeeping_period WHERE start_date = period AND end_date <= today) THEN RAISE EXCEPTION 'This pay period has not ended'; END IF;
    IF NOT EXISTS(SELECT 1 FROM timekeeping_sheet WHERE period_start = period) THEN RAISE EXCEPTION 'No timesheets in this period'; END IF;
    IF EXISTS(SELECT 1 FROM timekeeping_employee te JOIN timekeeping_period pp ON pp.start_date = period
      LEFT JOIN timekeeping_sheet ts ON ts.employee_id = te.id AND ts.period_start = period
      WHERE ((te.enabled OR te.ends_on IS NOT NULL) AND te.starts_on <= pp.end_date
        AND (te.ends_on IS NULL OR te.ends_on >= pp.start_date) OR ts.id IS NOT NULL) AND ts.state IS DISTINCT FROM 'removed' AND (ts.id IS NULL OR ts.state <> 'approved' OR ts.employee_signed_at IS NULL)) THEN
      RAISE EXCEPTION 'Every enrolled employee needs an approved sheet before export';
    END IF;
    SELECT coalesce(max(version),0)+1 INTO export_version FROM timekeeping_export WHERE period_start = period;
    SELECT jsonb_build_object('periodStart',pp.start_date,'periodEnd',pp.end_date,'generatedAt',now(),'createdBy',p_actor,'version',export_version,
      'sheets',(SELECT jsonb_agg(to_jsonb(ts) ORDER BY ts.employee_name) FROM timekeeping_sheet ts WHERE ts.period_start = period AND ts.state = 'approved'))
      INTO result FROM timekeeping_period pp WHERE pp.start_date = period;
    INSERT INTO timekeeping_export(period_start,version,snapshot,created_by) VALUES(period,export_version,result,p_actor) RETURNING to_jsonb(timekeeping_export.*) INTO result;
    RETURN result;
  END IF;

  IF op = 'clock' THEN
    IF NOT a.enabled THEN RAISE EXCEPTION 'FORBIDDEN: timekeeping enrollment required'; END IF;
    -- 20261044: a fix (missed clock-out, fixed start, cancelled clock-in) needs a reason and is
    -- labelled in the event log. Requests without clockAction (older app code) work as before.
    IF clock_action NOT IN ('clock','in','break','resume','out','correct','fix_start','cancel') THEN RAISE EXCEPTION 'Unknown clock action'; END IF;
    IF clock_action IN ('correct','fix_start','cancel') AND length(trim(reason)) = 0 THEN RAISE EXCEPTION 'Enter a reason for this clock change'; END IF;
    event_action := CASE WHEN clock_action IN ('correct','fix_start','cancel') THEN 'clock_' || clock_action ELSE 'clock' END;
    INSERT INTO timekeeping_clock(employee_id) VALUES(a.id) ON CONFLICT DO NOTHING;
    SELECT * INTO c FROM timekeeping_clock WHERE employee_id = a.id FOR UPDATE;
    IF c.version <> (p_request->>'clockVersion')::integer THEN RAISE EXCEPTION 'CONFLICT: clock changed on another device'; END IF;
    IF clock_action IN ('fix_start','cancel') AND c.shift IS NULL THEN RAISE EXCEPTION 'The clock is not running'; END IF;
    IF clock_action = 'cancel' AND jsonb_typeof(p_request->'shift') IS DISTINCT FROM 'null' THEN RAISE EXCEPTION 'A cancelled clock-in has no running entry'; END IF;
    IF clock_action = 'fix_start' AND (p_request->'shift'->>'id') IS DISTINCT FROM (c.shift->>'id') THEN RAISE EXCEPTION 'Fixing the start keeps the same running entry'; END IF;
    -- The sheets covering the running shift's start and the corrected start must still be editable,
    -- whether or not any of their days change (looked up here, not taken from the request).
    IF clock_action IN ('correct','fix_start','cancel') AND EXISTS(
      SELECT 1 FROM timekeeping_sheet ts
      WHERE ts.employee_id = a.id AND ts.state NOT IN ('draft','returned')
        AND EXISTS(SELECT 1 FROM (VALUES (c.shift->>'start'), (p_request->'shift'->>'start')) AS st(v)
          WHERE st.v IS NOT NULL
            AND ts.period_start <= ((st.v)::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
            AND ts.period_end >= ((st.v)::timestamptz AT TIME ZONE 'America/Los_Angeles')::date)
    ) THEN RAISE EXCEPTION 'Clock time overlaps a locked timesheet; ask your manager to reopen it'; END IF;
    old := to_jsonb(c);
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_request->'sheets','[]'::jsonb)) LOOP
      SELECT * INTO s FROM timekeeping_sheet WHERE id = (item->>'id')::uuid FOR UPDATE;
      IF s.employee_id <> a.id OR s.id IS NULL OR s.state NOT IN ('draft','returned') THEN RAISE EXCEPTION 'Clock time overlaps a locked timesheet; ask your manager to reopen it'; END IF;
      IF s.version <> (item->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: timesheet changed'; END IF;
      INSERT INTO timekeeping_event(employee_id,sheet_id,actor,action,reason,before_data,after_data)
        VALUES(a.id,s.id,p_actor,event_action,reason,to_jsonb(s),item);
      UPDATE timekeeping_sheet SET days = item->'days', version = version+1, updated_at = now() WHERE id = s.id;
    END LOOP;
    UPDATE timekeeping_clock SET shift = nullif(p_request->'shift','null'::jsonb), version=version+1, updated_at=now() WHERE employee_id=a.id RETURNING * INTO c;
    -- A fix is filed under the sheet holding the shift's start day, so it shows in that sheet's history.
    IF event_action <> 'clock' THEN
      SELECT id INTO clock_sheet FROM timekeeping_sheet WHERE employee_id = a.id
        AND period_start <= ((coalesce(old->'shift'->>'start', p_request->'shift'->>'start'))::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
        AND period_end >= ((coalesce(old->'shift'->>'start', p_request->'shift'->>'start'))::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
        LIMIT 1;
    END IF;
    INSERT INTO timekeeping_event(employee_id,sheet_id,actor,action,reason,before_data,after_data) VALUES(a.id,clock_sheet,p_actor,event_action,reason,old,to_jsonb(c));
    RETURN to_jsonb(c);
  END IF;

  SELECT * INTO s FROM timekeeping_sheet WHERE id = (p_request->>'sheetId')::uuid FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO e FROM timekeeping_employee WHERE id = s.employee_id;
  SELECT id INTO current_id FROM timekeeping_sheet WHERE employee_id = a.id AND period_start <= today AND state <> 'removed'
    AND (state IN ('draft','returned') OR (period_start <= today AND period_end >= today))
    ORDER BY CASE WHEN state IN ('draft','returned') THEN 0 ELSE 1 END, period_start LIMIT 1;
  IF s.version <> (p_request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: another change was saved; reload before continuing'; END IF;
  old := to_jsonb(s);
  IF op IN ('save','submit') THEN
    IF NOT ((s.employee_id = a.id AND s.id = current_id AND a.enabled) OR (is_admin AND op='save' AND length(trim(reason))>0)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF s.state NOT IN ('draft','returned') THEN RAISE EXCEPTION 'This timesheet is locked'; END IF;
    IF EXISTS(SELECT 1 FROM timekeeping_clock WHERE employee_id=s.employee_id AND shift IS NOT NULL) THEN
      -- While the clock runs, earlier days stay editable; today and later stay
      -- exactly as saved (they belong to the running clock). Submitting still waits.
      IF op = 'submit' THEN RAISE EXCEPTION 'Clock out before submitting the sheet'; END IF;
      IF EXISTS(
        SELECT 1 FROM jsonb_array_elements(s.days) AS od(v)
        FULL JOIN jsonb_array_elements(p_request->'days') AS nd(v) ON nd.v->>'date' = od.v->>'date'
        WHERE coalesce(od.v->>'date', nd.v->>'date')::date >= today AND od.v IS DISTINCT FROM nd.v
      ) THEN RAISE EXCEPTION 'Clock out before changing today or later days'; END IF;
      -- Audit trail: the event row below records who changed what, before and after.
      reason := coalesce(nullif(trim(reason),''), 'Edited earlier days while clocked in');
    END IF;
    IF op = 'submit' AND e.manager_id IS NULL THEN RAISE EXCEPTION 'Submit after a reviewer is assigned'; END IF;
    IF op = 'submit' AND coalesce((p_request->>'attested')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Confirm your employee signature before submitting'; END IF;
    UPDATE timekeeping_sheet SET days=p_request->'days', note=coalesce(p_request->>'note',note), state=CASE WHEN op='submit' THEN 'submitted' ELSE state END,
      employee_signed_by=CASE WHEN op='submit' THEN a.email ELSE NULL END,
      employee_signed_name=CASE WHEN op='submit' THEN a.name ELSE NULL END,
      employee_signed_at=CASE WHEN op='submit' THEN now() ELSE NULL END,
      employee_signed_version=CASE WHEN op='submit' THEN version+1 ELSE NULL END,
      employee_attestation=CASE WHEN op='submit' THEN 'I certify that this timesheet accurately records my work, breaks, leave and business miles. I approve and sign it using my Microsoft company account.' ELSE NULL END,
      review_manager_id=CASE WHEN op='submit' THEN e.manager_id ELSE review_manager_id END,
      employee_name=CASE WHEN op='submit' THEN e.name ELSE employee_name END, payroll_id=CASE WHEN op='submit' THEN e.payroll_id ELSE payroll_id END, pay_basis=CASE WHEN op='submit' THEN e.pay_basis ELSE pay_basis END,
      reason=CASE WHEN op='submit' THEN '' ELSE timekeeping_sheet.reason END, version=version+1, updated_at=now() WHERE id=s.id RETURNING * INTO s;
  ELSIF op IN ('approve','return') THEN
    IF NOT is_admin OR s.employee_id=a.id THEN RAISE EXCEPTION 'FORBIDDEN: only administrators may review; no self-approval'; END IF;
    IF s.state <> 'submitted' THEN RAISE EXCEPTION 'Only submitted sheets can be reviewed'; END IF;
    IF op='approve' AND s.employee_signed_at IS NULL THEN RAISE EXCEPTION 'Employee must sign this timesheet before manager approval'; END IF;
    IF op='return' AND length(trim(reason))=0 THEN RAISE EXCEPTION 'Enter a return reason'; END IF;
    UPDATE timekeeping_sheet SET state=CASE WHEN op='approve' THEN 'approved' ELSE 'returned' END,
      reason=CASE WHEN op='return' THEN p_request->>'reason' ELSE '' END,
      employee_signed_by=CASE WHEN op='approve' THEN employee_signed_by ELSE NULL END,
      employee_signed_name=CASE WHEN op='approve' THEN employee_signed_name ELSE NULL END,
      employee_signed_at=CASE WHEN op='approve' THEN employee_signed_at ELSE NULL END,
      employee_signed_version=CASE WHEN op='approve' THEN employee_signed_version ELSE NULL END,
      employee_attestation=CASE WHEN op='approve' THEN employee_attestation ELSE NULL END,
      approved_by=CASE WHEN op='approve' THEN p_actor ELSE NULL END,
      approved_at=CASE WHEN op='approve' THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=s.id RETURNING * INTO s;
  ELSIF op = 'reopen' THEN
    IF NOT is_admin OR length(trim(reason))=0 THEN RAISE EXCEPTION 'FORBIDDEN: admin and correction reason required'; END IF;
    IF s.state NOT IN ('approved','submitted') THEN RAISE EXCEPTION 'This sheet is already editable'; END IF;
    UPDATE timekeeping_sheet SET employee_signed_by=NULL,employee_signed_name=NULL,employee_signed_at=NULL,employee_signed_version=NULL,employee_attestation=NULL,state='returned',reason=p_request->>'reason',approved_by=NULL,approved_at=NULL,version=version+1,updated_at=now() WHERE id=s.id RETURNING * INTO s;
  ELSIF op = 'remove' THEN
    IF NOT is_admin OR length(trim(reason))=0 THEN RAISE EXCEPTION 'FORBIDDEN: admin and removal reason required'; END IF;
    IF s.state NOT IN ('draft','returned') OR s.employee_signed_at IS NOT NULL THEN RAISE EXCEPTION 'Only an unsigned sheet can be removed'; END IF;
    IF e.ends_on IS NULL OR e.ends_on >= s.period_start THEN RAISE EXCEPTION 'Set the employee''s end date before this period in Payroll setup first'; END IF;
    UPDATE timekeeping_sheet SET state='removed',reason=p_request->>'reason',version=version+1,updated_at=now() WHERE id=s.id RETURNING * INTO s;
  ELSE RAISE EXCEPTION 'Unknown timekeeping command'; END IF;
  INSERT INTO timekeeping_event(employee_id,sheet_id,actor,action,reason,before_data,after_data) VALUES(s.employee_id,s.id,p_actor,op,reason,old,to_jsonb(s));
  RETURN to_jsonb(s);
END $$;

REVOKE ALL ON FUNCTION timekeeping_apply(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION timekeeping_apply(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION timekeeping_admin_clock(p_actor text, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a timekeeping_employee; e timekeeping_employee; s timekeeping_sheet; c timekeeping_clock;
  old jsonb; item jsonb; clock_sheet uuid; event_action text;
  reason text := trim(coalesce(p_request->>'reason',''));
  clock_action text := coalesce(p_request->>'clockAction','');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hdpm-timekeeping'));
  SELECT te.* INTO a FROM timekeeping_employee te JOIN staff st ON st.person = te.staff_person
    WHERE te.email = lower(p_actor) AND lower(st.email) = lower(p_actor) AND st.active AND st.access_role = 'admin';
  IF a.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: active administrator required'; END IF;
  IF length(reason) = 0 THEN RAISE EXCEPTION 'Enter a reason for this clock change'; END IF;
  IF clock_action NOT IN ('fix_start','cancel','stop') THEN RAISE EXCEPTION 'Unknown clock action'; END IF;
  SELECT * INTO e FROM timekeeping_employee WHERE id = nullif(p_request->>'employeeId','')::uuid;
  IF e.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: choose an employee'; END IF;
  IF e.id = a.id THEN RAISE EXCEPTION 'FORBIDDEN: use your own clock panel for your own clock'; END IF;
  event_action := 'admin_clock_' || clock_action;
  SELECT * INTO c FROM timekeeping_clock WHERE employee_id = e.id FOR UPDATE;
  IF c.employee_id IS NULL OR c.shift IS NULL THEN RAISE EXCEPTION 'This person is not clocked in'; END IF;
  IF c.version <> (p_request->>'clockVersion')::integer THEN RAISE EXCEPTION 'CONFLICT: the clock changed; reload before continuing'; END IF;
  IF clock_action IN ('cancel','stop') AND jsonb_typeof(p_request->'shift') IS DISTINCT FROM 'null' THEN RAISE EXCEPTION 'Cancel and stop leave no running entry'; END IF;
  IF clock_action = 'fix_start' AND (p_request->'shift'->>'id') IS DISTINCT FROM (c.shift->>'id') THEN RAISE EXCEPTION 'Fixing the start keeps the same running entry'; END IF;
  -- The sheets covering the running shift's start and the corrected start must still be editable,
  -- whether or not any of their days change (looked up here, not taken from the request).
  IF EXISTS(
    SELECT 1 FROM timekeeping_sheet ts
    WHERE ts.employee_id = e.id AND ts.state NOT IN ('draft','returned')
      AND EXISTS(SELECT 1 FROM (VALUES (c.shift->>'start'), (p_request->'shift'->>'start')) AS st(v)
        WHERE st.v IS NOT NULL
          AND ts.period_start <= ((st.v)::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
          AND ts.period_end >= ((st.v)::timestamptz AT TIME ZONE 'America/Los_Angeles')::date)
  ) THEN RAISE EXCEPTION 'Clock time overlaps a locked timesheet; reopen it first'; END IF;
  old := to_jsonb(c);
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_request->'sheets','[]'::jsonb)) LOOP
    SELECT * INTO s FROM timekeeping_sheet WHERE id = (item->>'id')::uuid FOR UPDATE;
    IF s.id IS NULL OR s.employee_id <> e.id OR s.state NOT IN ('draft','returned') THEN RAISE EXCEPTION 'Clock time overlaps a locked timesheet; reopen it first'; END IF;
    IF s.version <> (item->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: timesheet changed'; END IF;
    INSERT INTO timekeeping_event(employee_id,sheet_id,actor,action,reason,before_data,after_data)
      VALUES(e.id,s.id,p_actor,event_action,reason,to_jsonb(s),item);
    UPDATE timekeeping_sheet SET days = item->'days', version = version+1, updated_at = now() WHERE id = s.id;
  END LOOP;
  UPDATE timekeeping_clock SET shift = nullif(p_request->'shift','null'::jsonb), version = version+1, updated_at = now()
    WHERE employee_id = e.id RETURNING * INTO c;
  SELECT id INTO clock_sheet FROM timekeeping_sheet WHERE employee_id = e.id
    AND period_start <= ((old->'shift'->>'start')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
    AND period_end >= ((old->'shift'->>'start')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
    LIMIT 1;
  INSERT INTO timekeeping_event(employee_id,sheet_id,actor,action,reason,before_data,after_data)
    VALUES(e.id,clock_sheet,p_actor,event_action,reason,old,to_jsonb(c));
  RETURN to_jsonb(c);
END $$;

REVOKE ALL ON FUNCTION timekeeping_admin_clock(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION timekeeping_admin_clock(text,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Check (read-only): two rows, both columns true.
SELECT p.proname AS function_name,
  p.prosecdef AS security_definer,
  position('clockAction' IN p.prosrc) > 0 AS has_running_clock_fixes
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('timekeeping_apply','timekeeping_admin_clock')
ORDER BY p.proname;
