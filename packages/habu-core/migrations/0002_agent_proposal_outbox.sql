-- ============================================
-- @habu/core 0002 — agent layer spine: proposals + outbox
-- Ported from hdpm-os 20260719_agent_proposal_outbox.sql.
--
-- agent_proposal: every agent output is a row here first — audit trail,
-- approval queue, and autonomy-promotion training data in one. agent_outbox:
-- every outbound message behind the channel-adapter interface. org_id is the
-- multi-tenant seam and is REQUIRED (no default — the tenant supplies it,
-- unlike hdpm-os which defaulted 'hdpm').
-- ============================================

CREATE TABLE IF NOT EXISTS agent_proposal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  subject_type TEXT NOT NULL,          -- 'work_order' | 'jacket' | 'unit' | ...
  subject_id TEXT,                     -- TEXT, not UUID: subjects span tables/external ids
  action_type TEXT NOT NULL,           -- matches agent_config.action_type
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT,                      -- the "why" line every message carries
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','edited','rejected','expired','auto_applied')),
  decided_by TEXT,                     -- human actor (staff name/email); never 'agent:*'
  decided_at TIMESTAMPTZ,
  channel_message_id TEXT,             -- Slack ts / message id once posted
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_proposal_status ON agent_proposal (status);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_agent_action ON agent_proposal (agent, action_type);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_subject ON agent_proposal (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS agent_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  proposal_id UUID REFERENCES agent_proposal(id) ON DELETE SET NULL,
  channel TEXT NOT NULL
    CHECK (channel IN ('slack','sms_zoom','outlook_draft','email','in_app')),
  recipient_person TEXT,               -- staff.person when known
  recipient_address TEXT,              -- email address / E.164 phone / slack id
  subject TEXT,
  body TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,   -- channel extras (html, blocks, ...)
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','failed','skipped')),
  attempts INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  message_id TEXT,                     -- provider id (Resend id, Slack ts, ...)
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_outbox_queue ON agent_outbox (status, channel);
CREATE INDEX IF NOT EXISTS idx_agent_outbox_proposal ON agent_outbox (proposal_id);

ALTER TABLE agent_proposal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to agent_proposal" ON agent_proposal;
CREATE POLICY "Service role full access to agent_proposal" ON agent_proposal
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON agent_proposal TO service_role;

ALTER TABLE agent_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to agent_outbox" ON agent_outbox;
CREATE POLICY "Service role full access to agent_outbox" ON agent_outbox
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON agent_outbox TO service_role;

NOTIFY pgrst, 'reload schema';
