-- Timekeeping: apply manually to a test database first; safe to re-run.
-- All browser access goes through authenticated app routes. No public RLS policies.
CREATE TABLE IF NOT EXISTS timekeeping_employee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL DEFAULT 'hdpm',
  staff_person text NOT NULL UNIQUE REFERENCES staff(person), email text NOT NULL UNIQUE,
  name text NOT NULL, payroll_id text NOT NULL DEFAULT '', pay_basis text NOT NULL DEFAULT 'hourly' CHECK (pay_basis IN ('hourly','salary')),
  manager_id uuid REFERENCES timekeeping_employee(id), enabled boolean NOT NULL DEFAULT false,
  starts_on date NOT NULL DEFAULT CURRENT_DATE, ends_on date, schedule jsonb,
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email)), CHECK (manager_id IS DISTINCT FROM id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE TABLE IF NOT EXISTS timekeeping_period (
  start_date date PRIMARY KEY, end_date date NOT NULL, org_id text NOT NULL DEFAULT 'hdpm',
  CHECK ((extract(day from start_date) = 1 AND end_date = start_date + 14)
    OR (extract(day from start_date) = 16 AND end_date = (date_trunc('month', start_date) + interval '1 month - 1 day')::date))
);
CREATE TABLE IF NOT EXISTS timekeeping_sheet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL DEFAULT 'hdpm',
  employee_id uuid NOT NULL REFERENCES timekeeping_employee(id),
  period_start date NOT NULL REFERENCES timekeeping_period(start_date), period_end date NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','returned','approved')),
  days jsonb NOT NULL CHECK (jsonb_typeof(days) = 'array'), version integer NOT NULL DEFAULT 1,
  review_manager_id uuid REFERENCES timekeeping_employee(id),
  employee_name text NOT NULL, payroll_id text NOT NULL DEFAULT '', pay_basis text NOT NULL DEFAULT 'hourly' CHECK (pay_basis IN ('hourly','salary')), note text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '', approved_by text, approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(employee_id, period_start)
);
-- Employee sign-off is distinct from manager approval. Actor and time come from the server.
ALTER TABLE timekeeping_sheet ADD COLUMN IF NOT EXISTS employee_signed_by text;
ALTER TABLE timekeeping_sheet ADD COLUMN IF NOT EXISTS employee_signed_name text;
ALTER TABLE timekeeping_sheet ADD COLUMN IF NOT EXISTS employee_signed_at timestamptz;
ALTER TABLE timekeeping_sheet ADD COLUMN IF NOT EXISTS employee_signed_version integer;
ALTER TABLE timekeeping_sheet ADD COLUMN IF NOT EXISTS employee_attestation text;
CREATE INDEX IF NOT EXISTS timekeeping_review_idx ON timekeeping_sheet(review_manager_id, period_start);
CREATE TABLE IF NOT EXISTS timekeeping_clock (
  employee_id uuid PRIMARY KEY REFERENCES timekeeping_employee(id), org_id text NOT NULL DEFAULT 'hdpm',
  version integer NOT NULL DEFAULT 1, shift jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS timekeeping_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL DEFAULT 'hdpm',
  employee_id uuid REFERENCES timekeeping_employee(id), sheet_id uuid REFERENCES timekeeping_sheet(id),
  actor text NOT NULL, action text NOT NULL, reason text NOT NULL DEFAULT '',
  before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS timekeeping_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL DEFAULT 'hdpm',
  period_start date NOT NULL REFERENCES timekeeping_period(start_date), version integer NOT NULL,
  snapshot jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(period_start, version)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['timekeeping_employee','timekeeping_period','timekeeping_sheet','timekeeping_clock','timekeeping_event','timekeeping_export'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS timekeeping_service_access ON %I', t);
    EXECUTE format('CREATE POLICY timekeeping_service_access ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION timekeeping_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Timekeeping history and exports are append-only'; END $$;
DROP TRIGGER IF EXISTS timekeeping_event_immutable ON timekeeping_event;
CREATE TRIGGER timekeeping_event_immutable BEFORE UPDATE OR DELETE ON timekeeping_event FOR EACH ROW EXECUTE FUNCTION timekeeping_immutable();
DROP TRIGGER IF EXISTS timekeeping_export_immutable ON timekeeping_export;
CREATE TRIGGER timekeeping_export_immutable BEFORE UPDATE OR DELETE ON timekeeping_export FOR EACH ROW EXECUTE FUNCTION timekeeping_immutable();

-- One serialized transaction per command is adequate for the small staff roster.
-- CAS versions still reject stale clients; the lock also protects exports from
-- concurrent approval, correction, enrollment and clock commands.
CREATE OR REPLACE FUNCTION timekeeping_apply(p_actor text, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a timekeeping_employee; e timekeeping_employee; s timekeeping_sheet; c timekeeping_clock;
  is_admin boolean; op text := p_request->>'op'; reason text := coalesce(p_request->>'reason','');
  old jsonb; item jsonb; result jsonb; current_id uuid; period date; export_version integer;
  today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
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
        AND (te.ends_on IS NULL OR te.ends_on >= pp.start_date) OR ts.id IS NOT NULL) AND (ts.id IS NULL OR ts.state <> 'approved' OR ts.employee_signed_at IS NULL)) THEN
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
    INSERT INTO timekeeping_clock(employee_id) VALUES(a.id) ON CONFLICT DO NOTHING;
    SELECT * INTO c FROM timekeeping_clock WHERE employee_id = a.id FOR UPDATE;
    IF c.version <> (p_request->>'clockVersion')::integer THEN RAISE EXCEPTION 'CONFLICT: clock changed on another device'; END IF;
    old := to_jsonb(c);
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_request->'sheets','[]'::jsonb)) LOOP
      SELECT * INTO s FROM timekeeping_sheet WHERE id = (item->>'id')::uuid FOR UPDATE;
      IF s.employee_id <> a.id OR s.id IS NULL OR s.state NOT IN ('draft','returned') THEN RAISE EXCEPTION 'Clock time overlaps a locked timesheet; ask your manager to reopen it'; END IF;
      IF s.version <> (item->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: timesheet changed'; END IF;
      INSERT INTO timekeeping_event(employee_id,sheet_id,actor,action,before_data,after_data)
        VALUES(a.id,s.id,p_actor,'clock',to_jsonb(s),item);
      UPDATE timekeeping_sheet SET days = item->'days', version = version+1, updated_at = now() WHERE id = s.id;
    END LOOP;
    UPDATE timekeeping_clock SET shift = nullif(p_request->'shift','null'::jsonb), version=version+1, updated_at=now() WHERE employee_id=a.id RETURNING * INTO c;
    INSERT INTO timekeeping_event(employee_id,actor,action,reason,before_data,after_data) VALUES(a.id,p_actor,'clock',reason,old,to_jsonb(c));
    RETURN to_jsonb(c);
  END IF;

  SELECT * INTO s FROM timekeeping_sheet WHERE id = (p_request->>'sheetId')::uuid FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO e FROM timekeeping_employee WHERE id = s.employee_id;
  SELECT id INTO current_id FROM timekeeping_sheet WHERE employee_id = a.id AND period_start <= today
    AND (state IN ('draft','returned') OR (period_start <= today AND period_end >= today))
    ORDER BY CASE WHEN state IN ('draft','returned') THEN 0 ELSE 1 END, period_start LIMIT 1;
  IF s.version <> (p_request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: another change was saved; reload before continuing'; END IF;
  old := to_jsonb(s);
  IF op IN ('save','submit') THEN
    IF NOT ((s.employee_id = a.id AND s.id = current_id AND a.enabled) OR (is_admin AND op='save' AND length(trim(reason))>0)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF s.state NOT IN ('draft','returned') THEN RAISE EXCEPTION 'This timesheet is locked'; END IF;
    IF EXISTS(SELECT 1 FROM timekeeping_clock WHERE employee_id=s.employee_id AND shift IS NOT NULL) THEN RAISE EXCEPTION 'Clock out before editing or submitting the sheet'; END IF;
    IF op = 'submit' AND (s.period_end > today OR e.manager_id IS NULL) THEN RAISE EXCEPTION 'Submit at the end of the period, after a reviewer is assigned'; END IF;
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
    IF s.employee_id=a.id OR s.review_manager_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'FORBIDDEN: only the assigned manager may review; no self-approval'; END IF;
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
  ELSE RAISE EXCEPTION 'Unknown timekeeping command'; END IF;
  INSERT INTO timekeeping_event(employee_id,sheet_id,actor,action,reason,before_data,after_data) VALUES(s.employee_id,s.id,p_actor,op,reason,old,to_jsonb(s));
  RETURN to_jsonb(s);
END $$;
REVOKE ALL ON FUNCTION timekeeping_apply(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION timekeeping_apply(text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
