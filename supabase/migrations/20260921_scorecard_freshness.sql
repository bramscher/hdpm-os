-- Leave old entries unstamped: their original refresh/source times are unknown.
ALTER TABLE scorecard_entry ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE scorecard_entry ADD COLUMN IF NOT EXISTS source_captured_at timestamptz;
