-- ============================================
-- @habu/core 0008 — agent: the named seat-holder (§3, identity layer)
-- New schema. An agent that HOLDS a seat gets an identity: a name, a face, a
-- voice (persona), and declared expertise. seat.agent_id and agent_config.agent
-- reference agent.id (the stable key, e.g. 'estimate_chaser'). agent_config
-- still governs what it may DO (autonomy per action); this table governs who it
-- IS and how it speaks.
-- ============================================

CREATE TABLE IF NOT EXISTS agent (
  id TEXT NOT NULL,                    -- stable key: seat.agent_id / agent_config.agent
  org_id TEXT NOT NULL,
  display_name TEXT NOT NULL,          -- 'Casey'
  title TEXT,                          -- 'Vendor Estimate Chaser'
  avatar TEXT,                         -- emoji ('🤖') or icon url — Slack sender identity
  persona TEXT,                        -- voice/tone fragment injected into message composition
  expertise TEXT[] NOT NULL DEFAULT '{}',  -- descriptive skill tags (what it knows)
  model TEXT,                          -- LLM id used to compose its messages
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

ALTER TABLE agent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to agent" ON agent;
CREATE POLICY "Service role full access to agent" ON agent
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON agent TO service_role;

NOTIFY pgrst, 'reload schema';
