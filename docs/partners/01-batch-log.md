# Referral Partner Portal — Batch Log

Running record of what each batch shipped, its verification, and any deviation
from `00-referral-portal-plan.md`. One section per batch.

---

## Batch 0 — Migrations + RLS scaffolding + isolation guardrail (2026-08-28)

**Status:** ✅ built + DB-verified on `feature/partners` (migration applied + `referrals-rls-verify.sql` returned `ALL CHECKS PASSED`, 2026-08-28). **Only remaining item: add `REFERRAL_FIELD_KEY` to env** (step 3 below) before Batch 2 stores any encrypted PII.

### What shipped

| Deliverable | File |
|---|---|
| All `referral_*` tables, RLS, append-only triggers, seeded `fee_policy` | `supabase/migrations/20260828_referrals_core.sql` |
| AES-256-GCM field encryption (TIN / payout) | `lib/referrals/crypto.ts` |
| Crypto round-trip unit test (CI) | `lib/referrals/__tests__/crypto.test.ts` |
| ESLint isolation guardrail (bans `getSupabaseAdmin` in referrer routes) | `.eslintrc.referrals.json` + `lint:referrals` npm script |
| Standing CI (guardrail + referral tests) | `.github/workflows/referrals-ci.yml` |
| DB-backed RLS + trigger verification (manual, rolls back) | `scripts/referrals-rls-verify.sql` |

### Design decisions made during build

1. **Table naming = `referral_` prefix in the `public` schema**, not a separate
   `referrals` schema. The plan allowed either; `public` is the repo convention
   (PostgREST exposes `public` by default; a separate schema needs extra config
   and would complicate the referrer anon-client path). All tables carry `org_id`.
2. **RLS scope for Batch 0 = SELECT-only for referrers.** Referrers read only
   their own rows via `auth.uid()`; INSERT/UPDATE policies (settings, lead
   submit) are deferred to the batches that need them (2, 3). Admin/app keeps
   the existing `service_role FOR ALL` passthrough on every table.
3. **`referral_current_partner_id()` is `SECURITY DEFINER`** so child-table
   policies resolve the caller's partner id without recursively triggering
   `referral_partner`'s own RLS.

### Deviations from the plan (verified against the codebase)

- **`next lint` is dead — this repo is Next.js 16**, which removed the `next lint`
  command (the `lint` script errors). The isolation guardrail therefore runs
  ESLint **directly** via a dedicated, self-contained config
  (`--no-eslintrc --config .eslintrc.referrals.json`) rather than through
  `next lint`. This also avoids the `eslint-config-next@14` ⇄ `next@16` version
  mismatch and keeps the rule from touching repo-wide linting.
- **There was no lint/test CI to hook into** — only `secret-scan.yml`. The plan's
  "standing CI test" required a new workflow (`referrals-ci.yml`), which runs the
  guardrail and the referral unit tests on every push/PR.

### Verification

- ✅ `npx vitest run lib/referrals` — 10/10 crypto tests pass (round-trip, random
  IV, unicode, tamper-detect, wrong-key, missing-key).
- ✅ Guardrail smoke test: a planted `getSupabaseAdmin` import under
  `app/partners/leads/` fails `npm run lint:referrals` (exit 1); the same import
  under `app/partners/admin/` is ignored; a clean `getSupabaseClient` import passes.
- ✅ **RLS isolation + append-only triggers** — `scripts/referrals-rls-verify.sql` returned
  `ALL CHECKS PASSED` against the live DB (2026-08-28): referrer A sees only its own
  rows, referrer B sees none of A's, neither sees `fee_policy`, and ledger/lead_event
  reject UPDATE/DELETE.

### Craig's manual steps to close Batch 0

1. **Apply the migration:** paste `supabase/migrations/20260828_referrals_core.sql`
   into the Supabase SQL Editor and run it. (Idempotent; safe to re-run.)
2. **Run the verifier:** paste `scripts/referrals-rls-verify.sql` and run it.
   Expect only `PASS:` / `NOTICE` lines ending in `ALL CHECKS PASSED`. It rolls
   back — no data is left behind. Any `FAIL:` aborts and means a policy/trigger
   is wrong.
