-- ============================================
-- Website tenant leads per day, for the Guest Card Volume trend
-- Date: 2026-10-20
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- The website (hdpm-web, schema payload_web) saves contact-form and listing
-- inquiries to its CRM `leads` table and emails staff to key them into
-- AppFolio by hand, so the AppFolio guest-card source breakdown undercounts
-- them. /api/kpi/trends calls this through the service role to chart the
-- CRM count alongside AppFolio.
--
-- SECURITY DEFINER so the service role doesn't need grants on payload_web;
-- it returns only per-day counts. Browser roles can't execute it.
--
-- Check: SELECT * FROM public.website_tenant_lead_days(now() - interval '30 days');
-- ============================================

CREATE OR REPLACE FUNCTION public.website_tenant_lead_days(since timestamptz)
RETURNS TABLE (day date, leads integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (l.created_at AT TIME ZONE 'UTC')::date AS day, count(*)::integer AS leads
  FROM payload_web.leads l
  WHERE l.source = 'website'
    AND l.lead_type = 'tenant'
    AND l.created_at >= since
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.website_tenant_lead_days(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_tenant_lead_days(timestamptz) TO service_role;
