-- ============================================
-- Migration: Key Manager -- physical key registry
-- Date: 2026-07-20
-- Run this in the Supabase SQL Editor.
--
-- Replaces the "Z - Key List - MASTER.xlsx" spreadsheet. Key numbers are
-- permanent identities (key_slot) that can be recycled across properties;
-- each tenure at a unit is a key_assignment row (released_at NULL = active,
-- recycling closes the old row and inserts a new one -- history is never
-- overwritten). AppFolio remains the system of record for property/unit/
-- owner/tenant data: the snapshot columns on key_assignment are owned by
-- the sync; slot status, dates, key types, copies, and notes are owned by
-- this app and are NEVER touched by the sync.
--
-- NOTE: this file is intentionally plain ASCII with one DDL statement per
-- line so it pastes cleanly into the Supabase SQL Editor.
-- ============================================

-- Shared updated_at trigger function (already exists from the inspection
-- migration; recreated here so this file stands alone).
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 1. key_slot -- one row per key number, forever
-- ============================================

CREATE TABLE IF NOT EXISTS key_slot (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key_number  INTEGER NOT NULL UNIQUE CHECK (key_number >= 1),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'vacant', 'retired')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the full numbering range from the master spreadsheet so open tail
-- numbers are visible and pickable from day one.
INSERT INTO key_slot (key_number) SELECT generate_series(1, 972) ON CONFLICT (key_number) DO NOTHING;

DROP TRIGGER IF EXISTS trg_key_slot_updated_at ON key_slot;
CREATE TRIGGER trg_key_slot_updated_at BEFORE UPDATE ON key_slot FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. key_assignment -- one tenure of a number at a unit
-- ============================================

CREATE TABLE IF NOT EXISTS key_assignment (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key_slot_id          UUID NOT NULL REFERENCES key_slot(id) ON DELETE CASCADE,
  appfolio_unit_id     TEXT,
  appfolio_property_id TEXT,
  property_name   TEXT,
  address_1       TEXT,
  address_2       TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  owner_name      TEXT,
  tenant_names    TEXT[] NOT NULL DEFAULT '{}',
  unit_occupied   BOOLEAN,
  sync_flag       TEXT CHECK (sync_flag IS NULL OR sync_flag IN ('appfolio_occupied_but_key_vacant', 'appfolio_vacant_but_key_assigned', 'unit_missing')),
  last_synced_at  TIMESTAMPTZ,
  raw_address  TEXT,
  assigned_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_by  TEXT,
  released_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- THE overwrite guard: a key number can only be assigned to one place at a
-- time, race-proof at the DB layer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_key_assignment_one_active ON key_assignment (key_slot_id) WHERE released_at IS NULL;

-- A unit may legitimately carry several key numbers (garage keys, duplex
-- halves) -- indexed for the duplicate-unit warning, not unique.
CREATE INDEX IF NOT EXISTS idx_key_assignment_unit ON key_assignment (appfolio_unit_id) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_key_assignment_slot ON key_assignment (key_slot_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_key_assignment_updated_at ON key_assignment;
CREATE TRIGGER trg_key_assignment_updated_at BEFORE UPDATE ON key_assignment FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 3. key_type -- lock/key kinds per assignment (Main, Garage, Shed, Mailbox, etc.)
-- ============================================

CREATE TABLE IF NOT EXISTS key_type (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES key_assignment(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (assignment_id, label)
);

CREATE INDEX IF NOT EXISTS idx_key_type_assignment ON key_type (assignment_id);

DROP TRIGGER IF EXISTS trg_key_type_updated_at ON key_type;
CREATE TRIGGER trg_key_type_updated_at BEFORE UPDATE ON key_type FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 4. key_copy -- one row per physical copy
-- ============================================

CREATE TABLE IF NOT EXISTS key_copy (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key_type_id UUID NOT NULL REFERENCES key_type(id) ON DELETE CASCADE,
  holder_type TEXT NOT NULL CHECK (holder_type IN ('tenant', 'office', 'vendor', 'staff', 'other')),
  holder_name TEXT,
  status      TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'returned', 'lost', 'destroyed')),
  issued_at   DATE,
  returned_at DATE,
  charged     BOOLEAN NOT NULL DEFAULT FALSE,
  notes       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_copy_type ON key_copy (key_type_id);

DROP TRIGGER IF EXISTS trg_key_copy_updated_at ON key_copy;
CREATE TRIGGER trg_key_copy_updated_at BEFORE UPDATE ON key_copy FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 5. key_event -- append-only history (mirrors wo_event)
-- ============================================

CREATE TABLE IF NOT EXISTS key_event (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_slot_id   UUID NOT NULL REFERENCES key_slot(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES key_assignment(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  actor       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_event_slot ON key_event (key_slot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_key_event_type ON key_event (event_type, created_at DESC);

-- Real append-only enforcement (even under the service role).
CREATE OR REPLACE FUNCTION key_event_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'key_event is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_key_event_append_only ON key_event;
CREATE TRIGGER trigger_key_event_append_only BEFORE UPDATE OR DELETE ON key_event FOR EACH ROW EXECUTE FUNCTION key_event_append_only();

-- ============================================
-- 6. RLS -- service-role only (access gated at the app layer)
-- ============================================

ALTER TABLE key_slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_copy ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to key_slot" ON key_slot;
CREATE POLICY "Service role full access to key_slot" ON key_slot FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to key_assignment" ON key_assignment;
CREATE POLICY "Service role full access to key_assignment" ON key_assignment FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to key_type" ON key_type;
CREATE POLICY "Service role full access to key_type" ON key_type FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to key_copy" ON key_copy;
CREATE POLICY "Service role full access to key_copy" ON key_copy FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to key_event" ON key_event;
CREATE POLICY "Service role full access to key_event" ON key_event FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON key_slot, key_assignment, key_type, key_copy, key_event TO service_role;

NOTIFY pgrst, 'reload schema';
