-- ============================================
-- Referral Partner Portal — Batch 0 core schema
-- Plan: docs/partners/00-referral-portal-plan.md §2 (data model), §5 (Batch 0)
--
-- What this migration establishes:
--   1. The full `referral_*` table set (prefix, in the public schema — the
--      repo convention; PostgREST exposes public, a separate schema would need
--      extra config, see migrations/README.md).
--   2. The codebase's FIRST real per-user RLS: referrers read ONLY their own
--      rows via auth.uid(); admin/app keeps its existing service-role access.
--   3. Append-only enforcement (UPDATE/DELETE rejected even under service role)
--      on the two immutable tables: referral_lead_event and referral_ledger —
--      the wo_event pattern from 20260702_maintenance_os.sql.
--   4. fee_policy (the data-driven Oregon-eligibility switch) seeded allowed=false.
--
-- Conventions (migrations/README.md): applied MANUALLY in the Supabase SQL
-- Editor by Craig; idempotent; RLS on every table; org_id seam on every table.
-- AppFolio linkage is TEXT keys, NEVER foreign keys — no local owner/property
-- row exists (AppFolio v0 is fetched live).
-- ============================================

-- (The referral_current_partner_id() helper is defined in section 10.5, after
--  all tables exist — a SQL-language function body is validated at CREATE time,
--  so it cannot reference referral_partner before the table is created.)

-- ============================================
-- 1. referral_partner — the referrer profile + 1099 / payout data.
--    auth_user_id is the RLS key (links to a Supabase Auth user, set at
--    invite-accept in Batch 2; NULL until then). Sensitive fields
--    (tax id, payout details) live only in *_encrypted columns.
-- ============================================

