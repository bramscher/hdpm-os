-- The Morning 7: the follow-up team is whoever is assigned to estimate_chaser/team_review
-- on the Agents page (agent_config.slack_recipients, staff person names), else Brody + Craig.
-- Replaces the hard-coded Penny/Craig check in estimate_followup_decide; body otherwise unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION estimate_followup_decide(actor text, request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid := (request->>'id')::uuid; r estimate_followup_review; op text := request->>'op';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff s WHERE lower(s.email)=lower(actor) AND s.active AND s.person = ANY(coalesce(
   (SELECT nullif(c.slack_recipients,'{}') FROM agent_config c WHERE c.agent='estimate_chaser' AND c.action_type='team_review'),
   ARRAY['Brody','Craig']))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('estimate-followup:'||rid::text));
 SELECT * INTO r FROM estimate_followup_review WHERE work_order_id=rid FOR UPDATE;
 IF coalesce(r.version,0) <> (request->>'version')::int OR request->>'version' IS NULL THEN RAISE EXCEPTION 'Another teammate updated this item. Refresh before continuing.'; END IF;
 IF op IN ('verified_sent','verified_unsent') THEN
  IF r.status NOT IN ('sending','uncertain') OR r.status IS NULL THEN RAISE EXCEPTION 'No uncertain delivery to resolve'; END IF;
  IF r.status='sending' AND r.updated_at>now()-interval '5 minutes' THEN RAISE EXCEPTION 'Allow the send to finish before checking delivery'; END IF;
  IF length(trim(coalesce(request->>'note','')))=0 THEN RAISE EXCEPTION 'Record how you checked delivery'; END IF;
  UPDATE estimate_followup_review SET status=CASE WHEN op='verified_sent' THEN 'sent' ELSE 'review' END,
   version=version+1,updated_by=actor,updated_at=now(),note=request->>'note',error=NULL,
   next_review_at=CASE WHEN op='verified_sent' THEN followup_next_review(now()) ELSE NULL END
  WHERE work_order_id=rid RETURNING * INTO r;
  INSERT INTO estimate_followup_event(work_order_id,actor,action,details) VALUES(rid,actor,op,to_jsonb(r));
  RETURN to_jsonb(r);
 END IF;
 IF r.status IN ('sending','uncertain') THEN RAISE EXCEPTION 'Check delivery history before taking another action on this message.'; END IF;
 IF op NOT IN ('send','snooze','dismiss','reopen','note','help','reassign') OR op IS NULL THEN RAISE EXCEPTION 'Invalid review action'; END IF;
 IF op='send' AND r.status IN ('dismissed','help') THEN RAISE EXCEPTION 'Reopen this follow-up before sending'; END IF;
 IF op='send' AND r.next_review_at>now() THEN RAISE EXCEPTION 'This follow-up is not due yet. Reopen it first if a follow-up is needed now.'; END IF;
 IF op IN ('snooze','dismiss','note','help','reassign') AND length(trim(coalesce(request->>'note','')))=0 THEN RAISE EXCEPTION 'Add a note for the team'; END IF;
 IF op='reassign' THEN
  IF NOT EXISTS(SELECT 1 FROM staff WHERE person=request->>'owner_person' AND active) THEN RAISE EXCEPTION 'Choose an active HDPM owner'; END IF;
  UPDATE work_orders SET owner_name=request->>'owner_person',
   next_action_date=coalesce((request->>'next_review_date')::date,(followup_next_review(now()) AT TIME ZONE 'America/Los_Angeles')::date)
  WHERE id=rid;
  INSERT INTO wo_event(work_order_id,event_type,actor,payload) VALUES(rid,'assign',actor,
   jsonb_build_object('owner_name',request->>'owner_person','source','maintenance_followup','note',request->>'note'));
 END IF;
 INSERT INTO estimate_followup_review(work_order_id,updated_by) VALUES(rid,actor) ON CONFLICT DO NOTHING;
 UPDATE estimate_followup_review SET
  status=CASE op WHEN 'send' THEN 'sending' WHEN 'snooze' THEN 'snoozed' WHEN 'dismiss' THEN 'dismissed' WHEN 'help' THEN 'help' WHEN 'note' THEN CASE WHEN r.status IN ('help','dismissed') THEN r.status ELSE 'snoozed' END ELSE 'review' END,
  episode_key=coalesce(request->>'episode_key',episode_key),
  version=coalesce(r.version,0)+1, updated_by=actor, updated_at=now(), note=coalesce(request->>'note',''),
  next_review_at=CASE WHEN op IN ('snooze','note') THEN coalesce(((request->>'next_review_date')::date+time '08:00') AT TIME ZONE 'America/Los_Angeles',(request->>'next_review_at')::timestamptz,followup_next_review(now())) ELSE NULL END,
  channel=CASE WHEN op='send' THEN request->>'channel' ELSE channel END,
  recipient=CASE WHEN op='send' THEN request->>'recipient' ELSE recipient END,
  subject=CASE WHEN op='send' THEN request->>'subject' ELSE subject END,
  body=CASE WHEN op='send' THEN request->>'body' ELSE body END,
  attempt_id=CASE WHEN op='send' THEN gen_random_uuid() ELSE attempt_id END,
  error=NULL
 WHERE work_order_id=rid RETURNING * INTO r;
 INSERT INTO estimate_followup_event(work_order_id,actor,action,details) VALUES(rid,actor,op,to_jsonb(r));
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION estimate_followup_decide(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION estimate_followup_decide(text,jsonb) TO service_role;
COMMIT;
