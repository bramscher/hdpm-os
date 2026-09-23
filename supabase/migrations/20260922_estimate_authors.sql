-- Scoped estimate drafting and template authoring; existing issue/approval permissions remain.
BEGIN;
CREATE OR REPLACE FUNCTION maintenance_template_publish(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE family uuid:=coalesce(nullif(request->>'family_id','')::uuid,gen_random_uuid()); n integer; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND (access_role IN ('admin','manager','pm','maintenance') OR (access_role IN ('staff','field') AND lower(email) IN ('alberto@highdesertpm.com','brody@highdesertpm.com','cheryl@highdesertpm.com')))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND (access_role IN ('admin','manager','pm','maintenance') OR (access_role IN ('staff','field') AND lower(email) IN ('alberto@highdesertpm.com','brody@highdesertpm.com','cheryl@highdesertpm.com')))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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
