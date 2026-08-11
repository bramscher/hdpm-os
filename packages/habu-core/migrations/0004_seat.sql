-- ============================================
-- @habu/core 0004 — seat: the accountability chart (HABU primitive 1, §3)
-- Generalized from hdpm-os 20260804_eos_core.sql (seat portion only). The rest
-- of the EOS operating layer (scorecard/issues/meetings/rocks) is NOT part of
-- core v1's four primitives and is not ported here.
--
-- §3: HABU allows agents *as* seat-holders. An agent seat MUST name a human
-- escalation seat — enforced in app logic (lib eos validateSeats) and by the
-- partial CHECK below.
-- ============================================

CREATE TABLE IF NOT EXISTS seat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,                          -- 'Maintenance Coordinator'
  roles TEXT[] NOT NULL DEFAULT '{}',
  reports_to_seat_id UUID REFERENCES seat(id) ON DELETE SET NULL,
  holder_type TEXT NOT NULL DEFAULT 'open'
    CHECK (holder_type IN ('human','agent','open')),
  person_id TEXT REFERENCES staff(person) ON DELETE SET NULL,  -- when human
  agent_id TEXT,                               -- when agent (agent_config.agent)
  escalation_seat_id UUID REFERENCES seat(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort INT NOT NULL DEFAULT 0,
  -- Agent seats must name an escalation seat; holder id must match holder_type.
  CONSTRAINT seat_agent_needs_escalation CHECK (
    holder_type <> 'agent' OR escalation_seat_id IS NOT NULL
  ),
  CONSTRAINT seat_holder_fields CHECK (
    (holder_type = 'human' AND person_id IS NOT NULL AND agent_id IS NULL) OR
    (holder_type = 'agent' AND agent_id IS NOT NULL AND person_id IS NULL) OR
    (holder_type = 'open'  AND person_id IS NULL AND agent_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_seat_org ON seat (org_id);
CREATE INDEX IF NOT EXISTS idx_seat_parent ON seat (reports_to_seat_id);

ALTER TABLE seat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to seat" ON seat;
CREATE POLICY "Service role full access to seat" ON seat
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON seat TO service_role;

NOTIFY pgrst, 'reload schema';
