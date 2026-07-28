-- Reception call report: one row per main-line inbound call (classified by
-- who answered it) plus one row per Haven→Zoom transfer leg. Populated by
-- /api/reception/sync from Zoom Phone call history.

CREATE TABLE IF NOT EXISTS reception_call (
  call_id text PRIMARY KEY,               -- Zoom call_history id
  kind text NOT NULL DEFAULT 'inbound',   -- 'inbound' (main-line call) | 'haven_transfer' (Haven → Zoom leg)
  started_at timestamptz NOT NULL,
  call_date date NOT NULL,                -- Pacific-time date for daily grouping
  caller_number text,
  caller_name text,
  answered_by text NOT NULL,              -- 'ashley' | 'staff' | 'haven' | 'missed'
  answered_by_name text,                  -- staff display name when a person answered
  haven_path text,                        -- 'direct' | 'overflow' (rang Ashley first) when answered_by='haven'
  haven_intent text,                      -- 'leasing' | 'maintenance' | 'human' | 'staff' | 'unknown'
  transfer_target text,                   -- queue/user name for haven_transfer rows
  duration_seconds int,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reception_call_date ON reception_call (call_date);
CREATE INDEX IF NOT EXISTS idx_reception_call_kind ON reception_call (kind, call_date);

ALTER TABLE reception_call ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to reception_call" ON reception_call;
CREATE POLICY "Service role full access to reception_call"
  ON reception_call FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
