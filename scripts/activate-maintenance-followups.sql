-- Run only after deployment, both migrations, and read-only preflight pass.
-- This enables human-reviewed sends and the Penny/Craig Slack trial.
-- It does not send a vendor/owner message by itself.
BEGIN;
DO $$
BEGIN
 IF (SELECT count(DISTINCT slack_user_id) FROM staff WHERE active
     AND lower(email) IN ('penny@highdesertpm.com','craig@highdesertpm.com')
     AND slack_user_id ~ '^[UW][A-Z0-9]+$') <> 2 THEN
  RAISE EXCEPTION 'Penny and Craig must each have an active staff record and Slack identity';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM agent_config WHERE agent='estimate_chaser' AND action_type='team_review') THEN RAISE EXCEPTION 'Missing shared review configuration'; END IF;
 IF to_regprocedure('followup_next_review(timestamp with time zone)') IS NULL
    OR to_regclass('maintenance_followup_slack') IS NULL THEN
  RAISE EXCEPTION 'Apply the shared chaser migrations first';
 END IF;
END $$;
INSERT INTO audit_event(subject_type,subject_id,event_type,actor,payload)
SELECT 'agent_config','estimate_chaser','shared_review_cutover','craig@highdesertpm.com',
 jsonb_build_object('before',coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb),
                   'reviewers',jsonb_build_array('penny@highdesertpm.com','craig@highdesertpm.com'))
FROM agent_config c WHERE agent='estimate_chaser';
UPDATE agent_config SET enabled=false
 WHERE agent='estimate_chaser' AND action_type IN ('vendor_chase','vendor_chase_sms','owner_approval');
UPDATE agent_config SET enabled=true
 WHERE agent='estimate_chaser' AND action_type='team_review';
-- Keep unsent legacy drafts/cards from dispatching alongside the shared queue.
UPDATE agent_outbox SET status='skipped',error='Superseded by Penny/Craig shared maintenance review; re-review in Company Issues'
 WHERE status='queued' AND proposal_id IN (
  SELECT id FROM agent_proposal WHERE agent='estimate_chaser'
   AND action_type IN ('vendor_chase','vendor_chase_sms','owner_approval')
 );
COMMIT;
