-- Owner charge / Tenant charge on HDMS invoices.
--
-- Every invoice says who pays, and one invoice is never both: the payer lives
-- on the invoice row (not on line items), so a single document can't mix them.
-- A job that has both gets two invoices.
--
-- Posting model (decided 2026-10-02, option a): the owner still pays HDMS's
-- bill as usual, so AppFolio bill matching and payments are unchanged; a
-- tenant charge is ALSO posted to the tenant ledger to reimburse the owner.
-- tenant_ledger_posted_at records that follow-up.
--
-- Existing rows, the workspace billing op and estimate conversion all insert
-- without charge_to and get 'owner' from the default.

ALTER TABLE hdms_invoices
  ADD COLUMN IF NOT EXISTS charge_to TEXT NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS tenant_name TEXT,
  ADD COLUMN IF NOT EXISTS tenant_unit TEXT,
  ADD COLUMN IF NOT EXISTS tenant_charge_reason TEXT,
  ADD COLUMN IF NOT EXISTS tenant_charge_note TEXT,
  ADD COLUMN IF NOT EXISTS lease_clause TEXT,
  ADD COLUMN IF NOT EXISTS tenant_ledger_posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tenant_ledger_posted_by TEXT;

ALTER TABLE hdms_invoices DROP CONSTRAINT IF EXISTS hdms_invoices_charge_to_check;
ALTER TABLE hdms_invoices ADD CONSTRAINT hdms_invoices_charge_to_check
  CHECK (charge_to IN ('owner', 'tenant'));

ALTER TABLE hdms_invoices DROP CONSTRAINT IF EXISTS hdms_invoices_tenant_reason_check;
ALTER TABLE hdms_invoices ADD CONSTRAINT hdms_invoices_tenant_reason_check
  CHECK (tenant_charge_reason IS NULL OR tenant_charge_reason IN ('tenant_damage', 'lease_fee', 'other'));

-- Owner invoices carry no tenant fields. A tenant invoice may be incomplete
-- while it's a draft, but needs a basis (ORS 90) once generated or attached:
-- tenant, unit, reason and note, plus the lease clause for a lease fee.
ALTER TABLE hdms_invoices DROP CONSTRAINT IF EXISTS hdms_invoices_charge_to_fields;
ALTER TABLE hdms_invoices ADD CONSTRAINT hdms_invoices_charge_to_fields CHECK (
  (charge_to = 'owner'
    AND tenant_name IS NULL AND tenant_unit IS NULL AND tenant_charge_reason IS NULL
    AND tenant_charge_note IS NULL AND lease_clause IS NULL
    AND tenant_ledger_posted_at IS NULL AND tenant_ledger_posted_by IS NULL)
  OR
  (charge_to = 'tenant' AND (
    status NOT IN ('generated', 'attached')
    OR (
      nullif(btrim(tenant_name), '') IS NOT NULL
      AND nullif(btrim(tenant_unit), '') IS NOT NULL
      AND tenant_charge_reason IS NOT NULL
      AND nullif(btrim(tenant_charge_note), '') IS NOT NULL
      AND (tenant_charge_reason <> 'lease_fee' OR nullif(btrim(lease_clause), '') IS NOT NULL)
    )
  ))
);

CREATE INDEX IF NOT EXISTS idx_hdms_invoices_tenant_unposted
  ON hdms_invoices (charge_to)
  WHERE charge_to = 'tenant' AND tenant_ledger_posted_at IS NULL;

-- 1. A credit memo has the same payer as the invoice it corrects.
-- 2. Who pays (and the tenant's identity and basis) is fixed once the invoice
--    is attached in AppFolio or its tenant-ledger charge is posted. (Editing a
--    generated invoice already sends it back to draft, so that stays open.)
--    To change it after that, void the invoice and issue a new one. Recording
--    the tenant-ledger follow-up and voiding stay allowed.
CREATE OR REPLACE FUNCTION hdms_invoice_charge_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  credited_charge TEXT;
BEGIN
  IF NEW.credits_invoice_id IS NOT NULL THEN
    SELECT charge_to INTO credited_charge FROM hdms_invoices WHERE id = NEW.credits_invoice_id;
    IF credited_charge IS NOT NULL AND credited_charge <> NEW.charge_to THEN
      RAISE EXCEPTION 'A credit must charge the same party as the invoice it corrects (%).', credited_charge
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.status = 'attached' OR OLD.tenant_ledger_posted_at IS NOT NULL) AND (
       NEW.charge_to IS DISTINCT FROM OLD.charge_to
    OR NEW.tenant_name IS DISTINCT FROM OLD.tenant_name
    OR NEW.tenant_unit IS DISTINCT FROM OLD.tenant_unit
    OR NEW.tenant_charge_reason IS DISTINCT FROM OLD.tenant_charge_reason
    OR NEW.tenant_charge_note IS DISTINCT FROM OLD.tenant_charge_note
    OR NEW.lease_clause IS DISTINCT FROM OLD.lease_clause
  ) THEN
    RAISE EXCEPTION 'Who pays this invoice is fixed once it is attached in AppFolio or the tenant charge is posted. Void it and issue a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hdms_invoice_charge_guard ON hdms_invoices;
CREATE TRIGGER hdms_invoice_charge_guard
  BEFORE INSERT OR UPDATE ON hdms_invoices
  FOR EACH ROW EXECUTE FUNCTION hdms_invoice_charge_guard();
