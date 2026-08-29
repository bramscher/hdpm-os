# Referral Partner Portal — Batch Log

Running record of what each batch shipped, its verification, and any deviation
from `00-referral-portal-plan.md`. One section per batch.

---

## Batch 0 — Migrations + RLS scaffolding + isolation guardrail (2026-08-28)

**Status:** ✅ built + DB-verified on `feature/partners` (migration applied + `referrals-rls-verify.sql` returned `ALL CHECKS PASSED`, 2026-08-28). `REFERRAL_FIELD_KEY` set in `.env.local` + Vercel (validated: 32-byte key, AES-256-GCM round-trips).

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

---

## Batch 2 — Referrer auth + onboarding (2026-08-28)

**Status:** ✅ built + onboarding DB-verified on `feature/partners` (migration `20260828c` applied; `scripts/referrals-batch2-verify.mjs` returned `ALL BATCH 2 CHECKS PASSED` against the live stack — invite→accept→auth-user-linked, TIN encrypted at rest, W-9 stored, invite single-use, self-cleaned; 2026-08-28). Remaining: the **magic-link login smoke** (needs the Supabase redirect URLs + a browser; the onboarding path it leads into is proven).

**Decisions (from Craig):** magic-link (passwordless) login; admin **copies an invite link** (no SMTP dependency). New dep: **`@supabase/ssr`** (cookie/session handling for the second auth system — hand-rolling it would be fragile and security-sensitive).

### What shipped

| Deliverable | File |
|---|---|
| Invite tokens + agreement metadata + private W-9 bucket | `supabase/migrations/20260828c_referral_invite_and_docs.sql` |
| Referrer Supabase clients (browser + SSR) | `lib/referrals/supabase-referrer.ts` |
| `requireReferrer()` / referrer DB context (the sanctioned RLS path) | `lib/referrals/referrer-context.ts` |
| Invite create/validate/consume | `lib/referrals/invites.ts` |
| Onboarding accept (link auth user, encrypt TIN, store W-9, activate) | `lib/referrals/onboarding.ts` |
| W-9 storage helpers | `lib/referrals/storage.ts` |
| Versioned agreement text + hash | `lib/referrals/agreement.ts` |
| Referrer routes (login, auth callback, invite/accept, dashboard) | `app/partners/(referrer)/**` |
| Admin invite API + accept API | `app/api/partners/admin/referrers/[id]/invite/route.ts`, `app/api/partners/invite/accept/route.ts` |
| Admin "Invite" button + copyable link | `app/partners/admin/referrers/referrers-admin.tsx` |
| Live-stack onboarding verifier | `scripts/referrals-batch2-verify.mjs` |

### How the two auth systems coexist

- **Referrer routes self-guard via Supabase Auth**, not staff next-auth. `proxy.ts`
  carves out `/partners` + `/api/partners` (EXCEPT the `/admin` subtree, which stays
  admin-gated) so the staff token gate doesn't bounce referrers to `/login`.
- **AppShell** skips the staff chrome for referrer routes (same branch as `/login`);
  the `(referrer)` route group brings its own minimal layout. Admin keeps the shell.
- Session cookie is `sb-<ref>-auth-token` (distinct from `next-auth.session-token`).
- The isolation guardrail now covers `app/api/partners` too; referrer routes get
  their DB client only via `referrer-context` (JWT-bound, RLS). Service-role work
  (invite/onboarding) lives in `lib/`, invoked by thin routes.

### Flow

1. Admin clicks **Invite** on a referrer → `/partners/invite/<token>` link (copies it, sends it).
2. Referrer opens link → confirms email, accepts the agreement, enters legal name / TIN /
   address, uploads W-9 → **accept** links a Supabase Auth user (email pre-confirmed),
   encrypts the TIN, stores the W-9, marks the partner active, consumes the invite.
3. Referrer signs in at `/partners/login` via magic link → `/partners/auth/callback` →
   dashboard, which reads their own row **through RLS**.

### Craig's steps to close Batch 2

1. **Apply** `supabase/migrations/20260828c_referral_invite_and_docs.sql`.
2. **Supabase → Auth → URL Configuration → Redirect URLs:** add
   `http://localhost:3000/partners/auth/callback` and
   `https://<prod-domain>/partners/auth/callback`. (Needed for magic-link login to
   return; not needed for onboarding.) Email provider should be enabled (default).
3. **Verify onboarding:** `node scripts/referrals-batch2-verify.mjs` → expect
   `ALL BATCH 2 CHECKS PASSED` (creates + self-cleans a test referrer/auth-user).
