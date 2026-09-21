BEGIN;
CREATE TABLE IF NOT EXISTS estimate_followup_review (
 work_order_id uuid PRIMARY KEY REFERENCES work_orders(id),
 status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','snoozed','dismissed','sending','sent','uncertain')),
 version integer NOT NULL DEFAULT 1, next_review_at timestamptz,
 note text NOT NULL DEFAULT '', updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 channel text CHECK(channel IN ('email','sms_zoom')), recipient text, subject text, body text,
 attempt_id uuid, message_id text, error text
);
CREATE TABLE IF NOT EXISTS estimate_followup_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, work_order_id uuid NOT NULL REFERENCES work_orders(id),
 actor text NOT NULL, action text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE estimate_followup_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_followup_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON estimate_followup_review,estimate_followup_event FROM PUBLIC,anon,authenticated;
GRANT ALL ON estimate_followup_review,estimate_followup_event TO service_role;
GRANT USAGE,SELECT ON SEQUENCE estimate_followup_event_id_seq TO service_role;

CREATE OR REPLACE FUNCTION estimate_followup_decide(actor text, request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid := (request->>'id')::uuid; r estimate_followup_review; op text := request->>'op';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND access_role IN ('admin','maintenance','pm','manager')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('estimate-followup:'||rid::text));
 SELECT * INTO r FROM estimate_followup_review WHERE work_order_id=rid FOR UPDATE;
 IF coalesce(r.version,0) <> (request->>'version')::int OR request->>'version' IS NULL THEN RAISE EXCEPTION 'Another teammate updated this item. Refresh before continuing.'; END IF;
 IF op IN ('verified_sent','verified_unsent') THEN
  IF r.status NOT IN ('sending','uncertain') OR r.status IS NULL THEN RAISE EXCEPTION 'No uncertain delivery to resolve'; END IF;
  IF r.status='sending' AND r.updated_at>now()-interval '5 minutes' THEN RAISE EXCEPTION 'Allow the send to finish before checking delivery'; END IF;
  IF length(trim(coalesce(request->>'note','')))=0 THEN RAISE EXCEPTION 'Record how you checked delivery'; END IF;
  UPDATE estimate_followup_review SET status=CASE WHEN op='verified_sent' THEN 'sent' ELSE 'review' END,
   version=version+1,updated_by=actor,updated_at=now(),note=request->>'note',error=NULL,
   next_review_at=CASE WHEN op='verified_sent' THEN now()+interval '3 days' ELSE NULL END
  WHERE work_order_id=rid RETURNING * INTO r;
  INSERT INTO estimate_followup_event(work_order_id,actor,action,details) VALUES(rid,actor,op,to_jsonb(r));
  RETURN to_jsonb(r);
 END IF;
 IF r.status IN ('sending','uncertain') THEN RAISE EXCEPTION 'Check delivery history before taking another action on this message.'; END IF;
 IF op NOT IN ('send','snooze','dismiss','reopen') OR op IS NULL THEN RAISE EXCEPTION 'Invalid review action'; END IF;
 IF op='send' AND r.status='dismissed' THEN RAISE EXCEPTION 'Reopen this follow-up before sending'; END IF;
 IF op='send' AND r.next_review_at>now() THEN RAISE EXCEPTION 'This follow-up is not due yet. Reopen it first if a follow-up is needed now.'; END IF;
 IF op IN ('snooze','dismiss') AND length(trim(coalesce(request->>'note','')))=0 THEN RAISE EXCEPTION 'Add a note for the team'; END IF;
 INSERT INTO estimate_followup_review(work_order_id,updated_by) VALUES(rid,actor) ON CONFLICT DO NOTHING;
 UPDATE estimate_followup_review SET
  status=CASE op WHEN 'send' THEN 'sending' WHEN 'snooze' THEN 'snoozed' WHEN 'dismiss' THEN 'dismissed' ELSE 'review' END,
  version=coalesce(r.version,0)+1, updated_by=actor, updated_at=now(), note=coalesce(request->>'note',''),
  next_review_at=CASE WHEN op='snooze' THEN now()+interval '3 days' ELSE NULL END,
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

CREATE OR REPLACE FUNCTION estimate_followup_finish(request jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r estimate_followup_review;
BEGIN
 UPDATE estimate_followup_review SET
  status=CASE WHEN request->>'status'='sent' THEN 'sent' WHEN request->>'status'='skipped' THEN 'review' ELSE 'uncertain' END,
  message_id=request->>'message_id',error=request->>'error',updated_at=now(),version=version+1,
  next_review_at=CASE WHEN request->>'status'='sent' THEN now()+interval '3 days' ELSE NULL END
 WHERE work_order_id=(request->>'id')::uuid AND attempt_id=(request->>'attempt_id')::uuid AND status='sending'
 RETURNING * INTO r;
 IF r.work_order_id IS NULL THEN RAISE EXCEPTION 'Delivery result could not be recorded'; END IF;
 INSERT INTO estimate_followup_event(work_order_id,actor,action,details) VALUES(r.work_order_id,r.updated_by,'delivery',to_jsonb(r));
END $$;
REVOKE ALL ON FUNCTION estimate_followup_decide(text,jsonb),estimate_followup_finish(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION estimate_followup_decide(text,jsonb),estimate_followup_finish(jsonb) TO service_role;

-- Route new follow-ups to the shared review queue instead of the legacy draft/card runs.
INSERT INTO agent_config(agent,action_type,autonomy_level,ceiling_level,enabled,owner_role)
VALUES('estimate_chaser','team_review',2,2,false,'maintenance')
ON CONFLICT(agent,action_type) DO NOTHING;
COMMIT;
