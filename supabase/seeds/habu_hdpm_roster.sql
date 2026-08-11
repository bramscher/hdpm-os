-- ============================================
-- HABU tenant #1 (HDPM) seed — the agent roster + the seats they hold.
-- TENANT DATA, not core (habu-core ships zero agents; §1.1). Apply AFTER core
-- migrations 0001–0008 are live. Idempotent (ON CONFLICT DO NOTHING).
--
-- Naming: process names for now ("Move-Out Agent"); the team personalizes them
-- later. agent.id is the STABLE key — renaming only touches display_name, so no
-- seat/config rewiring. Roles defined in docs/habu/agent-seats.md.
--
-- org_id = 'hdpm'. Human seats reference the existing staff table
-- (person keys: Matt, Jen, Kennedy, Penny). Jayme Payne is added (new hire).
-- ============================================

-- New hire referenced by the assistant seat.
INSERT INTO staff (person, name, role) VALUES
  ('Jayme', 'Jayme Payne', 'Assistant')
ON CONFLICT (person) DO NOTHING;

-- ── Human seats (escalation targets) ─────────────────────────────────────
-- PM is multiple people (Matt exec, Jen senior, Kennedy) + a new head TBD.
-- Property→PM routing is a later refinement; agents default-escalate to the
-- Executive PM (Matt) until the property map lands.
INSERT INTO seat (id, org_id, name, roles, reports_to_seat_id, holder_type, person_id, escalation_seat_id, sort) VALUES
  ('aaaa0000-0000-4000-8000-000000000001', 'hdpm', 'Property Manager — Matt',    ARRAY['pm','executive'], NULL, 'human', 'Matt',    NULL, 1),
  ('aaaa0000-0000-4000-8000-000000000002', 'hdpm', 'Property Manager — Jen',     ARRAY['pm','senior'],    NULL, 'human', 'Jen',     NULL, 2),
  ('aaaa0000-0000-4000-8000-000000000003', 'hdpm', 'Property Manager — Kennedy', ARRAY['pm'],             NULL, 'human', 'Kennedy', NULL, 3),
  ('aaaa0000-0000-4000-8000-000000000004', 'hdpm', 'Finance',                    ARRAY['finance'],        NULL, 'human', 'Penny',   NULL, 4),
  ('aaaa0000-0000-4000-8000-000000000005', 'hdpm', 'Assistant',                  ARRAY['assistant'],      NULL, 'human', 'Jayme',   NULL, 5)
ON CONFLICT (id) DO NOTHING;

-- Open seats (holder TBD).
INSERT INTO seat (id, org_id, name, roles, holder_type, sort) VALUES
  ('aaaa0000-0000-4000-8000-000000000006', 'hdpm', 'PM Assistant', ARRAY['pm_assistant'], 'open', 6),
  ('aaaa0000-0000-4000-8000-000000000007', 'hdpm', 'Maintenance',  ARRAY['maintenance'],  'open', 7)
ON CONFLICT (id) DO NOTHING;

-- ── Agent identities ─────────────────────────────────────────────────────
INSERT INTO agent (id, org_id, display_name, title, avatar, persona, expertise) VALUES
  ('move_out',        'hdpm', 'Move-Out Agent',        'Turnover Coordinator', '🧰',
     'friendly, terse, a little dogged',
     ARRAY['move-out flow','turnover scheduling','key tracking','deadline watching']),
  ('leasing',         'hdpm', 'Leasing Agent',         'Move-In & Leasing',    '🔑',
     'warm, organized, fast to follow up',
     ARRAY['applicant comms','deposit-to-hold','move-in packet','listing takedown']),
  ('listing',         'hdpm', 'Listing Agent',         'Advertising',          '📣',
     'crisp, marketing-minded',
     ARRAY['AppFolio/website/Craigslist listings','ad copy','listing hygiene']),
  ('finance_closer',  'hdpm', 'Finance Agent',         'Close-Out & Verification', '💸',
     'precise, skeptical, shows its math',
     ARRAY['owner close-out','ledger verification','invoice reconciliation']),
  ('onboarding_prep', 'hdpm', 'Onboarding Prep Agent', 'Owner Onboarding Prep', '📋',
     'thorough, anticipatory',
     ARRAY['owner packet assembly','meeting prep','property/utility data'])
ON CONFLICT (org_id, id) DO NOTHING;

-- ── Agent seats (holder_type='agent'; each names a human escalation seat) ──
INSERT INTO seat (id, org_id, name, roles, reports_to_seat_id, holder_type, agent_id, escalation_seat_id, sort) VALUES
  ('bbbb0000-0000-4000-8000-000000000001', 'hdpm', 'Move-Out Coordinator', ARRAY['move_out'],
     'aaaa0000-0000-4000-8000-000000000001', 'agent', 'move_out',        'aaaa0000-0000-4000-8000-000000000001', 10),
  ('bbbb0000-0000-4000-8000-000000000002', 'hdpm', 'Leasing',             ARRAY['leasing'],
     'aaaa0000-0000-4000-8000-000000000001', 'agent', 'leasing',         'aaaa0000-0000-4000-8000-000000000001', 11),
  ('bbbb0000-0000-4000-8000-000000000003', 'hdpm', 'Listing / Advertising', ARRAY['listing'],
     'aaaa0000-0000-4000-8000-000000000001', 'agent', 'listing',         'aaaa0000-0000-4000-8000-000000000001', 12),
  ('bbbb0000-0000-4000-8000-000000000004', 'hdpm', 'Finance Closer',      ARRAY['finance_closer'],
     'aaaa0000-0000-4000-8000-000000000004', 'agent', 'finance_closer',  'aaaa0000-0000-4000-8000-000000000004', 13),
  ('bbbb0000-0000-4000-8000-000000000005', 'hdpm', 'Owner Onboarding Prep', ARRAY['onboarding_prep'],
     'aaaa0000-0000-4000-8000-000000000001', 'agent', 'onboarding_prep', 'aaaa0000-0000-4000-8000-000000000001', 14)
ON CONFLICT (id) DO NOTHING;

-- ── Autonomy (agent_config): internal L3, tenant/money hard-capped at L2 ────
INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, owner_role) VALUES
  -- Move-Out Agent
  ('move_out',        'schedule_clean',    3, 3, 'Matt'),
  ('move_out',        'chase_keys',        3, 3, 'Matt'),
  ('move_out',        'draft_tenant_msg',  1, 2, 'Matt'),   -- tenant-facing: draft, human sends
  -- Leasing Agent
  ('leasing',         'schedule_applicant',3, 3, 'Matt'),
  ('leasing',         'draft_applicant_msg',1, 2, 'Matt'),  -- tenant-facing wall
  ('leasing',         'deposit_ledger',    1, 2, 'Penny'),  -- money wall
  -- Listing Agent
  ('listing',         'update_listing',    3, 3, 'Matt'),
  ('listing',         'charge_ad_fee',     1, 2, 'Penny'),  -- money wall
  -- Finance Agent (verify only; never moves money)
  ('finance_closer',  'verify_closeout',   2, 2, 'Penny'),
  ('finance_closer',  'draft_owner_stmt',  1, 2, 'Penny'),  -- owner-facing wall
  -- Onboarding Prep Agent
  ('onboarding_prep', 'assemble_packet',   2, 2, 'Matt')
ON CONFLICT (agent, action_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
