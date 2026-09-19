-- Maintenance workspace. Additive; no legacy invoice dates or prices are inferred.
BEGIN;
CREATE TABLE IF NOT EXISTS maintenance_job (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid UNIQUE REFERENCES work_orders(id),
 property_name text NOT NULL, property_address text NOT NULL DEFAULT '', unit_name text,
 title text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','complete')),
 progress_billing boolean NOT NULL DEFAULT false, approval_note text NOT NULL DEFAULT '',
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS maintenance_task (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES maintenance_job(id),
 description text NOT NULL, item_code text, pricing_method text NOT NULL DEFAULT 'flat',
 invoice_type text NOT NULL DEFAULT 'labor' CHECK(invoice_type IN ('labor','materials','appliance','other')),
 amount numeric(12,2) NOT NULL CHECK(amount>=0), quantity numeric NOT NULL DEFAULT 1 CHECK(quantity>0),
 service_value numeric(12,2) NOT NULL DEFAULT 0 CHECK(service_value>=0 AND service_value<=amount),
 approved boolean NOT NULL DEFAULT false, approval_note text NOT NULL DEFAULT '',
 estimate_line_id uuid UNIQUE, source_estimate_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS maintenance_visit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES maintenance_job(id),
 technicians text[] NOT NULL CHECK(cardinality(technicians)>0), work_date date NOT NULL,
 start_minute integer NOT NULL CHECK(start_minute>=0 AND start_minute<1440),
 planned_minutes integer NOT NULL CHECK(planned_minutes>0 AND start_minute+planned_minutes<=1440),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','complete','cancelled')),
 source text NOT NULL DEFAULT 'local_plan' CHECK(source='local_plan'), note text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, created_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_work_record (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES maintenance_task(id),
 visit_id uuid REFERENCES maintenance_visit(id), technician text NOT NULL REFERENCES staff(person),
 work_date date NOT NULL, minutes integer NOT NULL CHECK(minutes>0 AND minutes<=960),
 progress text NOT NULL CHECK(progress IN ('done','partial','blocked')),
 note text NOT NULL DEFAULT '', materials text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','returned','reviewed','held')),
 review_note text NOT NULL DEFAULT '', review_owner text,
 version integer NOT NULL DEFAULT 1, created_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS maintenance_billing_allocation (
 task_id uuid PRIMARY KEY REFERENCES maintenance_task(id), invoice_id uuid NOT NULL REFERENCES hdms_invoices(id),
 amount numeric(12,2) NOT NULL CHECK(amount>=0), service_value numeric(12,2) NOT NULL CHECK(service_value>=0),
 benchmark numeric NOT NULL DEFAULT 95 CHECK(benchmark>0), created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS maintenance_workspace_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, op text NOT NULL,
 entity_id uuid, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS maintenance_target (
 technician text NOT NULL REFERENCES staff(person), effective_from date NOT NULL,
 benchmark numeric NOT NULL DEFAULT 95 CHECK(benchmark>0), min_hours numeric NOT NULL DEFAULT 6 CHECK(min_hours>=0),
 max_hours numeric NOT NULL DEFAULT 8 CHECK(max_hours>=min_hours), PRIMARY KEY(technician,effective_from)
);
CREATE TABLE IF NOT EXISTS estimate_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, version integer NOT NULL DEFAULT 1,
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array'), archived boolean NOT NULL DEFAULT false,
 family_id uuid NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(family_id,version)
);
CREATE TABLE IF NOT EXISTS estimate_saved_draft (
 id uuid PRIMARY KEY, payload jsonb NOT NULL, template_id uuid REFERENCES estimate_template(id),
 version integer NOT NULL DEFAULT 1, created_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hdms_invoices ADD COLUMN IF NOT EXISTS maintenance_job_id uuid REFERENCES maintenance_job(id);
CREATE INDEX IF NOT EXISTS maintenance_record_date ON maintenance_work_record(work_date,technician);
CREATE INDEX IF NOT EXISTS maintenance_record_review ON maintenance_work_record(status);
CREATE INDEX IF NOT EXISTS maintenance_visit_date ON maintenance_visit(work_date);
CREATE INDEX IF NOT EXISTS maintenance_task_job ON maintenance_task(job_id);
-- New tables are server-only: no permissive browser policies.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['maintenance_job','maintenance_task','maintenance_visit','maintenance_work_record','maintenance_billing_allocation','maintenance_workspace_audit','maintenance_target','estimate_template','estimate_saved_draft'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated',t);
 EXECUTE format('GRANT ALL ON %I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE maintenance_workspace_audit_id_seq TO service_role;

-- All mutations serialize at job/record level and resolve roles from active staff.
CREATE OR REPLACE FUNCTION maintenance_workspace_apply(actor text, request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE who staff; office boolean; op text:=request->>'op'; jid uuid; tid uuid; rid uuid;
 j maintenance_job; t maintenance_task; w maintenance_work_record; v maintenance_visit;
 inv hdms_invoices; result jsonb; people text[]; selected uuid[]; x uuid; lines jsonb;
 total numeric; service numeric; material numeric; from_date date; until_date date;
BEGIN
 SELECT * INTO who FROM staff WHERE lower(email)=lower(actor) AND active LIMIT 1;
 IF who.person IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: active staff account required'; END IF;
 office:=coalesce(who.access_role IN ('admin','manager','pm','maintenance','finance'),false);
 IF op IN ('record','submit') THEN
  rid:=(request->>'id')::uuid; tid:=(request->>'task_id')::uuid;
  SELECT * INTO t FROM maintenance_task WHERE id=tid;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  SELECT * INTO j FROM maintenance_job WHERE id=t.job_id FOR UPDATE;
  IF NOT office AND (coalesce(request->>'technician','')<>who.person OR NOT EXISTS(
   SELECT 1 FROM maintenance_visit WHERE job_id=j.id AND who.person=ANY(technicians) AND status<>'cancelled')) THEN
   RAISE EXCEPTION 'FORBIDDEN: only your assigned jobs';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM staff WHERE person=request->>'technician' AND active) THEN RAISE EXCEPTION 'Active technician required'; END IF;
  IF EXISTS(SELECT 1 FROM maintenance_billing_allocation WHERE task_id=tid) THEN RAISE EXCEPTION 'Billed work is locked; use the office correction workflow'; END IF;
  IF (request->>'work_date')::date>(now() AT TIME ZONE 'America/Los_Angeles')::date THEN RAISE EXCEPTION 'Work date cannot be in the future'; END IF;
  IF request->>'progress' IN ('partial','blocked') AND length(trim(coalesce(request->>'note','')))=0 THEN RAISE EXCEPTION 'Explain partial or blocked work'; END IF;
  IF nullif(request->>'visit_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM maintenance_visit WHERE id=(request->>'visit_id')::uuid AND job_id=j.id AND request->>'technician'=ANY(technicians)) THEN RAISE EXCEPTION 'Visit does not belong to this job and technician'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(request->>'technician'));
  IF (SELECT coalesce(sum(minutes),0) FROM maintenance_work_record WHERE technician=request->>'technician' AND work_date=(request->>'work_date')::date AND id<>rid)+(request->>'minutes')::int>1440 THEN RAISE EXCEPTION 'Recorded time exceeds a full day; check overlapping entries'; END IF;
  SELECT * INTO w FROM maintenance_work_record WHERE id=rid FOR UPDATE;
  IF w.id IS NOT NULL THEN
   IF w.task_id<>tid OR w.technician<>request->>'technician' THEN RAISE EXCEPTION 'Work record identity cannot change'; END IF;
   IF w.status='submitted' AND op='submit' AND w.version=(request->>'version')::int+1 THEN RETURN to_jsonb(w); END IF;
   IF w.status NOT IN ('draft','returned') THEN RAISE EXCEPTION 'Submitted work is locked until returned by office'; END IF;
   IF w.version IS DISTINCT FROM (request->>'version')::int THEN RAISE EXCEPTION 'CONFLICT: record changed; reload'; END IF;
  END IF;
  INSERT INTO maintenance_work_record(id,task_id,visit_id,technician,work_date,minutes,progress,note,materials,status,created_by)
   VALUES(rid,tid,nullif(request->>'visit_id','')::uuid,request->>'technician',(request->>'work_date')::date,(request->>'minutes')::int,request->>'progress',coalesce(request->>'note',''),coalesce(request->>'materials',''),CASE WHEN op='submit' THEN 'submitted' ELSE 'draft' END,actor)
  ON CONFLICT(id) DO UPDATE SET work_date=excluded.work_date,minutes=excluded.minutes,progress=excluded.progress,note=excluded.note,materials=excluded.materials,status=excluded.status,version=maintenance_work_record.version+1,updated_at=now()
  RETURNING to_jsonb(maintenance_work_record.*) INTO result;
 ELSIF NOT office THEN RAISE EXCEPTION 'FORBIDDEN: office review required';
 ELSIF op='job' THEN
  INSERT INTO maintenance_job(work_order_id,property_name,property_address,unit_name,title,created_by)
   SELECT id,property_name,coalesce(property_address,''),unit_name,description,actor FROM work_orders WHERE id=(request->>'work_order_id')::uuid
   ON CONFLICT(work_order_id) DO UPDATE SET work_order_id=excluded.work_order_id RETURNING to_jsonb(maintenance_job.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Work order not found'; END IF;
 ELSIF op='target' THEN
  INSERT INTO maintenance_target VALUES(request->>'technician',(request->>'effective_from')::date,(request->>'benchmark')::numeric,(request->>'min_hours')::numeric,(request->>'max_hours')::numeric);
  result:=request;
 ELSIF op='review' THEN
  SELECT * INTO w FROM maintenance_work_record WHERE id=(request->>'id')::uuid;
  SELECT * INTO t FROM maintenance_task WHERE id=w.task_id;
  PERFORM 1 FROM maintenance_job WHERE id=t.job_id FOR UPDATE;
  SELECT * INTO w FROM maintenance_work_record WHERE id=w.id FOR UPDATE;
  IF w.id IS NULL OR w.version IS DISTINCT FROM (request->>'version')::int THEN RAISE EXCEPTION 'CONFLICT: reload work record'; END IF;
  IF w.status NOT IN ('submitted','held') THEN RAISE EXCEPTION 'Record is not awaiting review'; END IF;
  IF request->>'status' NOT IN ('reviewed','returned','held') THEN RAISE EXCEPTION 'Invalid review decision'; END IF;
  IF request->>'status'<>'reviewed' AND length(trim(coalesce(request->>'note','')))=0 THEN RAISE EXCEPTION 'A question or hold reason is required'; END IF;
  UPDATE maintenance_work_record SET status=request->>'status',review_note=coalesce(request->>'note',''),review_owner=actor,version=version+1,updated_at=now() WHERE id=w.id RETURNING to_jsonb(maintenance_work_record.*) INTO result;
 ELSIF op IN ('task','import_estimate','visit','billing','release','job_settings') THEN
  jid:=(request->>'job_id')::uuid;
  SELECT * INTO j FROM maintenance_job WHERE id=jid FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF op='job_settings' THEN
   IF coalesce((request->>'progress_billing')::boolean,false) AND length(trim(coalesce(request->>'approval_note','')))=0 THEN RAISE EXCEPTION 'Record authorization for progress billing'; END IF;
   UPDATE maintenance_job SET progress_billing=(request->>'progress_billing')::boolean,approval_note=coalesce(request->>'approval_note','') WHERE id=jid RETURNING to_jsonb(maintenance_job.*) INTO result;
  ELSIF op='task' THEN
   IF length(trim(coalesce(request->>'approval_note','')))=0 THEN RAISE EXCEPTION 'Record scope and billing authorization'; END IF;
   IF EXISTS(SELECT 1 FROM maintenance_task WHERE job_id=jid AND pricing_method IN ('package','service_min')) OR (request->>'pricing_method' IN ('package','service_min') AND EXISTS(SELECT 1 FROM maintenance_task WHERE job_id=jid)) THEN RAISE EXCEPTION 'Package/minimum overlap: use a separately scoped job or an itemized approved estimate'; END IF;
   INSERT INTO maintenance_task(job_id,description,item_code,pricing_method,amount,service_value,quantity,approved,approval_note,invoice_type)
    VALUES(jid,request->>'description',request->>'item_code',request->>'pricing_method',(request->>'amount')::numeric,(request->>'service_value')::numeric,(request->>'quantity')::numeric,true,request->>'approval_note',coalesce(request->>'invoice_type','labor')) RETURNING to_jsonb(maintenance_task.*) INTO result;
  ELSIF op='import_estimate' THEN
   PERFORM pg_advisory_xact_lock(hashtext(request->>'estimate_id'));
   IF EXISTS(SELECT 1 FROM estimate e JOIN estimate_line l ON l.estimate_version_id=e.current_version_id WHERE e.id=(request->>'estimate_id')::uuid AND l.pricing_method IN ('package','allowance')) THEN RAISE EXCEPTION 'Itemize package or allowance scope before importing'; END IF;
   IF EXISTS(SELECT 1 FROM maintenance_task WHERE job_id=jid) THEN RAISE EXCEPTION 'Scope already exists. Add approved extra tasks explicitly; do not reimport revised estimates'; END IF;
   IF NOT EXISTS(SELECT 1 FROM estimate WHERE id=(request->>'estimate_id')::uuid AND status='approved' AND work_order_id=j.work_order_id) THEN RAISE EXCEPTION 'A current approved estimate for this work order is required'; END IF;
   IF EXISTS(SELECT 1 FROM hdms_invoices i JOIN estimate_version ev ON ev.id=i.source_estimate_version_id WHERE ev.estimate_id=(request->>'estimate_id')::uuid AND i.status<>'void') THEN RAISE EXCEPTION 'Estimate already converted to an invoice'; END IF;
   INSERT INTO maintenance_task(job_id,description,item_code,pricing_method,amount,service_value,quantity,approved,approval_note,estimate_line_id,source_estimate_id,invoice_type)
    SELECT jid,l.description,l.price_book_item_code,l.pricing_method,l.owner_extended+l.tax_amount,
    CASE WHEN l.category NOT IN ('coordination','materials','appliances') AND l.pricing_method<>'cost_plus' THEN l.owner_extended ELSE 0 END,
    l.qty,true,'Approved estimate',l.id,e.id,CASE WHEN l.category='appliances' THEN 'appliance' WHEN l.category='materials' OR l.pricing_method='cost_plus' THEN 'materials' WHEN l.category='coordination' THEN 'other' ELSE 'labor' END FROM estimate e JOIN estimate_line l ON l.estimate_version_id=e.current_version_id WHERE e.id=(request->>'estimate_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Estimate has no lines'; END IF;
   result:=jsonb_build_object('job_id',jid);
  ELSIF op='visit' THEN
   SELECT array_agg(value) INTO people FROM jsonb_array_elements_text(request->'technicians');
   IF people IS NULL OR EXISTS(SELECT 1 FROM unnest(people) p WHERE NOT EXISTS(SELECT 1 FROM staff WHERE person=p AND active)) THEN RAISE EXCEPTION 'Select active technicians'; END IF;
   -- Serialize schedules across jobs as well as edits of a single job.
   PERFORM pg_advisory_xact_lock(7192026);
   rid:=coalesce(nullif(request->>'id','')::uuid,gen_random_uuid());
   SELECT * INTO v FROM maintenance_visit WHERE id=rid FOR UPDATE;
   IF v.id IS NOT NULL AND (v.job_id<>jid OR v.version IS DISTINCT FROM (request->>'version')::int) THEN RAISE EXCEPTION 'CONFLICT: visit changed'; END IF;
   IF coalesce(request->>'status','planned')='planned' AND EXISTS(SELECT 1 FROM maintenance_visit WHERE id<>rid AND status='planned' AND technicians&&people AND work_date=(request->>'work_date')::date AND start_minute<(request->>'start_minute')::int+(request->>'planned_minutes')::int AND start_minute+planned_minutes>(request->>'start_minute')::int) THEN RAISE EXCEPTION 'Schedule conflict: technician already assigned during this time'; END IF;
   INSERT INTO maintenance_visit(id,job_id,technicians,work_date,start_minute,planned_minutes,status,note,created_by)
    VALUES(rid,jid,people,(request->>'work_date')::date,(request->>'start_minute')::int,(request->>'planned_minutes')::int,coalesce(request->>'status','planned'),coalesce(request->>'note',''),actor)
    ON CONFLICT(id) DO UPDATE SET technicians=excluded.technicians,work_date=excluded.work_date,start_minute=excluded.start_minute,planned_minutes=excluded.planned_minutes,status=excluded.status,note=excluded.note,version=maintenance_visit.version+1 RETURNING to_jsonb(maintenance_visit.*) INTO result;
  ELSIF op='release' THEN
   SELECT * INTO inv FROM hdms_invoices WHERE id=(request->>'invoice_id')::uuid AND maintenance_job_id=jid FOR UPDATE;
   IF inv.id IS NULL OR inv.status<>'draft' THEN RAISE EXCEPTION 'Only an unissued draft can be released'; END IF;
   PERFORM set_config('hdpm.workspace_billing','yes',true);
   DELETE FROM maintenance_billing_allocation WHERE invoice_id=inv.id;
   UPDATE hdms_invoices SET status='void' WHERE id=inv.id;
   result:=jsonb_build_object('released',inv.id);
  ELSIF op='billing' THEN
   SELECT array_agg(value::uuid) INTO selected FROM jsonb_array_elements_text(request->'task_ids');
   IF selected IS NULL OR cardinality(selected)=0 THEN RAISE EXCEPTION 'Select completed tasks'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(selected) s WHERE NOT EXISTS(SELECT 1 FROM maintenance_task WHERE id=s AND job_id=jid)) THEN RAISE EXCEPTION 'Task is outside this job'; END IF;
   -- Retries return the existing draft only if every selected task is already reserved together.
   IF (SELECT count(*) FROM maintenance_billing_allocation WHERE task_id=ANY(selected))=(SELECT count(DISTINCT s) FROM unnest(selected) s) THEN
    SELECT i.* INTO inv FROM hdms_invoices i WHERE i.id=(SELECT invoice_id FROM maintenance_billing_allocation WHERE task_id=selected[1]);
    IF NOT EXISTS(SELECT 1 FROM maintenance_billing_allocation WHERE task_id=ANY(selected) AND invoice_id<>inv.id) THEN RETURN to_jsonb(inv); END IF;
   END IF;
   FOREACH x IN ARRAY selected LOOP
    SELECT * INTO t FROM maintenance_task WHERE id=x;
    IF NOT t.approved OR EXISTS(SELECT 1 FROM maintenance_billing_allocation WHERE task_id=x) THEN RAISE EXCEPTION 'Task is unapproved or already billed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM maintenance_work_record WHERE task_id=x AND status='reviewed' AND progress='done') OR EXISTS(SELECT 1 FROM maintenance_work_record WHERE task_id=x AND status<>'reviewed') THEN RAISE EXCEPTION 'Review all work and finish the task before billing'; END IF;
   END LOOP;
   SELECT * INTO inv FROM hdms_invoices WHERE maintenance_job_id=jid AND status='draft' ORDER BY created_at LIMIT 1 FOR UPDATE;
   IF inv.id IS NULL THEN
    INSERT INTO hdms_invoices(property_name,property_address,description,work_order_id,maintenance_job_id,created_by)
     VALUES(j.property_name,j.property_address,j.title,j.work_order_id,jid,actor) RETURNING * INTO inv;
   END IF;
   INSERT INTO maintenance_billing_allocation(task_id,invoice_id,amount,service_value,created_by)
    SELECT id,inv.id,amount,service_value,actor FROM maintenance_task WHERE id=ANY(selected);
   SELECT jsonb_agg(jsonb_build_object('description',bt.description,'type',bt.invoice_type,'qty',bt.quantity,'unit_price',round(bt.amount/bt.quantity,2),'amount',bt.amount,'pricing_method',bt.pricing_method,'workspace_task_id',bt.id)),sum(a.amount),sum(CASE WHEN bt.invoice_type='labor' THEN a.amount ELSE 0 END),sum(CASE WHEN bt.invoice_type IN ('materials','appliance') THEN a.amount ELSE 0 END)
    INTO lines,total,service,material FROM maintenance_billing_allocation a JOIN maintenance_task bt ON bt.id=a.task_id WHERE a.invoice_id=inv.id;
   PERFORM set_config('hdpm.workspace_billing','yes',true);
   UPDATE hdms_invoices SET line_items=lines,total_amount=total,labor_amount=service,materials_amount=material WHERE id=inv.id RETURNING to_jsonb(hdms_invoices.*) INTO result;
  END IF;
 ELSE RAISE EXCEPTION 'Unknown operation'; END IF;
 INSERT INTO maintenance_workspace_audit(actor,op,entity_id,details) VALUES(actor,op,coalesce(jid,rid,tid),jsonb_build_object('request',request,'result',result));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION maintenance_workspace_apply(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_workspace_apply(text,jsonb) TO service_role;

-- Protect linked amounts from the legacy editor; issuing uses existing PDF/status paths.
CREATE OR REPLACE FUNCTION maintenance_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.maintenance_job_id IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Workspace invoice: release its unissued draft or void it; do not delete'; END IF;
  IF current_setting('hdpm.workspace_billing',true) IS DISTINCT FROM 'yes' AND
   (NEW.line_items IS DISTINCT FROM OLD.line_items OR NEW.total_amount<>OLD.total_amount OR NEW.labor_amount<>OLD.labor_amount OR NEW.materials_amount<>OLD.materials_amount OR NEW.maintenance_job_id IS DISTINCT FROM OLD.maintenance_job_id OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id) THEN RAISE EXCEPTION 'Edit linked billing in the maintenance workspace'; END IF;
  IF OLD.status<>'draft' AND NEW.status='draft' THEN RAISE EXCEPTION 'Issued workspace work is immutable; use credits or void'; END IF;
  IF OLD.status='draft' AND NEW.status IN ('generated','attached') AND NOT EXISTS(SELECT 1 FROM maintenance_job WHERE id=OLD.maintenance_job_id AND progress_billing) AND EXISTS(SELECT 1 FROM maintenance_task t WHERE t.job_id=OLD.maintenance_job_id AND NOT EXISTS(SELECT 1 FROM maintenance_billing_allocation a WHERE a.task_id=t.id)) THEN RAISE EXCEPTION 'Remaining scope: accumulate the draft or record progress-billing authorization'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS maintenance_invoice_guard ON hdms_invoices;
CREATE TRIGGER maintenance_invoice_guard BEFORE UPDATE OR DELETE ON hdms_invoices FOR EACH ROW EXECUTE FUNCTION maintenance_invoice_guard();

CREATE OR REPLACE FUNCTION maintenance_template_publish(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE family uuid:=coalesce(nullif(request->>'family_id','')::uuid,gen_random_uuid()); n integer; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND access_role IN ('admin','manager','pm','maintenance')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(family::text));
 SELECT coalesce(max(version),0) INTO n FROM estimate_template WHERE family_id=family;
 IF n<>coalesce((request->>'version')::int,0) THEN RAISE EXCEPTION 'CONFLICT: template has a newer version'; END IF;
 INSERT INTO estimate_template(name,entries,family_id,version,created_by) VALUES(request->>'name',request->'entries',family,n+1,actor) RETURNING to_jsonb(estimate_template.*) INTO result;
 INSERT INTO maintenance_workspace_audit(actor,op,details) VALUES(actor,'template_publish',result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION maintenance_save_estimate_draft(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d estimate_saved_draft; result jsonb; rid uuid:=(request->>'id')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND access_role IN ('admin','manager','pm','maintenance')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(rid::text));
 SELECT * INTO d FROM estimate_saved_draft WHERE id=rid FOR UPDATE;
 IF d.id IS NOT NULL AND d.version IS DISTINCT FROM (request->>'version')::int THEN RAISE EXCEPTION 'CONFLICT: draft was edited elsewhere; reload before saving'; END IF;
 INSERT INTO estimate_saved_draft(id,payload,template_id,created_by) VALUES(rid,request->'payload',nullif(request->>'template_id','')::uuid,actor)
 ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=estimate_saved_draft.version+1,updated_at=now(),template_id=excluded.template_id RETURNING to_jsonb(estimate_saved_draft.*) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION maintenance_template_publish(text,jsonb),maintenance_save_estimate_draft(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_template_publish(text,jsonb),maintenance_save_estimate_draft(text,jsonb) TO service_role;

-- Draft-to-estimate identity prevents repeated issue clicks creating another estimate.
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS source_saved_draft_id uuid UNIQUE REFERENCES estimate_saved_draft(id);
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES estimate_template(id);
CREATE OR REPLACE FUNCTION maintenance_estimate_header(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid:=(request->>'saved_draft_id')::uuid; d estimate_saved_draft; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(rid::text));
 SELECT * INTO d FROM estimate_saved_draft WHERE id=rid FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Save the draft before issuing'; END IF;
 INSERT INTO estimate(source_saved_draft_id,source_template_id,property_name,property_id,unit_name,unit_id,unit_turn_id,work_order_id,wo_number,authorization_limit,created_by)
 VALUES(rid,d.template_id,request->>'property_name',request->>'property_id',request->>'unit_name',request->>'unit_id',nullif(request->>'unit_turn_id','')::uuid,nullif(request->>'work_order_id','')::uuid,request->>'wo_number',nullif(request->>'authorization_limit','')::numeric,actor)
 ON CONFLICT(source_saved_draft_id) DO UPDATE SET source_saved_draft_id=excluded.source_saved_draft_id RETURNING to_jsonb(estimate.*) INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION maintenance_issue_estimate(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e estimate; v estimate_version; n integer; line jsonb; i integer:=0; result jsonb;
BEGIN
 SELECT * INTO e FROM estimate WHERE id=(request->>'estimate_id')::uuid FOR UPDATE;
 IF e.id IS NULL OR e.status='void' THEN RAISE EXCEPTION 'Estimate not available'; END IF;
 IF e.source_saved_draft_id IS NOT NULL AND e.current_version_id IS NOT NULL THEN
  SELECT * INTO v FROM estimate_version WHERE id=e.current_version_id;
  RETURN jsonb_build_object('version_id',v.id,'version_number',v.version_number,'owner_total',v.owner_total,'internal_cost_total',v.internal_cost_total,'margin',v.margin,'estimate_status',e.status,'authorization',CASE WHEN e.status='approved' THEN 'auto_approved' ELSE 'approval_pending' END);
 END IF;
 SELECT coalesce(max(version_number),0)+1 INTO n FROM estimate_version WHERE estimate_id=e.id;
 INSERT INTO estimate_version(estimate_id,version_number,status,owner_total,internal_cost_total,tenant_alloc_proposed_total,margin,priced_asof,notes,created_by)
 VALUES(e.id,n,'issued',(request->>'owner_total')::numeric,(request->>'internal_cost_total')::numeric,(request->>'tenant_alloc_proposed_total')::numeric,(request->>'margin')::numeric,(request->>'priced_asof')::date,request->>'notes',actor) RETURNING * INTO v;
 FOR line IN SELECT value FROM jsonb_array_elements(request->'lines') LOOP
  i:=i+1;
  INSERT INTO estimate_line(estimate_version_id,line_no,price_book_item_id,price_book_item_code,category,pricing_method,description,room,location,qty,uom,est_labor_hours,est_material_cost,internal_cost,owner_unit_price,owner_extended,tax_amount,tenant_alloc_proposed,responsibility,responsibility_rationale)
  VALUES(v.id,i,(line->>'price_book_item_id')::uuid,line->>'price_book_item_code',line->>'category',line->>'pricing_method',line->>'description',line->>'room',line->>'location',(line->>'qty')::numeric,line->>'uom',(line->>'est_labor_hours')::numeric,(line->>'est_material_cost')::numeric,(line->>'internal_cost')::numeric,(line->>'owner_unit_price')::numeric,(line->>'owner_extended')::numeric,(line->>'tax_amount')::numeric,(line->>'tenant_alloc_proposed')::numeric,line->>'responsibility',line->>'responsibility_rationale');
 END LOOP;
 IF i=0 THEN RAISE EXCEPTION 'No priced lines'; END IF;
 UPDATE estimate_version SET status='superseded' WHERE id=e.current_version_id;
 UPDATE estimate SET current_version_id=v.id,status=request->>'estimate_status' WHERE id=e.id;
 INSERT INTO maintenance_workspace_audit(actor,op,entity_id,details) VALUES(actor,'issue_estimate',e.id,jsonb_build_object('version_id',v.id,'owner_total',v.owner_total));
 RETURN jsonb_build_object('version_id',v.id,'version_number',n,'owner_total',v.owner_total,'internal_cost_total',v.internal_cost_total,'margin',v.margin,'estimate_status',request->>'estimate_status','authorization',request->>'authorization');
END $$;
REVOKE ALL ON FUNCTION maintenance_estimate_header(text,jsonb),maintenance_issue_estimate(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_estimate_header(text,jsonb),maintenance_issue_estimate(text,jsonb) TO service_role;
-- Block competing whole-estimate conversion after granular scope import, and across revisions.
CREATE OR REPLACE FUNCTION maintenance_estimate_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE eid uuid;
BEGIN
 IF NEW.source_estimate_version_id IS NOT NULL THEN
  SELECT estimate_id INTO eid FROM estimate_version WHERE id=NEW.source_estimate_version_id;
  PERFORM pg_advisory_xact_lock(hashtext(eid::text));
  IF EXISTS(SELECT 1 FROM maintenance_task WHERE source_estimate_id=eid) THEN RAISE EXCEPTION 'Estimate is tracked in the maintenance workspace; bill its completed tasks there'; END IF;
  IF EXISTS(SELECT 1 FROM hdms_invoices i JOIN estimate_version v ON v.id=i.source_estimate_version_id WHERE v.estimate_id=eid AND i.status<>'void' AND i.id<>NEW.id) THEN RAISE EXCEPTION 'An earlier estimate version is already billed'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS maintenance_estimate_invoice_guard ON hdms_invoices;
CREATE TRIGGER maintenance_estimate_invoice_guard BEFORE INSERT ON hdms_invoices FOR EACH ROW EXECUTE FUNCTION maintenance_estimate_invoice_guard();




-- Finalize only the exact snapshot rendered into the PDF, under the same job lock as billing.
CREATE OR REPLACE FUNCTION maintenance_finalize_invoice(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv hdms_invoices; jid uuid; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND access_role IN ('admin','manager','pm','maintenance','finance')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT maintenance_job_id INTO jid FROM hdms_invoices WHERE id=(request->>'id')::uuid;
 IF jid IS NULL THEN RAISE EXCEPTION 'Linked invoice not found'; END IF;
 PERFORM 1 FROM maintenance_job WHERE id=jid FOR UPDATE;
 SELECT * INTO inv FROM hdms_invoices WHERE id=(request->>'id')::uuid FOR UPDATE;
 IF inv.status<>'draft' THEN RAISE EXCEPTION 'Invoice is no longer a draft'; END IF;
 IF inv.line_items IS DISTINCT FROM request->'line_items' OR inv.total_amount IS DISTINCT FROM (request->>'total_amount')::numeric THEN RAISE EXCEPTION 'CONFLICT: draft changed during PDF generation; reload and generate again'; END IF;
 UPDATE hdms_invoices SET pdf_path=request->>'pdf_path',status='generated' WHERE id=inv.id RETURNING to_jsonb(hdms_invoices.*) INTO result;
 INSERT INTO maintenance_workspace_audit(actor,op,entity_id,details) VALUES(actor,'invoice_generated',inv.id,jsonb_build_object('total_amount',inv.total_amount));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION maintenance_finalize_invoice(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_finalize_invoice(text,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
