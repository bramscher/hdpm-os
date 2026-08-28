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

### Not blocking Batch 0, tracked for later

- Oregon fee-policy legal sign-off (before any `allowed=true`, batch 5 go-live).
- Batch 6a trailing-fee income-source feasibility spike (before batches 6–8).
- hdpm-web attribution cross-repo scheduling (before Batch 3's companion task).
