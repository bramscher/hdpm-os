-- Unit turn slips: when someone snoozes a late step from the 7 AM Slack list, it stays quiet until this date.
-- Work order slips use work_orders.turn_snoozed_until instead. Run once in the Supabase SQL Editor.
BEGIN;

CREATE TABLE IF NOT EXISTS turn_slip_snooze (
  unit_turn_id UUID NOT NULL REFERENCES unit_turn(id) ON DELETE CASCADE,
  slip_key TEXT NOT NULL,
  until DATE NOT NULL,
  snoozed_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (unit_turn_id, slip_key)
);

ALTER TABLE turn_slip_snooze ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to turn_slip_snooze" ON turn_slip_snooze;
CREATE POLICY "Service role full access to turn_slip_snooze" ON turn_slip_snooze
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON turn_slip_snooze FROM anon, authenticated;

COMMIT;
