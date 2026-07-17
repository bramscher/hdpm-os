-- Migration: Maintenance day routes (published HDMS crew runs)
-- Date: 2026-07-17
-- Description:
--   The board's Route builder was ephemeral (optimize → Google Maps link →
--   gone). Publishing a day route now persists it so it (a) appears on the
--   home operations dashboard, (b) can create an Outlook calendar event for
--   the crew (calendar_event_id kept for cleanup on cancel), and (c) moves the
--   routed work orders onto the schedule via the normal workflow write path.
--   Separate from the inspections route_plans/route_stops tables — those stops
--   FK to inspections; these FK to work_orders.

CREATE TABLE IF NOT EXISTS maint_route_plan (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_date            DATE NOT NULL,
  assigned_tech         TEXT,
  status                TEXT NOT NULL DEFAULT 'published'
                        CHECK (status IN ('published', 'canceled')),
  total_drive_minutes   INTEGER NOT NULL DEFAULT 0,
  total_service_minutes INTEGER NOT NULL DEFAULT 0,
  stop_count            INTEGER NOT NULL DEFAULT 0,
  polyline              TEXT,
  calendar_event_id     TEXT,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maint_route_plan_date ON maint_route_plan (route_date);

CREATE TABLE IF NOT EXISTS maint_route_stop (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_plan_id           UUID NOT NULL REFERENCES maint_route_plan (id) ON DELETE CASCADE,
  work_order_id           UUID NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
  stop_order              INTEGER NOT NULL,
  address                 TEXT NOT NULL,
  lat                     DOUBLE PRECISION,
  lng                     DOUBLE PRECISION,
  drive_minutes_from_prev INTEGER NOT NULL DEFAULT 0,
  service_minutes         INTEGER NOT NULL DEFAULT 45,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_maint_route_stop_plan_order
  ON maint_route_stop (route_plan_id, stop_order);
CREATE INDEX IF NOT EXISTS idx_maint_route_stop_wo ON maint_route_stop (work_order_id);
