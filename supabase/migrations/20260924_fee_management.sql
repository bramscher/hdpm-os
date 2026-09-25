-- Fee Management (admin): owner-level management fee increase campaign.
-- Safe to replay. AppFolio stays read-only; everything app-owned lives here.

-- 1. Config: tier → target rules and priority-score weights (key/value JSON).
CREATE TABLE IF NOT EXISTS fee_campaign_config (
  org_id text NOT NULL DEFAULT 'hdpm',
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (org_id, key)
);

INSERT INTO fee_campaign_config (key, value) VALUES
  ('tier_targets', '[
    {"min": 5,  "max": 6,    "addPts": 1.5},
    {"min": 6,  "max": 7,    "addPts": 1.0},
    {"min": 7,  "max": 8,    "addPts": 0.75},
    {"min": 8,  "max": 9,    "addPts": 0.5},
    {"min": 9,  "max": 10,   "addPts": 0.25},
    {"min": 10, "max": null, "addPts": 0}
  ]'::jsonb),
  ('priority_weights', '{"addedDollars": 0.6, "renewalUrgency": 0.25, "feeGap": 0.15}'::jsonb)
ON CONFLICT (org_id, key) DO NOTHING;

-- 2. Agreement dates, keyed by AppFolio property id. The API has no term or
-- renewal fields, so staff backfill here; blank rows fall back to a projected
-- yearly renewal from ManagementStartDate.
CREATE TABLE IF NOT EXISTS property_agreement (
  org_id text NOT NULL DEFAULT 'hdpm',
  appfolio_property_id text NOT NULL,
  start_date date,
  end_date date,
  auto_renew boolean NOT NULL DEFAULT true,
  notice_days integer CHECK (notice_days IS NULL OR notice_days >= 0),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (org_id, appfolio_property_id)
);

-- 3. Campaign tracking, one row per owner set (sorted AppFolio owner ids
-- joined with "+", so co-owned properties are one conversation, one row).
CREATE TABLE IF NOT EXISTS fee_campaign (
  org_id text NOT NULL DEFAULT 'hdpm',
  owner_set_key text NOT NULL,
  owner_name text,
  status text NOT NULL DEFAULT 'not_contacted'
    CHECK (status IN ('not_contacted', 'contacted', 'accepted', 'declined', 'at_risk')),
  new_fee_pct numeric(5, 2) CHECK (new_fee_pct IS NULL OR (new_fee_pct >= 0 AND new_fee_pct <= 100)),
  effective_date date,
  assigned_to text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (org_id, owner_set_key)
);

ALTER TABLE fee_campaign_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to fee_campaign_config" ON fee_campaign_config;
CREATE POLICY "Service role full access to fee_campaign_config" ON fee_campaign_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE property_agreement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to property_agreement" ON property_agreement;
CREATE POLICY "Service role full access to property_agreement" ON property_agreement
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE fee_campaign ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to fee_campaign" ON fee_campaign;
CREATE POLICY "Service role full access to fee_campaign" ON fee_campaign
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
