-- Phase 2, Brief 2A — EOS operating layer core (docs/hdpm-os/06 §2) +
-- audit_event (briefs/audit-event-design.md).
-- Deviations from doc 06 as written: people columns reference the real staff
-- PK (staff.person TEXT), not a uuid; issue.solved_decision_id is added via
-- ALTER after decision exists (creation-order cycle).
-- Apply in the Supabase SQL editor, then: npx tsx scripts/eos/seed-eos.ts

-- ── Accountability chart ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  name TEXT NOT NULL,
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,       -- 3–5 role strings
  reports_to_seat_id UUID REFERENCES seat(id) ON DELETE SET NULL,
  person TEXT REFERENCES staff(person) ON DELETE SET NULL,  -- null = open seat
  gwc_notes TEXT,                                  -- human-only content (doc 06 §9)
  active BOOLEAN NOT NULL DEFAULT true,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- ── Scorecard ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scorecard_metric (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  name TEXT NOT NULL,
  owner_person TEXT REFERENCES staff(person) ON DELETE SET NULL,
  cadence TEXT NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly','monthly')),
  unit TEXT,                                       -- 'count' | 'days' | '%' | '$'…
  goal_op TEXT NOT NULL DEFAULT 'lte' CHECK (goal_op IN ('gte','lte')),
  goal_value NUMERIC,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('metrics_snapshot','kpi_snapshot','sql','manual')),
  source_ref TEXT,                                 -- e.g. 'open_exceptions.total'
  active BOOLEAN NOT NULL DEFAULT true,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS scorecard_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID NOT NULL REFERENCES scorecard_metric(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,                        -- Monday of the week
  value NUMERIC,
  on_track BOOLEAN,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  entered_by TEXT,                                 -- human or 'system:scorecard'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric_id, week_start)
);

-- ── Issues & To-Dos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS issue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  title TEXT NOT NULL,
  detail TEXT,
  raised_by TEXT NOT NULL,                         -- person | 'agent:<n>' | 'tripwire:<n>'
  source_ref TEXT,                                 -- wo id, proposal id, metric id…
  priority INT NOT NULL DEFAULT 3,                 -- 1 = highest
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','discussed','solved','parked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_issue_open ON issue (org_id, status, priority)
  WHERE status IN ('open','discussed');
-- Dedupe rung: one OPEN issue per evidence ref.
CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_open_source_ref
  ON issue (org_id, source_ref) WHERE source_ref IS NOT NULL AND status = 'open';

CREATE TABLE IF NOT EXISTS todo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  title TEXT NOT NULL,
  owner_person TEXT REFERENCES staff(person) ON DELETE SET NULL,
  due_on DATE NOT NULL DEFAULT (CURRENT_DATE + 7),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('meeting','issue','decision','agent','manual')),
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','missed','rolled')),
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_todo_open ON todo (org_id, status, due_on)
  WHERE status = 'open';

-- ── Meetings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  kind TEXT NOT NULL DEFAULT 'L10'
    CHECK (kind IN ('L10','huddle','quarterly','annual','same_page')),
  starts_at TIMESTAMPTZ NOT NULL,
  seat_scope TEXT,                                 -- null = whole company
  agenda JSONB NOT NULL DEFAULT '[]'::jsonb,
  minutes_md TEXT,
  rating INT CHECK (rating BETWEEN 1 AND 10),
  facilitator_person TEXT REFERENCES staff(person) ON DELETE SET NULL,
  prep_packet_md TEXT,                             -- Meeting Prep agent output (2D)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('segue','scorecard','rock_review','headline','todo_review','ids','conclude')),
  ref_table TEXT,
  ref_id TEXT,
  outcome JSONB,
  sort INT NOT NULL DEFAULT 0
);

-- ── Decisions (the durable log the brain indexes) ───────────────────────
CREATE TABLE IF NOT EXISTS decision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  title TEXT NOT NULL,
  statement_md TEXT NOT NULL,
  context_md TEXT,
  decided_by TEXT NOT NULL,                        -- always a human (doc 06 §9)
  decided_in_meeting_id UUID REFERENCES meeting(id) ON DELETE SET NULL,
  issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
  effective_on DATE NOT NULL DEFAULT CURRENT_DATE,
  supersedes_decision_id UUID REFERENCES decision(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE issue ADD COLUMN IF NOT EXISTS
  solved_decision_id UUID REFERENCES decision(id) ON DELETE SET NULL;

-- ── Rocks ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  title TEXT NOT NULL,
  owner_person TEXT REFERENCES staff(person) ON DELETE SET NULL,
  quarter TEXT NOT NULL,                           -- '2026-Q3'
  due_on DATE,
  status TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on','off','done','dropped')),
  milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_from_issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Process library (Notion mirror first — doc 06 §7) ───────────────────
CREATE TABLE IF NOT EXISTS process (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  name TEXT NOT NULL,
  owner_seat_id UUID REFERENCES seat(id) ON DELETE SET NULL,
  steps_md TEXT,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','retired')),
  source TEXT NOT NULL DEFAULT 'notion_sync' CHECK (source IN ('notion_sync','native')),
  notion_page_id TEXT,
  followed_by_pct REAL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- ── audit_event (design note verbatim; append-only) ─────────────────────
CREATE TABLE IF NOT EXISTS audit_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload JSONB,
  channel_ref TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_event_subject
  ON audit_event (subject_type, subject_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_actor ON audit_event (actor, at DESC);

-- ── RLS per convention (service-role policy; app scopes org_id) ─────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seat','scorecard_metric','scorecard_entry','issue',
    'todo','meeting','meeting_item','decision','rock','process','audit_event']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access to %s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "Service role full access to %s" ON %I FOR ALL USING (true) WITH CHECK (true)',
      t, t);
  END LOOP;
END $$;
