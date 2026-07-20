-- ============================================
-- Agent-OS Brief D.5b: per-user Zoom OAuth tokens.
--
-- Zoom's SMS send endpoint requires a token OWNED by the sending user —
-- Server-to-Server tokens are rejected (error 7639; staff-confirmed on
-- devforum 133055) and the account-level variant is ISV-only (404 here).
-- So the sender (Cheryl) authorizes the user-managed "HDPM-OS SMS Sender"
-- app once via /api/agents/zoom-oauth/start; her access+refresh tokens
-- live here and auto-rotate on refresh (Zoom refresh tokens are
-- single-use). Service-role access only.
--
-- Run manually in the Supabase SQL Editor.
-- ============================================

CREATE TABLE IF NOT EXISTS zoom_user_token (
  email TEXT PRIMARY KEY,              -- authorizing user's Zoom login email
  zoom_user_id TEXT,                   -- Zoom user id (from /users/me)
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,     -- access-token expiry
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE zoom_user_token ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zoom_user_token_service ON zoom_user_token;
CREATE POLICY zoom_user_token_service ON zoom_user_token
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
