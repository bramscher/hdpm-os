BEGIN;
ALTER TABLE estimate_followup_review ADD COLUMN IF NOT EXISTS episode_key text;
-- Apply after 20260920_estimate_followup_review.sql; neither migration enables sends.
ALTER TABLE estimate_followup_review DROP CONSTRAINT IF EXISTS estimate_followup_review_status_check;
ALTER TABLE estimate_followup_review ADD CONSTRAINT estimate_followup_review_status_check
 CHECK(status IN ('review','snoozed','dismissed','sending','sent','uncertain','help'));
CREATE OR REPLACE FUNCTION followup_next_review(anchor timestamptz) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE d date := (anchor AT TIME ZONE 'America/Los_Angeles')::date; n int := 0;
BEGIN
 WHILE n < 3 LOOP
  d := d+1;
  IF extract(isodow FROM d) < 6 THEN n := n+1; END IF;
 END LOOP;
 RETURN (d+time '08:00') AT TIME ZONE 'America/Los_Angeles';
END $$;
CREATE OR REPLACE FUNCTION estimate_followup_decide(actor text, request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid := (request->>'id')::uuid; r estimate_followup_review; op text := request->>'op';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE lower(email)=lower(actor) AND active AND lower(email) IN ('penny@highdesertpm.com','craig@highdesertpm.com')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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

CREATE OR REPLACE FUNCTION estimate_followup_finish(request jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r estimate_followup_review;
BEGIN
 UPDATE estimate_followup_review SET
  status=CASE WHEN request->>'status'='sent' THEN 'sent' WHEN request->>'status'='skipped' THEN 'review' ELSE 'uncertain' END,
  message_id=request->>'message_id',error=request->>'error',updated_at=now(),version=version+1,
  next_review_at=CASE WHEN request->>'status'='sent' THEN followup_next_review(now()) ELSE NULL END
 WHERE work_order_id=(request->>'id')::uuid AND attempt_id=(request->>'attempt_id')::uuid AND status='sending'
 RETURNING * INTO r;
 IF r.work_order_id IS NULL THEN RAISE EXCEPTION 'Delivery result could not be recorded'; END IF;
 INSERT INTO estimate_followup_event(work_order_id,actor,action,details) VALUES(r.work_order_id,r.updated_by,'delivery',to_jsonb(r));
END $$;
REVOKE ALL ON FUNCTION estimate_followup_decide(text,jsonb),estimate_followup_finish(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION estimate_followup_decide(text,jsonb),estimate_followup_finish(jsonb) TO service_role;


-- One persistent item thread per reviewer/WO, and one summary per reviewer/day.
-- An ambiguous initial post is retained as uncertain, never automatically resent.
CREATE TABLE IF NOT EXISTS maintenance_followup_slack (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewer_email text NOT NULL,
 message_key text NOT NULL, work_order_id uuid REFERENCES work_orders(id),
 state text NOT NULL DEFAULT 'sending' CHECK(state IN ('sending','sent','uncertain')),
 message_id text, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_email,message_key)
);
ALTER TABLE maintenance_followup_slack ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON maintenance_followup_slack FROM PUBLIC,anon,authenticated;
GRANT ALL ON maintenance_followup_slack TO service_role;
REVOKE ALL ON FUNCTION followup_next_review(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION followup_next_review(timestamptz) TO service_role;
COMMIT;
