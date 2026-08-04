# HDPM-OS Phase 0 — Session Briefs

> Created 2026-08-03 on `feature/hdpmos`. Phase 0 objective (roadmap doc 10):
> make the chassis safe and reproducible before new layers land. Split into
> four session briefs, executed in order, one per session, plan mode first.
> No product features in any of these.

## Brief A — DB-backed roles & centralized guards  ⟵ SHIPPED 2026-08-03

> **Execution notes (deviations from plan):**
> - Column is **`staff.access_role`**, not `staff.role` — `staff.role`
>   already exists holding job titles (display/routing); left untouched.
> - The "known two" bare `getServerSession()` calls turned out to be **82
>   files**; all codemodded to `getServerSession(authOptions)` with the
>   import added. Zero bare calls remain (acceptance met).
> - `staff` already had RLS from `20260719_staff.sql`; migration only adds
>   the column + constraint + admin seed + email index.
> - Migration `20260803_staff_access_role.sql` **pending Craig's SQL-editor
>   run**; until then the env fallback keeps admin working (logged).
> - Domain-check consolidation: `isCompanyEmail()` lives in
>   `lib/require-role.ts`; `api-auth.ts` uses it; the 80-odd inline
>   `endsWith('@highdesertpm.com')` route checks still work and migrate to
>   `requireCompanySession()` opportunistically as routes are touched.

**Objective:** authorization stops depending on an env string; one source of
truth for "who can do what," auditable in the database.

**Scope / tasks:**
1. Migration `staff.role`: `role text not null default 'staff'
   check (role in ('admin','manager','pm','maintenance','finance',
   'front_desk','inspector','field','staff','read_only'))` + partial index.
   Seed: set `role='admin'` for the emails currently in `ADMIN_EMAILS`
   (Craig runs migration in SQL editor per convention; seed statement
   generated from env at authoring time, values not committed).
2. `lib/roles.ts` — single source: `getRoleForEmail(email)` reading `staff`
   (60s in-memory cache), `isAdmin()` delegating to it. `lib/admin.ts`
   becomes a shim over it; **env `ADMIN_EMAILS` demoted to bootstrap
   fallback** (used only when the staff table has zero admins) and logged
   when used.
3. JWT: stamp `token.role` (not just `isAdmin`) in `lib/auth.ts` callbacks;
   surface `session.user.role`.
4. Guard consolidation: one `requireRole(...roles)` in `lib/require-role.ts`;
   `requireAdmin()` re-implemented on it; fix all `getServerSession()` call
   sites missing `authOptions` (known: `app/api/chat/route.ts:8`,
   `lib/maintenance/api-auth.ts`); remove the duplicated domain checks in
   favor of one helper.
5. Middleware: `isAdminPath` reads `token.role === 'admin'` (back-compat
   with `isAdmin` claim during rollout).
6. Enable RLS on `staff` (service-role policy, matching convention) and add
   the "RLS on all new tables" note to `supabase/migrations/README` (create
   if absent).
7. Tests: unit tests for role resolution, fallback bootstrap, and
   `requireRole`; typecheck + existing vitest suite green.

**Acceptance:** admin behavior unchanged for current admins; adding an admin
is a `staff` row update (no redeploy); zero remaining bare
`getServerSession()` calls; suite green; migration file ready for SQL
editor.

**Out of scope:** Auth.js v5 (Brief B), per-service tokens (Brief C), any
RLS retrofits on existing tables.

**Risks:** JWTs live 8h — role changes lag until refresh (acceptable;
documented); bootstrap fallback prevents lockout if the seed is missed.

---

## Brief B — Auth.js v5 + middleware→proxy migration

next-auth v4 (maintenance mode) → Auth.js v5; replace deprecated
`middleware.ts` `withAuth` with the proxy convention Next 16 wants; verify
Azure AD provider config, JWT/session callbacks, 8h maxAge, domain gate, and
the delegated Graph token flow (`route-calendar.ts` consumer). Staging pass
required (login, admin gate, calendar publish, chat). **Risk:** biggest
regression surface in Phase 0 — isolated on purpose.

## Brief C — Schema capture, secrets hygiene, service tokens

1. Dump live Supabase definitions for the missing RAG core
   (`knowledge_chunks`, `conversations`, `conversation_messages`, RPCs,
   pgvector extension/indexes) into a dated baseline migration so
   `supabase db reset` reproduces prod.
2. Secrets: verify `.env.local` never entered git history (scan); rotate
   anything that did; add a gitleaks-style CI check.
3. Split `HDPM_SERVICE_TOKEN` into per-service scoped tokens (`svc:intake`,
   `svc:agent-service`, `svc:cron`) — table-backed with hashed tokens, the
   existing `requireStaffOrService()` extended to resolve scope.
4. Dead code: retire legacy `/api/work-orders` (confirm zero callers first).

## Brief D — Repo rename + audit_event design note

Rename GitHub repo → `hdpm-os` (redirects stand; update local remotes,
Vercel git link, any webhook URLs pointing at the repo); write the
`audit_event` generalization design (1-pager, lands with the first EOS
migration in Phase 2 rather than as its own table now).

---

**Sequence rationale:** A unblocks every later role-gated surface and is
low-risk; B is the risky upgrade kept alone; C is reproducibility +
credentials; D is cosmetic/paper. After D, Phase 1 (brain PoC) begins.