3. **Add the encryption key** to the app env (`.env.local` and Vercel prod):
   `REFERRAL_FIELD_KEY=<32-byte base64>`. Generate with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   ⚠️ This key is unrecoverable-if-lost: anything encrypted with it (TIN, payout
   details) is undecryptable if the key changes. Store it like any other secret.

---

## Batch 1 — Admin referrer management (2026-08-28)

**Status:** ✅ built + DB-verified on `feature/partners` (migration `20260828b` applied; `scripts/referrals-batch1-verify.mjs` returned `ALL BATCH 1 CHECKS PASSED` against the live DB, 2026-08-28). Optional-remaining: a click-through of the React UI (localhost SSO is blocked by the prod-only redirect URI, so this waits for a preview/prod deploy — the service layer it drives is already proven).

### What shipped

| Deliverable | File |
|---|---|
| Per-referrer default-terms table + RLS | `supabase/migrations/20260828b_referral_partner_terms.sql` |
| Shared types (partner/policy/terms) | `lib/referrals/types.ts` |
| Referral-code generation (unique, no look-alikes) | `lib/referrals/codes.ts` |
| Fee-eligibility gate (pure) | `lib/referrals/fee-policy.ts` |
| Admin service layer (`requireReferralAdmin` + CRUD + gated set-terms) | `lib/referrals/admin.ts` |
| Referrer CRUD API | `app/api/partners/admin/referrers/route.ts`, `[id]/route.ts`, `[id]/terms/route.ts` |
| Fee-policy API | `app/api/partners/admin/fee-policy/route.ts` |
| Referrers admin UI | `app/partners/admin/referrers/page.tsx` + `referrers-admin.tsx` |
| Fee-policy admin UI | `app/partners/admin/fee-policy/page.tsx` + `fee-policy-admin.tsx` |
| Unit tests (codes, gate) | `lib/referrals/__tests__/codes.test.ts`, `fee-policy.test.ts` |

### Design decisions

1. **New table `referral_partner_terms`** for per-referrer DEFAULT fee terms. The
   plan enumerated only lead-scoped `referral_fee_agreement` (frozen at signing,
   `lead_id NOT NULL`), but Batch 1 sets terms before any lead exists. The plan's
   prose ("fee agreements are per referrer, default by type") is exactly this
   table; signing (Batch 3/5) snapshots FROM it INTO `referral_fee_agreement`.
2. **`requireReferralAdmin` = admin-only** for Batch 1, so all three gates agree:
   `proxy.ts` (added `/partners/admin` + `/api/partners/admin` to the admin edge
   gate), the page `isAdmin` redirect, and the API guard. Widen to manager/finance
   in one place when the payout batches need it.
3. **Eligibility gate returns HTTP 422** (`code: fee_not_allowed`), not 500 — a
   disallowed fee is expected policy, not an error.

### Verification

- ✅ `npx vitest run lib/referrals` — 21/21 (crypto 10, codes 5, fee-policy gate 6).
- ✅ `npx tsc --noEmit` — 0 errors.
- ✅ `npm run lint:referrals` — passes (admin routes legitimately use the service
  role and are excluded; the ban still fires on referrer routes).
- ✅ **Live-DB service-layer flow** — `node scripts/referrals-batch1-verify.mjs`
  passed against the real Supabase (service role, no SSO): created a referrer with
  a code + `pending` status; set-terms **blocked** while `owner × one_time_bounty`
  was disallowed (seed); after flipping the policy cell on, terms **saved** ($500
  bounty); self-cleaned (deleted the referrer, reset the cell). This exercises the
  same create/gate/upsert logic the API + UI call.
- ⏳ **React UI click-through** (optional) — localhost can't complete Entra SSO
  (prod-only redirect URI), so the visual pass waits for a preview/prod deploy.
  The underlying service layer is verified above. Manual smoke once deployed:
  create 3 referrers; Set-terms shows *no fee type enabled* until you Enable a
  cell in `/partners/admin/fee-policy`; pause/activate updates the badge.

### Not blocking Batch 0, tracked for later

- Oregon fee-policy legal sign-off (before any `allowed=true`, batch 5 go-live).
- Batch 6a trailing-fee income-source feasibility spike (before batches 6–8).
- hdpm-web attribution cross-repo scheduling (before Batch 3's companion task).