CREATE TABLE IF NOT EXISTS referral_partner (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  auth_user_id UUID UNIQUE,                       -- RLS key; NULL until invite accepted
  type TEXT NOT NULL,                             -- owner | agent | builder | vendor | other
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | active | paused | terminated

  -- contact
  display_name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,

  -- licensing / compliance
  license_number TEXT,                            -- agents (licensed)
  w9_status TEXT NOT NULL DEFAULT 'missing',      -- missing | on_file | verified
  w9_doc_path TEXT,                               -- Supabase Storage path

  -- structured 1099 fields (no other structured source exists — captured here)
  legal_name TEXT,
  tax_id_encrypted TEXT,                          -- AES-256-GCM (lib/referrals/crypto.ts)
  tax_id_last4 TEXT,
  tax_address JSONB,

  -- payout (RECORDED, not executed — real movement is QBO)
  payout_method TEXT,                             -- check | ach | other
  payout_last4 TEXT,
  payout_details_encrypted TEXT,

  -- agreement + code
  agreement_accepted_at TIMESTAMPTZ,
  agreement_doc_path TEXT,
  referral_code TEXT UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_partner_auth ON referral_partner(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_partner_status ON referral_partner(status);

-- ============================================
-- 2. referral_lead — the pipeline row and SoR for owner-acquisition
--    (referral AND organic). partner_id NULL => organic. trailing_status is
--    INDEPENDENT of stage (income-driven, per plan §2).
-- ============================================

CREATE TABLE IF NOT EXISTS referral_lead (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  partner_id UUID REFERENCES referral_partner(id) ON DELETE SET NULL,  -- NULL = organic
  source TEXT NOT NULL DEFAULT 'referral',        -- referral | organic

  -- lifecycle
  stage TEXT NOT NULL DEFAULT 'submitted',        -- submitted..closed/lost
  trailing_status TEXT NOT NULL DEFAULT 'none',   -- none | accruing | ended (NOT tied to stage)
  trailing_ended_at TIMESTAMPTZ,
  trailing_ended_reason TEXT,

  -- prospect
  prospect_name TEXT NOT NULL,
  prospect_email TEXT,
  prospect_phone TEXT,
  property_addresses TEXT[],
  unit_count INTEGER,
  notes TEXT,

  -- attribution
  ref_code TEXT,
  utm JSONB,
  landing_page TEXT,
  hdpm_web_lead_id TEXT,                           -- link to hdpm-web Lead (marketing SoR)

  -- AppFolio linkage on signing (TEXT keys, never FKs)
  appfolio_owner_id TEXT,
  appfolio_property_ids TEXT[],
  doors_under_mgmt INTEGER,

  -- dedupe
  dup_of_lead_id UUID REFERENCES referral_lead(id) ON DELETE SET NULL,
  dup_status TEXT,                                 -- suspected | confirmed | cleared
  first_touch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_lead_partner ON referral_lead(partner_id);
CREATE INDEX IF NOT EXISTS idx_referral_lead_stage ON referral_lead(stage);
CREATE INDEX IF NOT EXISTS idx_referral_lead_trailing ON referral_lead(trailing_status);
CREATE INDEX IF NOT EXISTS idx_referral_lead_source ON referral_lead(source);

-- ============================================
-- 3. referral_lead_event — append-only stage/attribution history.
--    (mirrors wo_event: every change is an event; nothing overwritten.)
-- ============================================

CREATE TABLE IF NOT EXISTS referral_lead_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  lead_id UUID NOT NULL REFERENCES referral_lead(id) ON DELETE CASCADE,
  -- created | stage_change | dedupe | link_appfolio | note | trailing_change
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,                             -- lib/agents/actor.ts convention
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_lead_event_lead ON referral_lead_event(lead_id, created_at DESC);

-- ============================================
-- 4. referral_fee_policy — the DATA-DRIVEN, admin-configurable compensation
--    table. Oregon eligibility lives in `allowed`, NOT in code. Seeded false.
--    first_rent has no AppFolio detection source — only agreement_signed is
--    v1-implementable (plan §2).
-- ============================================

CREATE TABLE IF NOT EXISTS referral_fee_policy (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  partner_type TEXT NOT NULL,                     -- owner | agent | builder | vendor | other
  fee_kind TEXT NOT NULL,                         -- one_time_bounty | trailing
  allowed BOOLEAN NOT NULL DEFAULT false,         -- the OR-eligibility switch (attorney gate)

  -- one_time_bounty config
  bounty_mode TEXT,                               -- fixed | per_door
  bounty_amount NUMERIC,
  bounty_trigger TEXT,                            -- agreement_signed | first_rent (first_rent deferred)

  -- trailing config
  trailing_pct NUMERIC,
  trailing_months INTEGER,

  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, partner_type, fee_kind, effective_from)
);

-- Seed the full policy matrix, every row allowed=false (attorney sign-off gate).
INSERT INTO referral_fee_policy (partner_type, fee_kind, allowed)
SELECT t.partner_type, k.fee_kind, false
FROM (VALUES ('owner'),('agent'),('builder'),('vendor'),('other')) AS t(partner_type)
CROSS JOIN (VALUES ('one_time_bounty'),('trailing')) AS k(fee_kind)
ON CONFLICT (org_id, partner_type, fee_kind, effective_from) DO NOTHING;

-- ============================================
-- 5. referral_fee_agreement — terms FROZEN onto the lead at signing.
--    Later fee_policy edits never rewrite earned amounts. Write is gated in
--    app code on referral_fee_policy.allowed=true.
-- ============================================

CREATE TABLE IF NOT EXISTS referral_fee_agreement (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  lead_id UUID NOT NULL REFERENCES referral_lead(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES referral_partner(id) ON DELETE CASCADE,
  fee_kind TEXT NOT NULL,                         -- one_time_bounty | trailing

  -- frozen snapshot of the terms in force at signing
  bounty_mode TEXT,
  bounty_amount NUMERIC,
  bounty_trigger TEXT,
  trailing_pct NUMERIC,
  trailing_months INTEGER,
  trailing_window_start DATE,                     -- computed at signing
  trailing_window_end DATE,

  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_fee_agreement_lead ON referral_fee_agreement(lead_id);
CREATE INDEX IF NOT EXISTS idx_referral_fee_agreement_partner ON referral_fee_agreement(partner_id);

-- ============================================
-- 6. referral_ledger — append-only money ledger. Corrections are new signed
--    rows, never edits. Balances are computed by summing. (partner_id carried
--    for RLS + reporting; entry references a lead + period.)
-- ============================================

CREATE TABLE IF NOT EXISTS referral_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  partner_id UUID NOT NULL REFERENCES referral_partner(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES referral_lead(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL,                       -- earned | adjusted | approved | paid | voided
  period TEXT,                                    -- YYYY-MM (trailing accruals)
  amount NUMERIC NOT NULL,                        -- signed
  reason TEXT NOT NULL,
  qbo_reference TEXT,
  batch_id TEXT,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_ledger_partner ON referral_ledger(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_ledger_lead ON referral_ledger(lead_id);
CREATE INDEX IF NOT EXISTS idx_referral_ledger_batch ON referral_ledger(batch_id);

-- ============================================
-- 7. referral_property_fee_income — the (currently unproven) trailing-fee
--    input. Fed by the Batch 6b Reports-API pull IF Batch 6a proves a source.
--    Inert until then.
-- ============================================

CREATE TABLE IF NOT EXISTS referral_property_fee_income (
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  appfolio_property_id TEXT NOT NULL,
  period TEXT NOT NULL,                            -- YYYY-MM
  mgmt_fee_income NUMERIC NOT NULL,
  source_report TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (appfolio_property_id, period)
);

-- ============================================
-- 8. referral_notification_log — records every notification attempt/skip
--    (Batch 4). Referrer can read their own.
-- ============================================

CREATE TABLE IF NOT EXISTS referral_notification_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  partner_id UUID REFERENCES referral_partner(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES referral_lead(id) ON DELETE SET NULL,
  event TEXT NOT NULL,                            -- lead_submitted | status_change | accrual | payout | w9_missing
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT,
  status TEXT NOT NULL,                           -- sent | skipped | failed
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_notification_partner ON referral_notification_log(partner_id, created_at DESC);

-- ============================================
-- 9. referral_acquisition_cost — optional manual spend input for
--    cost-per-door reporting (admin only).
-- ============================================

CREATE TABLE IF NOT EXISTS referral_acquisition_cost (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  period TEXT NOT NULL,                            -- YYYY-MM
  channel TEXT,
  amount NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 10. Append-only enforcement — reject UPDATE/DELETE even under service role,
--     on the two immutable tables. (wo_event pattern.)
-- ============================================

CREATE OR REPLACE FUNCTION referral_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_referral_lead_event_append_only ON referral_lead_event;
CREATE TRIGGER trigger_referral_lead_event_append_only
  BEFORE UPDATE OR DELETE ON referral_lead_event
  FOR EACH ROW EXECUTE FUNCTION referral_append_only();

DROP TRIGGER IF EXISTS trigger_referral_ledger_append_only ON referral_ledger;
CREATE TRIGGER trigger_referral_ledger_append_only
  BEFORE UPDATE OR DELETE ON referral_ledger
  FOR EACH ROW EXECUTE FUNCTION referral_append_only();

-- ============================================
-- 10.5. Helper: resolve the calling referrer's partner id from their JWT.
--    SECURITY DEFINER so child-table policies can join to referral_partner
--    without triggering its RLS (avoids recursive policy evaluation).
--    Defined here (not up top) because a SQL-language function body is
--    validated at CREATE time and needs referral_partner to already exist.
-- ============================================

CREATE OR REPLACE FUNCTION referral_current_partner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM referral_partner WHERE auth_user_id = auth.uid()
$$;

-- ============================================
-- 11. RLS — the codebase's first real per-user isolation.
--     Every table: ENABLE RLS + a service_role FOR ALL passthrough (the admin
--     / app path, unchanged). Referrer-readable tables ADD a `TO authenticated`
--     SELECT policy scoped to auth.uid(). Tables with NO referrer policy
--     (fee_policy, property_fee_income, acquisition_cost) are admin-only.
-- ============================================

ALTER TABLE referral_partner              ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_lead                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_lead_event           ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_fee_policy           ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_fee_agreement        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_ledger               ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_property_fee_income  ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_notification_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_acquisition_cost     ENABLE ROW LEVEL SECURITY;

-- Service-role passthrough (the existing app/admin path) on every table.
DROP POLICY IF EXISTS "svc referral_partner"             ON referral_partner;
DROP POLICY IF EXISTS "svc referral_lead"                ON referral_lead;
DROP POLICY IF EXISTS "svc referral_lead_event"          ON referral_lead_event;
DROP POLICY IF EXISTS "svc referral_fee_policy"          ON referral_fee_policy;
DROP POLICY IF EXISTS "svc referral_fee_agreement"       ON referral_fee_agreement;
DROP POLICY IF EXISTS "svc referral_ledger"              ON referral_ledger;
DROP POLICY IF EXISTS "svc referral_property_fee_income" ON referral_property_fee_income;
DROP POLICY IF EXISTS "svc referral_notification_log"    ON referral_notification_log;
DROP POLICY IF EXISTS "svc referral_acquisition_cost"    ON referral_acquisition_cost;

CREATE POLICY "svc referral_partner"             ON referral_partner             FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_lead"                ON referral_lead                FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_lead_event"          ON referral_lead_event          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_fee_policy"          ON referral_fee_policy          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_fee_agreement"       ON referral_fee_agreement       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_ledger"              ON referral_ledger              FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_property_fee_income" ON referral_property_fee_income FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_notification_log"    ON referral_notification_log    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc referral_acquisition_cost"    ON referral_acquisition_cost    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Referrer read-only isolation (TO authenticated, scoped to auth.uid()).
-- Batch 0 grants SELECT only; write policies (settings, lead submit) are added
-- in the batches that need them (2, 3).
DROP POLICY IF EXISTS "referrer reads own partner"  ON referral_partner;
CREATE POLICY "referrer reads own partner" ON referral_partner
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "referrer reads own leads"    ON referral_lead;
CREATE POLICY "referrer reads own leads" ON referral_lead
  FOR SELECT TO authenticated
  USING (partner_id = referral_current_partner_id());

DROP POLICY IF EXISTS "referrer reads own lead events" ON referral_lead_event;
CREATE POLICY "referrer reads own lead events" ON referral_lead_event
  FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM referral_lead WHERE partner_id = referral_current_partner_id()));

DROP POLICY IF EXISTS "referrer reads own agreements" ON referral_fee_agreement;
CREATE POLICY "referrer reads own agreements" ON referral_fee_agreement
  FOR SELECT TO authenticated
  USING (partner_id = referral_current_partner_id());

DROP POLICY IF EXISTS "referrer reads own ledger" ON referral_ledger;
CREATE POLICY "referrer reads own ledger" ON referral_ledger
  FOR SELECT TO authenticated
  USING (partner_id = referral_current_partner_id());

DROP POLICY IF EXISTS "referrer reads own notifications" ON referral_notification_log;
CREATE POLICY "referrer reads own notifications" ON referral_notification_log
  FOR SELECT TO authenticated
  USING (partner_id = referral_current_partner_id());

-- referral_fee_policy, referral_property_fee_income, referral_acquisition_cost:
-- NO authenticated policy => referrers see nothing; admin/app via service role.

-- Grants: service_role keeps full access; authenticated gets table-level SELECT
-- (RLS still restricts to the referrer's own rows). Supabase's `authenticated`
-- role is the anon client bound to a logged-in user's JWT.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON
  referral_partner, referral_lead, referral_lead_event,
  referral_fee_agreement, referral_ledger, referral_notification_log
  TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
