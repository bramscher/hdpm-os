-- ============================================
-- Agent-OS Brief D.5: estimate_chaser 'vendor_chase_sms' action_type.
--
-- Vendor chase by text, SMS-first (Craig 2026-07-20): vendors with a known
-- phone get a proposed text on Cheryl's Slack "Text chase queue" card —
-- L2 send-on-tap (SMS has no drafts folder, so L1 doesn't map; her tap is
-- the review, sent from her Zoom line). Ceiling 3 = the vendor-comms
-- ceiling (Q2). Email vendor_chase (L1) remains for no-phone vendors.
--
-- Run manually in the Supabase SQL Editor.
-- ============================================

INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, max_per_day, owner_role) VALUES
  ('estimate_chaser', 'vendor_chase_sms', 2, 3, 10, 'Cheryl')
ON CONFLICT (agent, action_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
