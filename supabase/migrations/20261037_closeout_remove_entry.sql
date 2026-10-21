-- Billing closeout: let the office remove a mistaken daily work entry.
-- maintenance_daily_billing_apply can add and edit entries but never delete them.
-- Project task records (task_id set) stay with the project work log and cannot be removed here.
BEGIN;
CREATE OR REPLACE FUNCTION maintenance_closeout_remove(actor text,record_id uuid,record_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE who staff; old maintenance_work_record;
BEGIN
 SELECT * INTO who FROM staff WHERE lower(email)=lower(actor) AND active LIMIT 1;
 IF who.person IS NULL OR NOT coalesce(who.access_role IN ('admin','manager','pm','maintenance','finance'),false) THEN RAISE EXCEPTION 'FORBIDDEN: office review required'; END IF;
 SELECT * INTO old FROM maintenance_work_record WHERE id=record_id FOR UPDATE;
 IF old.id IS NULL OR old.version IS DISTINCT FROM record_version THEN RAISE EXCEPTION 'CONFLICT: reload the changed record'; END IF;
 IF old.task_id IS NOT NULL THEN RAISE EXCEPTION 'Use the project work log for task records'; END IF;
 DELETE FROM maintenance_work_record WHERE id=record_id;
 INSERT INTO maintenance_workspace_audit(actor,op,entity_id,details) VALUES(actor,'closeout:remove',record_id,jsonb_build_object('before',to_jsonb(old)));
 RETURN to_jsonb(old);
END $$;
REVOKE ALL ON FUNCTION maintenance_closeout_remove(text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maintenance_closeout_remove(text,uuid,integer) TO service_role;
COMMIT;

-- Check: should return one row, maintenance_closeout_remove.
-- SELECT proname FROM pg_proc WHERE proname='maintenance_closeout_remove';
