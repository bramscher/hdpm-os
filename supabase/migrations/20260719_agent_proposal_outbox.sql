-- ============================================
-- Agent-OS Brief B: agent layer spine — proposals + outbox
-- Date: 2026-07-19
-- Run this migration manually in the Supabase SQL Editor.
--
-- agent_proposal generalizes the shipped ai_triage_proposal pattern
-- (docs/agent-os/00-DRAFT-master-plan.md Part 2): every agent output is a
-- row here first — simultaneously the audit trail, the approval queue, and
-- the training data for autonomy promotion. agent_outbox records every
-- outbound message behind the channel adapter interface (lib/agents/channels).
-- org_id is the multi-tenant seam (Q7): single org today, default 'hdpm'.
-- ============================================

CREATE TABLE IF NOT EXISTS agent_proposal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  agent TEXT NOT NULL,
  subject_type TEXT NOT NULL,          -- 'work_order' | 'inspection' | 'invoice' | ...
  subject_id TEXT,                     -- TEXT, not UUID: subjects span tables/external ids
  action_type TEXT NOT NULL,           -- matches agent_config.action_type
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT,                      -- the "why" line every message carries
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','edited','rejected','expired','auto_applied')),
  decided_by TEXT,                     -- human actor (staff name/email); never 'agent:*'
  decided_at TIMESTAMPTZ,
  channel_message_id TEXT,             -- Slack ts / message id once posted (Brief C)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_proposal_status ON agent_proposal (status);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_agent_action ON agent_proposal (agent, action_type);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_subject ON agent_proposal (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS agent_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
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
