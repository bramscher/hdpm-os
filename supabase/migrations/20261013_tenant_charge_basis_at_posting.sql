-- Tenant charges: techs may generate the invoice without the reason or lease
-- clause (they often don't know them); the office supplies them when posting
-- the charge to the tenant ledger, and posting requires them (ORS 90 basis).
--
-- 1. The CHECK keeps tenant, unit and note required once generated/attached,
--    and moves reason (+ lease clause for a lease fee) to "once posted".
-- 2. The guard still freezes who pays after attach/post, but lets a blank
--    reason or lease clause be filled in (NULL → value) before posting.
-- Idempotent.

ALTER TABLE hdms_invoices DROP CONSTRAINT IF EXISTS hdms_invoices_charge_to_fields;
ALTER TABLE hdms_invoices ADD CONSTRAINT hdms_invoices_charge_to_fields CHECK (
  (charge_to = 'owner'
    AND tenant_name IS NULL AND tenant_unit IS NULL AND tenant_charge_reason IS NULL
    AND tenant_charge_note IS NULL AND lease_clause IS NULL
    AND tenant_ledger_posted_at IS NULL AND tenant_ledger_posted_by IS NULL)
  OR
  (charge_to = 'tenant'
    AND (
      status NOT IN ('generated', 'attached')
      OR (
        nullif(btrim(tenant_name), '') IS NOT NULL
        AND nullif(btrim(tenant_unit), '') IS NOT NULL
        AND nullif(btrim(tenant_charge_note), '') IS NOT NULL
      )
    )
    AND (
      tenant_ledger_posted_at IS NULL
      OR (
        tenant_charge_reason IS NOT NULL
        AND (tenant_charge_reason <> 'lease_fee' OR nullif(btrim(lease_clause), '') IS NOT NULL)
      )
    ))
);

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
    OR NEW.tenant_charge_note IS DISTINCT FROM OLD.tenant_charge_note
    -- Reason / lease clause: a blank may be filled in before posting; never changed once set or posted.
    OR (NEW.tenant_charge_reason IS DISTINCT FROM OLD.tenant_charge_reason
        AND (OLD.tenant_charge_reason IS NOT NULL OR OLD.tenant_ledger_posted_at IS NOT NULL))
    OR (NEW.lease_clause IS DISTINCT FROM OLD.lease_clause
        AND (nullif(btrim(OLD.lease_clause), '') IS NOT NULL OR OLD.tenant_ledger_posted_at IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Who pays this invoice is fixed once it is attached in AppFolio or the tenant charge is posted. Void it and issue a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
