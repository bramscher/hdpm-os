-- ============================================
-- HABU tenant #1 (HDPM) seed — the Move-Out jacket template (Phase B, step 1).
-- The digital replica of the physical yellow "Vacancy Tracking" jacket
-- (form rev 11/2025): 5 parallel tracks (TENANT / OWNER / ADVERTISING /
-- VACANCY / CLOSE OUT). See spec Appendix A.1 and the 30-Day-Notice SOP.
--
-- TENANT DATA, not core (habu-core ships zero templates). Requires only that the
-- `jacket_template` table exists — run packages/habu-core/migrations/0005_jacket.sql
-- first. This seed is INDEPENDENT of the roster seed / seat table: steps store
-- seat_role STRINGS (move_out, pm, listing, finance_closer) that resolve to seats
-- later, at jacket instantiation — not at seed time.
-- Idempotent via UNIQUE (org_id, key) → ON CONFLICT DO NOTHING.
--
-- The `steps` JSONB below is kept byte-for-byte in sync with the canonical
-- MOVE_OUT_TEMPLATE constant (packages/habu-core/src/jacket/templates/move-out.ts)
-- by a drift test (move-out-template.test.ts). Edit the constant, not this blob.
-- ============================================

INSERT INTO jacket_template (org_id, key, title, color, steps, active) VALUES
  ('hdpm', 'move-out', 'Move-out', 'yellow', '[
{"label":"Save move-out date in AppFolio","track":"TENANT","seat_role":"move_out","due_rule":"created+1bd"},
{"label":"Confirm forwarding address (else calendar follow-up)","track":"TENANT","seat_role":"move_out","due_rule":"created+3bd"},
{"label":"Send move-out confirmation to tenant","track":"TENANT","seat_role":"move_out"},
{"label":"Enter prorated rent","track":"TENANT","seat_role":"move_out"},
{"label":"Calendar move-out inspection (day after keys due)","track":"TENANT","seat_role":"move_out"},
{"label":"Check for scheduled property inspection","track":"TENANT","seat_role":"move_out"},
{"label":"Submit to Property Manager","track":"TENANT","seat_role":"move_out"},
{"label":"Notify owner of move-out","track":"OWNER","seat_role":"pm"},
{"label":"Owner termination fee (if applicable)","track":"OWNER","seat_role":"pm"},
{"label":"Set rent amount for new listing","track":"OWNER","seat_role":"pm"},
{"label":"Confirm W/D, utilities, landscaping, pets, lease term","track":"OWNER","seat_role":"pm"},
{"label":"Set availability date","track":"OWNER","seat_role":"pm"},
{"label":"Check utility / appliance info","track":"ADVERTISING","seat_role":"listing"},
{"label":"Update AppFolio / website","track":"ADVERTISING","seat_role":"listing"},
{"label":"Update Craigslist","track":"ADVERTISING","seat_role":"listing"},
{"label":"Attach posting to property page","track":"ADVERTISING","seat_role":"listing"},
{"label":"Charge ad fee","track":"ADVERTISING","seat_role":"listing"},
{"label":"Email key reminder + forwarding address","track":"VACANCY","seat_role":"move_out"},
{"label":"Record keys returned (date / by / via)","track":"VACANCY","seat_role":"move_out"},
{"label":"Enter actual move-out date in AppFolio","track":"VACANCY","seat_role":"move_out"},
{"label":"Record key counts (house / mail / garage / pool)","track":"VACANCY","seat_role":"move_out"},
{"label":"Holdover rent? — if yes, email finance to charge","track":"VACANCY","seat_role":"move_out"},
{"label":"Receipt keys in / pull all keys to PM inspection box","track":"VACANCY","seat_role":"move_out"},
{"label":"Set new-tenant move-in date","track":"VACANCY","seat_role":"move_out"},
{"label":"Early termination fee — email finance to charge","track":"CLOSE OUT","seat_role":"finance_closer"},
{"label":"Enter forwarding address in AppFolio","track":"CLOSE OUT","seat_role":"finance_closer"},
{"label":"Check outstanding balances","track":"CLOSE OUT","seat_role":"finance_closer"},
{"label":"Create final accounting","track":"CLOSE OUT","seat_role":"finance_closer"},
{"label":"Enter vendor invoices","track":"CLOSE OUT","seat_role":"finance_closer"},
{"label":"Transfer funds / post management fees","track":"CLOSE OUT","seat_role":"finance_closer"},
{"label":"Mail check & info to tenant","track":"CLOSE OUT","seat_role":"finance_closer"}
]'::jsonb, true)
ON CONFLICT (org_id, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
