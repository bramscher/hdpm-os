-- ============================================
-- Migration: HDPM Rent Comparison Toolkit
-- Run this in the Supabase SQL Editor
-- ============================================

-- Step 1: Create the rental_comps table
CREATE TABLE IF NOT EXISTS rental_comps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Location
  town TEXT NOT NULL CHECK (town IN ('Bend', 'Redmond', 'Sisters', 'Prineville', 'Culver', 'La Pine')),
  address TEXT,
  zip_code TEXT,

  -- Property details
  bedrooms INTEGER NOT NULL CHECK (bedrooms >= 0 AND bedrooms <= 6),
  bathrooms NUMERIC(3,1) DEFAULT 1,
  sqft INTEGER,
  property_type TEXT NOT NULL DEFAULT 'SFR' CHECK (property_type IN ('SFR', 'Apartment', 'Townhouse', 'Duplex', 'Condo', 'Manufactured', 'Other')),
  amenities TEXT[] DEFAULT '{}',

  -- Rent data
  monthly_rent NUMERIC(10,2) NOT NULL,
  rent_per_sqft NUMERIC(8,4),

  -- Source tracking
  data_source TEXT NOT NULL DEFAULT 'manual' CHECK (data_source IN ('appfolio', 'rentometer', 'rentcast', 'hud_fmr', 'manual')),
  comp_date DATE NOT NULL DEFAULT CURRENT_DATE,
  external_id TEXT,

  -- Rentometer-specific caching
  rentometer_percentile INTEGER,
  rentometer_cached_until TIMESTAMPTZ,

  -- Notes
  notes TEXT,

  -- Audit
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Create the market_baselines table (HUD FMR + median rents)
CREATE TABLE IF NOT EXISTS market_baselines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  area_name TEXT NOT NULL,
  county TEXT NOT NULL,
  bedrooms INTEGER NOT NULL CHECK (bedrooms >= 0 AND bedrooms <= 6),

  -- Rent data
  fmr_rent NUMERIC(10,2),
  median_rent NUMERIC(10,2),

  -- Source info
  data_year INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'hud_fmr',

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one baseline per area/bedroom/year
  UNIQUE (area_name, bedrooms, data_year)
);

-- Step 2b: Add unique partial index on external_id (for upsert on sync)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_comps_external_id
  ON rental_comps(external_id);

-- Step 3: Create indexes for rental_comps
CREATE INDEX IF NOT EXISTS idx_rental_comps_town ON rental_comps(town);
CREATE INDEX IF NOT EXISTS idx_rental_comps_bedrooms ON rental_comps(bedrooms);
CREATE INDEX IF NOT EXISTS idx_rental_comps_property_type ON rental_comps(property_type);
CREATE INDEX IF NOT EXISTS idx_rental_comps_data_source ON rental_comps(data_source);
CREATE INDEX IF NOT EXISTS idx_rental_comps_comp_date ON rental_comps(comp_date DESC);
CREATE INDEX IF NOT EXISTS idx_rental_comps_town_bedrooms ON rental_comps(town, bedrooms);
CREATE INDEX IF NOT EXISTS idx_rental_comps_created_at ON rental_comps(created_at DESC);

-- Step 4: Create indexes for market_baselines
CREATE INDEX IF NOT EXISTS idx_market_baselines_area ON market_baselines(area_name);
CREATE INDEX IF NOT EXISTS idx_market_baselines_county ON market_baselines(county);
CREATE INDEX IF NOT EXISTS idx_market_baselines_year ON market_baselines(data_year);

-- Step 5: Auto-update updated_at triggers
CREATE OR REPLACE FUNCTION update_rental_comp_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_rental_comp_timestamp ON rental_comps;
CREATE TRIGGER trigger_update_rental_comp_timestamp
  BEFORE UPDATE ON rental_comps
  FOR EACH ROW
  EXECUTE FUNCTION update_rental_comp_timestamp();

CREATE OR REPLACE FUNCTION update_market_baseline_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_market_baseline_timestamp ON market_baselines;
CREATE TRIGGER trigger_update_market_baseline_timestamp
  BEFORE UPDATE ON market_baselines
  FOR EACH ROW
  EXECUTE FUNCTION update_market_baseline_timestamp();

-- Step 6: RLS policies (using service role, so permissive)
ALTER TABLE rental_comps ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to rental_comps" ON rental_comps
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to market_baselines" ON market_baselines
  FOR ALL USING (true) WITH CHECK (true);

-- Step 7: Grant access
GRANT ALL ON rental_comps TO service_role;
GRANT ALL ON market_baselines TO service_role;

-- ============================================
-- Verification: Run these after the migration
-- ============================================

-- Check rental_comps table:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'rental_comps' ORDER BY ordinal_position;

-- Check market_baselines table:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'market_baselines' ORDER BY ordinal_position;

-- Test insert:
-- INSERT INTO rental_comps (town, bedrooms, property_type, monthly_rent, data_source, created_by)
-- VALUES ('Bend', 3, 'SFR', 2100.00, 'manual', 'test@highdesertpm.com')
-- RETURNING id, town, bedrooms, monthly_rent;
