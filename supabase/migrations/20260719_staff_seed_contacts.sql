-- ============================================
-- Agent-OS Brief B: staff contact seed — Slack user IDs + emails
-- Date: 2026-07-19
-- Run manually in the Supabase SQL Editor AFTER 20260719_staff.sql.
-- Bryce has no Slack workspace account; his row stays NULL.
-- ============================================

UPDATE staff SET slack_user_id = 'U0BBUJALNE6', email = 'cheryl@highdesertpm.com'  WHERE person = 'Cheryl';
UPDATE staff SET slack_user_id = 'U0BB3E63483', email = 'craig@highdesertpm.com'   WHERE person = 'Craig';
UPDATE staff SET slack_user_id = 'U0BBP5ZCQJE', email = 'brody@highdesertpm.com'   WHERE person = 'Brody';
UPDATE staff SET slack_user_id = 'U0BBUHZPFL2', email = 'ashley@highdesertpm.com'  WHERE person = 'Ashley';
UPDATE staff SET slack_user_id = 'U0BBWDLJXFB', email = 'bianca@highdesertpm.com'  WHERE person = 'Bianca';
UPDATE staff SET slack_user_id = 'U0BCNSJ71UY', email = 'matt@highdesertpm.com'    WHERE person = 'Matt';
UPDATE staff SET slack_user_id = 'U0BBD42CZTR', email = 'penny@highdesertpm.com'   WHERE person = 'Penny';
UPDATE staff SET slack_user_id = 'U0BBR6HJ753', email = 'kennedy@highdesertpm.com' WHERE person = 'Kennedy';
UPDATE staff SET slack_user_id = 'U0BBY7H7Q84', email = 'alberto@highdesertpm.com' WHERE person = 'Alberto';
UPDATE staff SET slack_user_id = 'U0BBD43HGTZ', email = 'jen@highdesertpm.com'     WHERE person = 'Jen';
