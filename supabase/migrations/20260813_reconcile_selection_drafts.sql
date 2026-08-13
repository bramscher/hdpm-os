-- ============================================
-- Reconciliation "save & resume" selection drafts.
-- Apply manually in the Supabase SQL Editor (per supabase/migrations/README.md).
-- Idempotent.
--
-- While reconciling a period, the user checks off invoices across the whole
-- period. This table persists that checkbox selection per user + period so they
-- can stop, fix something, and come back to it. The draft is deleted once the
-- period's payment is recorded (see lib/reconcile-selection.ts / the reconcile UI).
--
-- Period is keyed by the two date-range filter values (YYYY-MM-DD, or '' for an
-- open bound) — there is no first-class "period" entity in the app.
-- ============================================

CREATE TABLE IF NOT EXISTS hdms_reconcile_selection (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by TEXT NOT NULL,
  period_from TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD lower bound, or '' = no lower bound
  period_to   TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD upper bound, or '' = no upper bound
  invoice_ids JSONB NOT NULL DEFAULT '[]'::jsonb,  -- selected hdms_invoices.id[]
  filters JSONB,                          -- optional: the rest of the working-set filters
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (created_by, period_from, period_to)
);

CREATE INDEX IF NOT EXISTS idx_hdms_reconcile_selection_owner
  ON hdms_reconcile_selection(created_by);

-- Reuse the generic timestamp updater created with hdms_invoices.
DROP TRIGGER IF EXISTS trigger_update_hdms_reconcile_selection_ts ON hdms_reconcile_selection;
CREATE TRIGGER trigger_update_hdms_reconcile_selection_ts
  BEFORE UPDATE ON hdms_reconcile_selection
  FOR EACH ROW
  EXECUTE FUNCTION update_hdms_invoice_timestamp();

ALTER TABLE hdms_reconcile_selection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to reconcile selection" ON hdms_reconcile_selection;
CREATE POLICY "Service role full access to reconcile selection" ON hdms_reconcile_selection
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON hdms_reconcile_selection TO service_role;

NOTIFY pgrst, 'reload schema';
