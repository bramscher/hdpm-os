-- Zoom Phone contact sync: two tables.
--
-- zoom_contact_map — the mapping table that makes updates idempotent. Zoom
-- PATCH/DELETE operate on Zoom's own external_contact_id, and searching Zoom by
-- our own id/phone is limited, so we store the id Zoom returns on create and key
-- everything off (contact_type, appfolio_id). One row per AppFolio contact.
--
-- zoom_sync_runs — one row per sync (cron or manual) so the admin page can show
-- "last synced", status, and per-run counts.
--
-- Run manually in the Supabase SQL editor (matches the other migrations here).

CREATE TABLE IF NOT EXISTS zoom_contact_map (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_type text NOT NULL CHECK (contact_type IN ('vendor', 'owner', 'tenant')),
  appfolio_id text NOT NULL,
  zoom_external_contact_id text,
  name text NOT NULL,
  phone text,                       -- E.164, e.g. +15415551212
  email text,
  description text,                 -- e.g. "Tenant — 123 Main St, Bend"
  active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_type, appfolio_id)
);

-- Reconciliation against pre-existing Zoom contacts is done by phone, so index it.
CREATE INDEX IF NOT EXISTS idx_zoom_contact_map_phone ON zoom_contact_map (phone);
CREATE INDEX IF NOT EXISTS idx_zoom_contact_map_type ON zoom_contact_map (contact_type, active);

CREATE TABLE IF NOT EXISTS zoom_sync_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  triggered_by text,                -- admin email, or 'cron'
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  -- counts
  total_source integer NOT NULL DEFAULT 0,   -- AppFolio contacts considered
  with_phone integer NOT NULL DEFAULT 0,     -- of those, how many had a usable phone
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,  -- unchanged
  failed_count integer NOT NULL DEFAULT 0,
  deactivated_count integer NOT NULL DEFAULT 0, -- flagged inactive (not deleted)
  error_message text,
  details jsonb,                    -- per-type breakdown + sample errors
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_sync_runs_started ON zoom_sync_runs (started_at DESC);
