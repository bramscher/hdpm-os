-- Notices v2: who marked a tenant notice sent, and the date a tenant was told
-- before their route moved (non-null = "date changed – re-notice").
-- Idempotent.

ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS notice_sent_by TEXT;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS notice_previous_target_date DATE;

COMMENT ON COLUMN public.inspections.notice_sent_by IS
  'Email (or Slack user) of whoever marked the tenant notice sent.';
COMMENT ON COLUMN public.inspections.notice_previous_target_date IS
  'Date the tenant was originally noticed for; set when the route date moves after a notice was sent. Cleared when the new notice is marked sent.';
