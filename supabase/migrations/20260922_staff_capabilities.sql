BEGIN;
CREATE TABLE IF NOT EXISTS staff_capability_policy (
 org_id text NOT NULL DEFAULT 'hdpm',
 person text PRIMARY KEY REFERENCES staff(person), overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
 version integer NOT NULL DEFAULT 1, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_capability_audit (
 org_id text NOT NULL DEFAULT 'hdpm',
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, person text NOT NULL REFERENCES staff(person),
 actor text NOT NULL, before_overrides jsonb NOT NULL, after_overrides jsonb NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE staff_capability_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_capability_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staff_capability_policy,staff_capability_audit FROM PUBLIC,anon,authenticated;
GRANT ALL ON staff_capability_policy,staff_capability_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE staff_capability_audit_id_seq TO service_role;
-- Preserve the explicitly approved access at cutover. Never overwrite later admin decisions.
INSERT INTO staff_capability_policy(person,overrides,updated_by)
SELECT person,CASE lower(email)
 WHEN 'alberto@highdesertpm.com' THEN '{"invoice.draft":true,"estimate.draft":true,"estimate.template":true}'::jsonb
 WHEN 'brody@highdesertpm.com' THEN '{"estimate.draft":true,"estimate.template":true}'::jsonb
 WHEN 'cheryl@highdesertpm.com' THEN '{"invoice.draft":true,"invoice.generate":true,"estimate.draft":true,"estimate.template":true}'::jsonb
 ELSE '{"invoice.draft":true,"invoice.generate":true}'::jsonb END,'migration:approved-access'
FROM staff WHERE active AND lower(email) IN ('alberto@highdesertpm.com','brody@highdesertpm.com','cheryl@highdesertpm.com','penny@highdesertpm.com')
ON CONFLICT(person) DO NOTHING;
CREATE OR REPLACE FUNCTION staff_effective_capabilities(identity text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE who staff; overrides jsonb; result jsonb; office boolean; k text;
BEGIN
 SELECT * INTO who FROM staff WHERE lower(email)=lower(identity) AND active;
 office:=coalesce(who.access_role IN ('admin','maintenance','pm','manager'),false);
 result:=jsonb_build_object('invoice.draft',office OR coalesce(who.access_role IN ('finance','field'),false),'invoice.generate',office OR coalesce(who.access_role='finance',false),'estimate.draft',office,'estimate.template',office,'estimate.issue',office);
 IF who.person IS NULL THEN RETURN result; END IF;
 SELECT p.overrides INTO overrides FROM staff_capability_policy p WHERE p.person=who.person;
 FOREACH k IN ARRAY ARRAY['invoice.draft','invoice.generate','estimate.draft','estimate.template','estimate.issue'] LOOP
  IF who.access_role='admin' THEN result:=jsonb_set(result,ARRAY[k],'true'::jsonb);
  ELSIF overrides ? k THEN result:=jsonb_set(result,ARRAY[k],overrides->k); END IF;
 END LOOP;
 IF NOT (result->>'invoice.draft')::boolean THEN result:=jsonb_set(result,'{invoice.generate}','false'::jsonb); END IF;
 IF NOT (result->>'estimate.draft')::boolean THEN result:=result||'{"estimate.template":false,"estimate.issue":false}'::jsonb; END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION staff_capability_update(actor text,request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target staff; previous staff_capability_policy; result jsonb; vals jsonb:=request->'overrides';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND access_role='admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO target FROM staff WHERE person=request->>'person';
 IF target.person IS NULL OR NOT target.active THEN RAISE EXCEPTION 'Choose active staff'; END IF;
 IF target.access_role='admin' THEN RAISE EXCEPTION 'Administrator access is managed by role'; END IF;
 IF jsonb_typeof(vals) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(vals) e WHERE e.key NOT IN ('invoice.draft','invoice.generate','estimate.draft','estimate.template','estimate.issue') OR jsonb_typeof(e.value)<>'boolean') THEN RAISE EXCEPTION 'Invalid capabilities'; END IF;
 IF length(trim(coalesce(request->>'reason','')))<3 OR length(request->>'reason')>1000 THEN RAISE EXCEPTION 'Add a reason for this change'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('staff-capability:'||target.person));
 SELECT * INTO previous FROM staff_capability_policy WHERE person=target.person FOR UPDATE;
 IF (request->>'version') IS NULL OR coalesce(previous.version,0)<>(request->>'version')::int THEN RAISE EXCEPTION 'CONFLICT: permissions changed; refresh before saving'; END IF;
 INSERT INTO staff_capability_policy(person,overrides,version,updated_by) VALUES(target.person,vals,coalesce(previous.version,0)+1,actor)
 ON CONFLICT(person) DO UPDATE SET overrides=excluded.overrides,version=excluded.version,updated_by=excluded.updated_by,updated_at=now() RETURNING to_jsonb(staff_capability_policy.*) INTO result;
 INSERT INTO staff_capability_audit(person,actor,before_overrides,after_overrides,reason) VALUES(target.person,actor,coalesce(previous.overrides,'{}'::jsonb),vals,request->>'reason');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION staff_effective_capabilities(text),staff_capability_update(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION staff_effective_capabilities(text),staff_capability_update(text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION maintenance_template_publish(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE family uuid:=coalesce(nullif(request->>'family_id','')::uuid,gen_random_uuid()); n integer; result jsonb;
BEGIN
 IF NOT coalesce((staff_effective_capabilities(actor)->>'estimate.template')::boolean,false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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
 IF NOT coalesce((staff_effective_capabilities(actor)->>'estimate.draft')::boolean,false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(rid::text));
 SELECT * INTO d FROM estimate_saved_draft WHERE id=rid FOR UPDATE;
 IF d.id IS NOT NULL AND d.version IS DISTINCT FROM (request->>'version')::int THEN RAISE EXCEPTION 'CONFLICT: draft was edited elsewhere; reload before saving'; END IF;
 INSERT INTO estimate_saved_draft(id,payload,template_id,created_by) VALUES(rid,request->'payload',nullif(request->>'template_id','')::uuid,actor)
 ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=estimate_saved_draft.version+1,updated_at=now(),template_id=excluded.template_id RETURNING to_jsonb(estimate_saved_draft.*) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION maintenance_template_publish(text,jsonb),maintenance_save_estimate_draft(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_template_publish(text,jsonb),maintenance_save_estimate_draft(text,jsonb) TO service_role;


COMMIT;
