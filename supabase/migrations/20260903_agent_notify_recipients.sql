-- Per-agent Slack notification recipients.
--
-- Until now, "who gets pinged in Slack" for each agent was scattered across the
-- *-run.ts files: some env-driven (estimate_chaser owner), most hardcoded
-- (morning_card = Cheryl/Brody/Matt, ops_brief = Brody/Matt/Craig, etc.). This
-- adds a per-(agent, action_type) recipient list to agent_config so it's editable
-- from the /agents page with no redeploy.
--
-- Convention: slack_recipients holds staff.person names, resolved to
-- slack_user_id at send time. ORDER MATTERS for cards that have a primary
-- (interactive, gets the buttons) + cc (read-only copies): element [0] is the
-- primary, the rest are copies (morning_card, ops_brief). NULL / empty array =
-- fall back to the agent's built-in default (keeps behavior unchanged).

ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS slack_recipients TEXT[];

-- Seed the currently-hardcoded lists so config is the source of truth from now on.
UPDATE agent_config SET slack_recipients = ARRAY['Cheryl','Brody','Matt']
  WHERE agent = 'morning_card' AND action_type = 'daily_card';

UPDATE agent_config SET slack_recipients = ARRAY['Brody','Matt','Craig']
  WHERE agent = 'ops_brief' AND action_type = 'send_brief';

UPDATE agent_config SET slack_recipients = ARRAY['Brody']
  WHERE agent = 'inspections' AND action_type = 'tenant_notice';

-- estimate_chaser/vendor_chase (the "Send text / Skip" queue card) is left NULL
-- on purpose: it stays governed by the owner/pilot env (ESTIMATE_CHASER_OWNER,
-- AGENT_PILOT_RECIPIENTS) until someone sets an explicit list here.

-- New rows for notify paths that had no config row of their own.
INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, max_per_day, owner_role, enabled, slack_recipients) VALUES
  ('estimate_chaser', 'escalate', 1, 2, 10, 'Cheryl', true, ARRAY['Brody','Matt']),
  ('dez',             'form_flag', 1, 2, NULL, 'Craig', true, ARRAY['Craig'])
ON CONFLICT (agent, action_type) DO NOTHING;
