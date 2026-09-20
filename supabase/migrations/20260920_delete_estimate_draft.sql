BEGIN;

CREATE OR REPLACE FUNCTION maintenance_delete_estimate_draft(actor text, request jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 rid uuid := (request->>'id')::uuid;
 draft_id uuid;
 e estimate;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND access_role IN ('admin','manager','pm','maintenance')) THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 IF request->>'kind' = 'saved' THEN
  draft_id := rid;
 ELSIF request->>'kind' = 'header' THEN
  SELECT source_saved_draft_id INTO draft_id FROM estimate WHERE id=rid;
 ELSE
  RAISE EXCEPTION 'Invalid draft kind';
 END IF;

 -- Match save/header lock order, then serialize with issuing the estimate.
 IF draft_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtext(draft_id::text));
  PERFORM 1 FROM estimate_saved_draft WHERE id=draft_id FOR UPDATE;
  SELECT * INTO e FROM estimate WHERE source_saved_draft_id=draft_id FOR UPDATE;
 ELSE
  SELECT * INTO e FROM estimate WHERE id=rid FOR UPDATE;
 END IF;
 IF e.id IS NOT NULL THEN
  IF e.status <> 'draft' OR e.current_version_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM estimate_version WHERE estimate_id=e.id)
     OR EXISTS(SELECT 1 FROM maintenance_task WHERE source_estimate_id=e.id) THEN
   RAISE EXCEPTION 'Only unissued draft estimates can be deleted. Refresh the estimates list.';
  END IF;
  DELETE FROM estimate WHERE id=e.id;
 END IF;
 IF draft_id IS NOT NULL THEN
  DELETE FROM estimate_saved_draft WHERE id=draft_id;
 END IF;
 INSERT INTO maintenance_workspace_audit(actor,op,entity_id,details)
 VALUES(actor,'delete_estimate_draft',rid,jsonb_build_object('kind',request->>'kind','estimate_id',e.id,'saved_draft_id',draft_id));
END $$;

REVOKE ALL ON FUNCTION maintenance_delete_estimate_draft(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_delete_estimate_draft(text,jsonb) TO service_role;
-- Prevent an already-open editor from recreating a deleted draft.
CREATE OR REPLACE FUNCTION maintenance_save_estimate_draft(actor text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d estimate_saved_draft; result jsonb; rid uuid:=(request->>'id')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND access_role IN ('admin','manager','pm','maintenance')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(rid::text));
 SELECT * INTO d FROM estimate_saved_draft WHERE id=rid FOR UPDATE;
 IF d.id IS NULL AND coalesce((request->>'version')::int,0) <> 0 THEN RAISE EXCEPTION 'CONFLICT: draft was deleted; start a new estimate'; END IF;
 IF d.id IS NOT NULL AND d.version IS DISTINCT FROM (request->>'version')::int THEN RAISE EXCEPTION 'CONFLICT: draft was edited elsewhere; reload before saving'; END IF;
 INSERT INTO estimate_saved_draft(id,payload,template_id,created_by) VALUES(rid,request->'payload',nullif(request->>'template_id','')::uuid,actor)
 ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=estimate_saved_draft.version+1,updated_at=now(),template_id=excluded.template_id RETURNING to_jsonb(estimate_saved_draft.*) INTO result;
 RETURN result;
END $$;
COMMIT;