4. **Login smoke** (once deployed to preview/prod, or on localhost dev with email):
   invite a real referrer, accept, then sign in via magic link.

### Verification (so far)

- ✅ `npx tsc --noEmit` — 0 errors (incl. a surgical TS2589 fix in `lib/inspection-notify.ts`
  caused by the supabase-js bump `2.47 → 2.112` that `@supabase/ssr` pulled in; runtime unchanged).
- ✅ `npm run lint:referrals` — passes; referrer routes use `referrer-context`, not the service role.
- ✅ 21/21 unit tests.
- ✅ **Live onboarding** — `node scripts/referrals-batch2-verify.mjs` → `ALL BATCH 2
  CHECKS PASSED`: referrer created, invite minted, accepted (auth user linked via
  `auth.admin.createUser`, agreement recorded, W-9 uploaded to `referral-docs`), TIN
  ciphertext at rest (starts `v1.`, no cleartext, decrypts to original, last4=6789),
  invite consumed (single-use); auth user + referrer + W-9 self-cleaned.
- ⏳ **Magic-link login** — needs the redirect URLs + a browser (deploy or localhost
  dev with email). The onboarding it leads into is proven above.

---

## Batch 3 — Lead pipeline + attribution (2026-08-28) — VALUE CHECKPOINT

**Status:** ✅ built + pipeline DB-verified on `feature/partners` (migration `20260828d` applied; `scripts/referrals-batch3-verify.mjs` returned `ALL BATCH 3 CHECKS PASSED` — attribution referral/organic, first-touch dedupe, append-only stage events; self-cleaned; 2026-08-28). Remaining: the **referrer-insert RLS** SQL verifier (SQL Editor) + the hdpm-web cross-repo change. This is the plan's value checkpoint.

### What shipped

| Deliverable | File |
|---|---|
| Referrer lead-INSERT RLS policy | `supabase/migrations/20260828d_referral_lead_submit_rls.sql` |
| Lead types + stages | `lib/referrals/types.ts` |
| Dedupe (pure matcher: email→phone→name) | `lib/referrals/dedupe.ts` (+ 9 tests) |
| Lead service layer (intake, dedupe, finalize, admin ops) | `lib/referrals/leads.ts` |
| Referrer submit/list API (RLS insert + service finalize) | `app/api/partners/leads/route.ts` |
| Website intake API (S2S, `referrals` scope) | `app/api/intake/referral-lead/route.ts` |
| Admin pipeline API (list + stage/dedupe/link) | `app/api/partners/admin/leads/route.ts`, `[id]/route.ts` |
| Referrer leads UI (list + submit) | `app/partners/(referrer)/leads/**` |
| Admin pipeline UI (list + detail) | `app/partners/admin/leads/**` |
| hdpm-web attribution spec (cross-repo) | `docs/partners/02-hdpm-web-attribution.md` |
| `referrals` service scope | `lib/service-tokens.ts` |
| Verifiers | `scripts/referrals-batch3-verify.mjs`, `scripts/referrals-batch3-rls-verify.sql` |

### Design notes

- **Two submission paths, one funnel:** the referrer portal RLS-inserts the lead
  as the referrer (DB-enforced `partner_id=self`, `source=referral`), then a lib
  service step writes the `created` event + runs cross-tenant dedupe (which a
  referrer can't see, by design). The website intake (`/api/intake/referral-lead`,
  S2S) inserts + finalizes service-side; unknown/absent `ref_code` → `organic`.
- **First-touch-wins dedupe:** at submit, the prospect is matched (email → phone →
  exact normalized name) against open leads + (best-effort) live AppFolio owners.
  A hit flags `dup_status='suspected'` and points `dup_of_lead_id` at the earlier
  lead — never auto-rejects; admin confirms/clears with a logged event. AppFolio
  owner fetch is wrapped so a slow/failed call never blocks a submission.
- **Cross-repo:** only the `hdpm_ref` cookie + owner-form POST live in hdpm-web —
  spec in `02-hdpm-web-attribution.md`. The receiving endpoint is done here.

### Craig's steps to close Batch 3

1. **Apply** `supabase/migrations/20260828d_referral_lead_submit_rls.sql`.
2. **Verify the pipeline:** `node scripts/referrals-batch3-verify.mjs` → expect
   `ALL BATCH 3 CHECKS PASSED` (attribution referral/organic, dedupe first-touch,
   stage events; self-cleans).
3. **Verify referrer-insert RLS:** paste `scripts/referrals-batch3-rls-verify.sql`
   into the SQL Editor → expect `ALL BATCH 3 RLS CHECKS PASSED` (referrer can
   insert only its own `referral` leads; cross-partner + `organic` blocked; rolls back).
