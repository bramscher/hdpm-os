-- Turn Estimator — Slice 0: price book + estimate spine + audit.
--
-- Threads one line item end-to-end through the net-new spine (price book →
-- estimate → pricing → authorization → approval → convert to a draft
-- hdms_invoices row), reusing the existing invoice engine + PDF. Immutable
-- estimate versions/lines (append-only triggers modeled on wo_event), effective-
-- dated price book, and financial audit via audit_event.
--
-- Apply manually in the Supabase SQL editor (repo convention). Idempotent.

-- ── Shared helpers ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION te_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION te_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'table is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ── Price book (effective-dated; the pricing config itself) ──────────────────

CREATE TABLE IF NOT EXISTS price_book_item (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  item_code TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_description TEXT,
  internal_instructions TEXT,
  pricing_method TEXT NOT NULL
    CHECK (pricing_method IN ('flat','hourly','service_min','package','per_qty','cost_plus','quoted','allowance')),
  base_price NUMERIC(12,2) NOT NULL DEFAULT 0,   -- per method: flat price / hourly rate / minimum / per-unit / cap
  included_minutes INT,                          -- service_min / package
  increment_minutes INT,                         -- service_min
  increment_price NUMERIC(12,2),                 -- service_min
  standard_minutes INT,                          -- expected labor for margin/estimating
  uom TEXT NOT NULL DEFAULT 'each',              -- each / hour / room / sqft / linear_ft / load / item
  markup_pct NUMERIC(6,3),                       -- cost_plus
  markup_eligible BOOLEAN NOT NULL DEFAULT false,
  gl_code TEXT,
  tenant_alloc_eligible BOOLEAN NOT NULL DEFAULT false,  -- eligible != approved
  skill_trade TEXT,
  market TEXT NOT NULL DEFAULT 'central_oregon',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,                             -- NULL = open-ended (current)
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Resolver reads by (item_code, asOf); overlapping windows are prevented in app
-- code (reprice closes the current row before inserting the next).
CREATE INDEX IF NOT EXISTS idx_price_book_item_lookup
  ON price_book_item(org_id, item_code, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_price_book_item_category
  ON price_book_item(org_id, category) WHERE active;

DROP TRIGGER IF EXISTS trg_price_book_item_touch ON price_book_item;
CREATE TRIGGER trg_price_book_item_touch BEFORE UPDATE ON price_book_item
  FOR EACH ROW EXECUTE FUNCTION te_touch_updated_at();

-- ── Estimate header (mutable) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimate (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  unit_turn_id UUID REFERENCES unit_turn(id) ON DELETE SET NULL,
  property_id TEXT,
  property_name TEXT,
  unit_id TEXT,
  unit_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','approval_pending','approved','declined','superseded','void')),
  current_version_id UUID,                        -- FK set after first version (see below)
  authorization_limit NUMERIC(12,2),              -- from WO maintenance_limit or entered
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_estimate_turn ON estimate(unit_turn_id);
CREATE INDEX IF NOT EXISTS idx_estimate_status ON estimate(status) WHERE status != 'void';

DROP TRIGGER IF EXISTS trg_estimate_touch ON estimate;
CREATE TRIGGER trg_estimate_touch BEFORE UPDATE ON estimate
  FOR EACH ROW EXECUTE FUNCTION te_touch_updated_at();

-- ── Estimate version (immutable — append-only) ───────────────────────────────

CREATE TABLE IF NOT EXISTS estimate_version (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID NOT NULL REFERENCES estimate(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','approved','superseded')),
  owner_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  internal_cost_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  tenant_alloc_proposed_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  margin NUMERIC(12,2) NOT NULL DEFAULT 0,
  priced_asof DATE NOT NULL DEFAULT CURRENT_DATE,   -- the price-book effective date used
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (estimate_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_estimate_version_estimate
  ON estimate_version(estimate_id, version_number DESC);

-- Append-only: a version is never mutated in place. status transitions
-- (issued→approved/superseded) are done via a narrow UPDATE exemption below.
-- Slice 0 keeps it strict except for the status column, updated through the
-- estimate service which re-inserts nothing — so we allow UPDATE of status only.
CREATE OR REPLACE FUNCTION estimate_version_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'estimate_version is append-only: DELETE not allowed';
  END IF;
  -- Only the status field may change (issued → approved/superseded). All money
  -- and line-defining fields are frozen at issue.
  IF NEW.owner_total <> OLD.owner_total
     OR NEW.internal_cost_total <> OLD.internal_cost_total
     OR NEW.tenant_alloc_proposed_total <> OLD.tenant_alloc_proposed_total
     OR NEW.margin <> OLD.margin
     OR NEW.priced_asof <> OLD.priced_asof
     OR NEW.version_number <> OLD.version_number
     OR NEW.estimate_id <> OLD.estimate_id THEN
    RAISE EXCEPTION 'estimate_version is immutable except status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_estimate_version_guard ON estimate_version;
CREATE TRIGGER trg_estimate_version_guard
  BEFORE UPDATE OR DELETE ON estimate_version
  FOR EACH ROW EXECUTE FUNCTION estimate_version_guard();

-- ── Estimate line (immutable — append-only) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS estimate_line (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_version_id UUID NOT NULL REFERENCES estimate_version(id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  price_book_item_id UUID REFERENCES price_book_item(id),
  price_book_item_code TEXT,
  category TEXT,
  pricing_method TEXT NOT NULL,
  description TEXT NOT NULL,
  room TEXT,
  location TEXT,
  qty NUMERIC(12,3) NOT NULL DEFAULT 1,
  uom TEXT NOT NULL DEFAULT 'each',
  est_labor_hours NUMERIC(8,2),
  est_material_cost NUMERIC(12,2),
  internal_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  owner_unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  owner_extended NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tenant_alloc_proposed NUMERIC(12,2) NOT NULL DEFAULT 0,
  responsibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (responsibility IN ('owner','tenant','shared','unknown','not_billable')),
  responsibility_rationale TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (estimate_version_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_estimate_line_version ON estimate_line(estimate_version_id, line_no);

DROP TRIGGER IF EXISTS trg_estimate_line_append_only ON estimate_line;
CREATE TRIGGER trg_estimate_line_append_only
  BEFORE UPDATE OR DELETE ON estimate_line
  FOR EACH ROW EXECUTE FUNCTION te_append_only();

-- ── Estimate approval (record; decided in place, audited) ────────────────────

CREATE TABLE IF NOT EXISTS estimate_approval (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_version_id UUID NOT NULL REFERENCES estimate_version(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('OWNER','PM','OPS')),
  requested_by TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_amount NUMERIC(12,2),
  decision TEXT CHECK (decision IN ('APPROVED','DECLINED','CHANGES')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  conditions TEXT,
  reason TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_estimate_approval_version ON estimate_approval(estimate_version_id);

DROP TRIGGER IF EXISTS trg_estimate_approval_touch ON estimate_approval;
CREATE TRIGGER trg_estimate_approval_touch BEFORE UPDATE ON estimate_approval
  FOR EACH ROW EXECUTE FUNCTION te_touch_updated_at();

-- ── Turn-estimator config (JSONB singleton; keeps globals out of code) ───────

CREATE TABLE IF NOT EXISTS turn_estimator_config (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO turn_estimator_config (id, config) VALUES (
  'singleton',
  jsonb_build_object(
    'change_order_tolerance_abs', 100,
    'change_order_tolerance_pct', 0.10,
    'internal_labor_cost_rate', 35,   -- internal $/hr cost basis for margin (placeholder)
    'default_authorization_limit', 500
  )
) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_te_config_touch ON turn_estimator_config;
CREATE TRIGGER trg_te_config_touch BEFORE UPDATE ON turn_estimator_config
  FOR EACH ROW EXECUTE FUNCTION te_touch_updated_at();

-- ── Invoice linkage: block double-billing an estimate version ────────────────

ALTER TABLE hdms_invoices ADD COLUMN IF NOT EXISTS source_estimate_version_id UUID;
-- At most one non-void invoice may source a given estimate version.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hdms_invoice_source_estimate
  ON hdms_invoices(source_estimate_version_id)
  WHERE source_estimate_version_id IS NOT NULL AND status <> 'void';

-- ── audit_event: enforce append-only at the DB (mirrors wo_event) ────────────

CREATE OR REPLACE FUNCTION audit_event_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_audit_event_append_only ON audit_event;
CREATE TRIGGER trigger_audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

-- ── RLS (service-role pattern, same as the rest of the app) ──────────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'price_book_item','estimate','estimate_version','estimate_line',
    'estimate_approval','turn_estimator_config'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access to %1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "Service role full access to %1$s" ON %1$I FOR ALL USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
