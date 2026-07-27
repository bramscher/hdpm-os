-- Migration: Haven PMC leasing conversations mirror
-- Date: 2026-07-27
-- Description: Synced copy of Haven AI leasing conversations (read-only PMC
-- API, polled daily — no webhooks). Powers the leasing-funnel response-time
-- metrics (response_seconds computed from conversation history events) and
-- agent-issue surfacing (escalation/pending-follow-up flags).

CREATE TABLE IF NOT EXISTS haven_conversation (
  conversation_id        TEXT PRIMARY KEY,
  prospect_id            TEXT,
  first_name             TEXT,
  last_name              TEXT,
  email                  TEXT,
  phone_number           TEXT,
  lead_source            TEXT,
  property_path          TEXT,
  property_address       TEXT,
  property_type          TEXT,
  lead_classification    TEXT,
  pipeline_phase         TEXT,
  handled_by             TEXT,
  tour_scheduled         BOOLEAN DEFAULT FALSE,
  tour_status            TEXT,
  scheduled_tour_start   TIMESTAMPTZ,
  assigned_leasing_agent TEXT,
  first_contact_at       TIMESTAMPTZ,
  last_activity_at       TIMESTAMPTZ,
  escalation_flag        BOOLEAN DEFAULT FALSE,
  flag_type              TEXT,
  flag_date              TIMESTAMPTZ,
  flag_resolved          BOOLEAN,
  pending_follow_up      BOOLEAN DEFAULT FALSE,
  -- Derived from /history events: first prospect message + our first reply
  first_inbound_at       TIMESTAMPTZ,
  response_seconds       INTEGER,
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_haven_conversation_first_contact
  ON haven_conversation (first_contact_at);

CREATE INDEX IF NOT EXISTS idx_haven_conversation_escalation
  ON haven_conversation (escalation_flag)
  WHERE escalation_flag = TRUE AND (flag_resolved IS DISTINCT FROM TRUE);
