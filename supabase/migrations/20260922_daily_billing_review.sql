-- Daily closeout extends the canonical work log; payroll records are untouched.
BEGIN;
ALTER TABLE maintenance_work_record ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE maintenance_work_record ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES work_orders(id);
ALTER TABLE maintenance_work_record ADD COLUMN IF NOT EXISTS activity_kind text NOT NULL DEFAULT 'job';
ALTER TABLE maintenance_work_record ADD COLUMN IF NOT EXISTS billability text NOT NULL DEFAULT 'review';
ALTER TABLE maintenance_work_record ADD COLUMN IF NOT EXISTS review_due date;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='maintenance_record_activity_kind') THEN
 ALTER TABLE maintenance_work_record ADD CONSTRAINT maintenance_record_activity_kind CHECK(activity_kind IN ('job','travel','parts','shop','callback','other'));
 ALTER TABLE maintenance_work_record ADD CONSTRAINT maintenance_record_billability CHECK(billability IN ('review','billable','nonbillable'));
 ALTER TABLE maintenance_work_record ADD CONSTRAINT maintenance_record_job_link CHECK(activity_kind<>'job' OR task_id IS NOT NULL OR work_order_id IS NOT NULL);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS maintenance_billing_review (
 issue_key text PRIMARY KEY, disposition text NOT NULL CHECK(disposition IN ('deferred','not_billable','resolved')),
 owner text NOT NULL REFERENCES staff(person), review_on date NOT NULL, note text NOT NULL CHECK(length(trim(note))>0),
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE maintenance_billing_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON maintenance_billing_review FROM anon,authenticated;
GRANT ALL ON maintenance_billing_review TO service_role;
CREATE INDEX IF NOT EXISTS maintenance_record_wo ON maintenance_work_record(work_order_id);

CREATE OR REPLACE FUNCTION maintenance_daily_billing_apply(actor text,request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE who staff; office boolean; rid uuid; old maintenance_work_record; result jsonb; tech_person text; d date; n integer; key text; target uuid;
BEGIN
 SELECT * INTO who FROM staff WHERE lower(email)=lower(actor) AND active LIMIT 1;
 IF who.person IS NULL OR who.access_role IN ('read_only','inspector','front_desk') THEN RAISE EXCEPTION 'FORBIDDEN: active maintenance staff required'; END IF;
 office:=coalesce(who.access_role IN ('admin','manager','pm','maintenance','finance') OR (who.access_role='staff' AND lower(who.email) IN ('cheryl@highdesertpm.com','penny@highdesertpm.com')),false);
 IF request->>'op'='record' THEN
  rid:=(request->>'id')::uuid; tech_person:=coalesce(nullif(request->>'technician',''),who.person); d:=(request->>'work_date')::date; n:=(request->>'minutes')::integer;
  IF NOT office AND tech_person<>who.person THEN RAISE EXCEPTION 'FORBIDDEN: record only your own work'; END IF;
  IF NOT EXISTS(SELECT 1 FROM staff WHERE staff.person=tech_person AND active) THEN RAISE EXCEPTION 'Active technician required'; END IF;
  IF d IS NULL OR d>(now() AT TIME ZONE 'America/Los_Angeles')::date OR n IS NULL OR n<1 OR n>960 THEN RAISE EXCEPTION 'Check work date and minutes (1–960)'; END IF;
  IF nullif(trim(request->>'note'),'') IS NULL THEN RAISE EXCEPTION 'Describe the work or activity'; END IF;
  IF request->>'status' NOT IN ('draft','submitted') THEN RAISE EXCEPTION 'Save as draft or submit for review'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(tech_person));
  SELECT * INTO old FROM maintenance_work_record WHERE id=rid FOR UPDATE;
  IF old.id IS NOT NULL THEN
   IF old.task_id IS NOT NULL THEN RAISE EXCEPTION 'Use the project work log for task records'; END IF;
   IF old.technician<>tech_person OR old.work_order_id IS DISTINCT FROM nullif(request->>'work_order_id','')::uuid THEN RAISE EXCEPTION 'Record identity cannot change'; END IF;
   IF old.version IS DISTINCT FROM (request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload the changed record'; END IF;
   IF old.status NOT IN ('draft','returned') THEN RAISE EXCEPTION 'Submitted records must be returned before editing'; END IF;
  END IF;
  IF (SELECT coalesce(sum(minutes),0) FROM maintenance_work_record WHERE technician=tech_person AND work_date=d AND id<>rid)+n>1440 THEN RAISE EXCEPTION 'Recorded time exceeds a full day'; END IF;
  INSERT INTO maintenance_work_record(id,task_id,work_order_id,technician,work_date,minutes,activity_kind,progress,note,materials,status,created_by)
  VALUES(rid,NULL,nullif(request->>'work_order_id','')::uuid,tech_person,d,n,coalesce(request->>'activity_kind','job'),coalesce(request->>'progress','done'),trim(request->>'note'),coalesce(request->>'materials',''),request->>'status',actor)
  ON CONFLICT(id) DO UPDATE SET work_date=excluded.work_date,minutes=excluded.minutes,activity_kind=excluded.activity_kind,progress=excluded.progress,note=excluded.note,materials=excluded.materials,status=excluded.status,billability='review',review_note='',review_owner=NULL,review_due=NULL,version=maintenance_work_record.version+1,updated_at=now()
  RETURNING to_jsonb(maintenance_work_record.*) INTO result;
 ELSIF NOT office THEN RAISE EXCEPTION 'FORBIDDEN: office review required';
 ELSIF request->>'op'='review' THEN
  rid:=(request->>'id')::uuid;
  SELECT * INTO old FROM maintenance_work_record WHERE id=rid FOR UPDATE;
  IF old.id IS NULL OR old.version IS DISTINCT FROM (request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload the changed record'; END IF;
  IF old.task_id IS NOT NULL THEN RAISE EXCEPTION 'Use project review for scoped task records'; END IF;
  IF old.status NOT IN ('submitted','held','reviewed') THEN RAISE EXCEPTION 'Submit work before reviewing it'; END IF;
  IF old.task_id IS NOT NULL AND EXISTS(SELECT 1 FROM maintenance_billing_allocation WHERE task_id=old.task_id) THEN RAISE EXCEPTION 'Billed task is locked; use project corrections'; END IF;
  IF request->>'status' NOT IN ('reviewed','held','returned') OR request->>'billability' NOT IN ('billable','nonbillable','review') THEN RAISE EXCEPTION 'Invalid review decision'; END IF;
  IF request->>'status'='reviewed' AND request->>'billability'='review' THEN RAISE EXCEPTION 'Choose billable or not billable, or hold for follow-up'; END IF;
  IF nullif(trim(request->>'note'),'') IS NULL THEN RAISE EXCEPTION 'Review reason required'; END IF;
  IF request->>'status'='held' AND nullif(request->>'review_due','') IS NULL THEN RAISE EXCEPTION 'A held item needs a review date'; END IF;
  UPDATE maintenance_work_record SET status=request->>'status',billability=request->>'billability',review_note=request->>'note',review_owner=who.person,review_due=nullif(request->>'review_due','')::date,version=version+1,updated_at=now() WHERE id=rid RETURNING to_jsonb(maintenance_work_record.*) INTO result;
 ELSIF request->>'op'='disposition' THEN
  key:=request->>'issue_key';
  IF key !~ '^(wo|invoice|record):[0-9a-fA-F-]{36}:[a-z_]+$' THEN RAISE EXCEPTION 'Invalid billing item'; END IF;
  target:=split_part(key,':',2)::uuid;
  IF (split_part(key,':',1)='wo' AND NOT EXISTS(SELECT 1 FROM work_orders WHERE id=target)) OR (split_part(key,':',1)='invoice' AND NOT EXISTS(SELECT 1 FROM hdms_invoices WHERE id=target)) OR (split_part(key,':',1)='record' AND NOT EXISTS(SELECT 1 FROM maintenance_work_record WHERE id=target)) THEN RAISE EXCEPTION 'Billing item not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM staff WHERE staff.person=request->>'owner' AND active) THEN RAISE EXCEPTION 'Active review owner required'; END IF;
  INSERT INTO maintenance_billing_review(issue_key,disposition,owner,review_on,note,updated_by)
  VALUES(key,request->>'disposition',request->>'owner',(request->>'review_on')::date,trim(request->>'note'),actor)
  ON CONFLICT(issue_key) DO UPDATE SET disposition=excluded.disposition,owner=excluded.owner,review_on=excluded.review_on,note=excluded.note,updated_by=actor,updated_at=now()
  RETURNING to_jsonb(maintenance_billing_review.*) INTO result;
 ELSE RAISE EXCEPTION 'Unknown daily billing action'; END IF;
 INSERT INTO maintenance_workspace_audit(actor,op,entity_id,details) VALUES(actor,'daily_billing:'||(request->>'op'),rid,jsonb_build_object('before',to_jsonb(old),'after',result));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION maintenance_daily_billing_apply(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_daily_billing_apply(text,jsonb) TO service_role;
COMMIT;
