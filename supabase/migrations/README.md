# Migration conventions

- Migrations are applied **manually in the Supabase SQL Editor** by Craig
  (no CLI pipeline); every file must be idempotent (`IF NOT EXISTS`,
  `DROP POLICY IF EXISTS` before `CREATE POLICY`, guarded seeds).
- **RLS on every new table**, minimum policy: enable RLS + the
  "Service role full access" policy (see `20260719_staff.sql`). The app
  accesses Supabase via the service role, so RLS is defense-in-depth today
  and the seam for authenticated-client access later — do not skip it.
- Multi-tenant seam: new tables that could ever be per-tenant carry
  `org_id` (agent-os Q7); single-org values are fine for now.
- Never mix mirror columns and app-owned workflow columns without updating
  `lib/maintenance/sync-rules.ts` ownership lists.
- Known gap (Phase 0, Brief C): the RAG core (`knowledge_chunks`,
  `conversations`, `conversation_messages`, pgvector RPCs) predates this
  folder and needs a captured baseline migration.