4. **Schedule the hdpm-web change** (`docs/partners/02-hdpm-web-attribution.md`)
   with whoever owns that repo — needed before `?ref` links credit partners from
   the website. A `referrals`-scoped service token must be minted for it.

### Verification (so far)

- ✅ `npx tsc --noEmit` — 0 errors. ✅ `npm run lint:referrals` — passes (referrer
  routes RLS-insert via `referrer-context`; service-role work stays in `lib/`).
- ✅ 30/30 unit tests (crypto 10, codes 5, fee-policy 6, dedupe 9).
- ⏳ Live pipeline + referrer-insert RLS — Craig's steps above.

---

## Batch 4 — Notifications (2026-08-28)

**Status:** built + typechecked + guardrail-clean + 37/37 unit tests on `feature/partners` (built autonomously while Craig was away). **Awaiting Craig:** apply migration `20260828e`, set `REFERRAL_ADMIN_EMAIL`, verify Resend DKIM/SPF for external mail, run the verifier + a pilot email check.

### What shipped

| Deliverable | File |
|---|---|
| `notify_email` opt-out column | `supabase/migrations/20260828e_referral_notify_prefs.sql` |
| Pure email templates + `shouldNotify` logic (7 tests) | `lib/referrals/notify-templates.ts` |
| Send + log service (best-effort, opt-out aware) | `lib/referrals/notify.ts` |
| Live triggers wired into lead events | `lib/referrals/leads.ts` (finalizeNewLead, setLeadStage) |
| Admin W-9 reminder API + button | `app/api/partners/admin/referrers/[id]/w9-reminder/route.ts`, `referrers-admin.tsx` |
| Schema verifier | `scripts/referrals-batch4-verify.mjs` |

### Behavior

- **lead submitted → referral ops** (`REFERRAL_ADMIN_EMAIL`), fired from
  `finalizeNewLead` (both submission paths).
- **stage change → referrer**, fired from `setLeadStage`, only on a real
  transition, only for referral leads with an email, respecting `notify_email`.
- **W-9 missing → referrer**, admin-triggered from the referrers table.
- Accrual/payout notifications are stubbed (functions ready) for Batches 5/7/8.
- Every attempt writes `referral_notification_log` (`sent|skipped|failed` + detail);
  notifications are **best-effort** and never block the triggering action (wrapped
  in try/catch; `sendEmail` returns `skipped` when `RESEND_API_KEY` is absent).

### ⚠️ Deliverability (the plan's Batch 4 caveat)

Referrers are **external** recipients. Resend will only deliver to them if the
From domain (`AGENT_EMAIL_FROM` / default) has verified **DKIM/SPF**. Verify this
in Resend before relying on referrer email — until then, sends may log `failed`.
The log makes gaps visible rather than silent.

### Craig's steps to close Batch 4

1. **Apply** `supabase/migrations/20260828e_referral_notify_prefs.sql`.
2. Set env **`REFERRAL_ADMIN_EMAIL`** (where "new lead" alerts go) in `.env.local` + Vercel.
3. In Resend, confirm the sending domain has **DKIM/SPF** verified for external delivery.
4. **Verify schema:** `node scripts/referrals-batch4-verify.mjs` → `ALL BATCH 4 CHECKS PASSED`.
5. **Pilot email check:** invite a referrer, move a lead's stage, confirm the email
   arrives and `referral_notification_log` shows `sent`.

### Verification (so far)

- ✅ `npx tsc --noEmit` — 0 errors. ✅ `npm run lint:referrals` — passes.
- ✅ 37/37 unit tests (added 7 notification-template cases).
- ⏳ Live schema verifier + pilot email — Craig's steps above.

## Deferred decisions

- **Hosting domain (2026-08-28):** portal stays in HDPM-OS (admin + referrer);
  only the `?ref` attribution capture lives in hdpm-web (`02-hdpm-web-attribution.md`).
  Pilot runs on `hdpmchat.highdesertpm.com/partners` **as-is** (Craig's call). Post-pilot
  branding option: alias `partners.highdesertpm.com` to this Vercel app (DNS + one
  Supabase redirect URL, zero code changes) — not moving code to hdpm-web.

### Not blocking Batch 0, tracked for later

- Oregon fee-policy legal sign-off (before any `allowed=true`, batch 5 go-live).
- Batch 6a trailing-fee income-source feasibility spike (before batches 6–8).
- hdpm-web attribution cross-repo scheduling (before Batch 3's companion task).
