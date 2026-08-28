# HDPM Referral Partner Portal — Implementation Plan

## Context

**Why:** HDPM (~850 doors, targeting 1,500 in 24 months) wants a referral management portal — referral partners (owners, agents, builders, vendors) get a login to submit/track leads and see earnings; staff get an admin side to work the pipeline, approve fees, and manage one-time and recurring (trailing) payouts. It also becomes the attribution layer for organic owner leads captured on highdesertpm.com.

**How this plan was produced:** an "ultraplan" multi-agent pass on `feature/partners` — 7 parallel discovery agents read the actual codebase, then synthesis → adversarial critique → finalize. The critique verdict was **"Approve with conditions"**: the discovery is accurate on nearly every load-bearing claim, all 7 required deliverables are present, and the batch ordering genuinely reaches "onboard 3 referrers + log real leads" (Batch 1–3) before any trailing-fee/QBO code.

**Four spec assumptions were wrong (verified in code) and this plan designs against reality, not the spec:**
1. **This repo is NOT the marketing site.** `hdpm-chatbot` is the internal staff back-office; `highdesertpm.com` is a separate repo/deploy (`hdpm-web`) already wired S2S via `app/api/intake/rental-analysis-request/route.ts` + `lib/web-callback.ts`. hdpm-web's `Lead` is today's SoR for website leads.
2. **Auth is Auth.js v5 + Microsoft Entra ID (Azure AD), not Supabase Auth** (`lib/auth.ts`; `signIn` hard-rejects non-`@highdesertpm.com`). Referrer login is a **net-new second auth system.**
3. **No per-user RLS exists** — all ~22 RLS policies are service-role passthroughs; all 434 DB call sites use `getSupabaseAdmin()`. Referrer isolation via `auth.uid()` would be the first real RLS in the codebase.
4. **Actual per-property realized management-fee income does not exist anywhere** — the dashboard fee number is an explicit *estimate* (`lib/appfolio-kpi.ts`), and it's unproven any Reports-API report can supply the real figure. **Trailing fees rest on a blocking feasibility spike (Batch 6a).**

**Intended outcome:** a batched, auditable build where Batches 0–3 stand up referrer onboarding + a real lead pipeline + website attribution, and trailing-fee/QBO work (Batches 6–8) is gated behind a data-feasibility go/no-go.

> **Two decisions need your input before this is final — see "Decisions pending" at the end.** The biggest is the referrer-auth approach (the spec's Supabase-Auth assumption doesn't match the codebase).

---

## 1. Discovery report — what exists that this touches

**Reusable as-is:** Auth.js staff sessions + `staff.access_role` / `lib/roles.ts` / `lib/require-role.ts` for the **admin** side; append-only `wo_event` trigger pattern (`lib/maintenance/events.ts`, `20260702_maintenance_os.sql`) for the ledger; `audit_event` / `lib/audit.ts` for admin audit; the CRON_SECRET monthly-close cron shape (`app/api/maintenance/cron/metrics/route.ts`); the S2S intake pattern (`app/api/intake/rental-analysis-request/route.ts` + `lib/service-tokens.ts`); Resend (`lib/agents/channels/email.ts` `sendEmail()`); `lib/appfolio-reports.ts` `runReport()` + `fetchUnitIdBridge()` + `app/api/sync/af-reports` for the (to-be-proven) fee-income pull; UI kit (`components/ui/*`) + board patterns (`app/company/rocks/page.tsx`, `components/eos/RocksBoard.tsx`); Supabase Storage helpers (`lib/invoices.ts`) for W-9/agreement PDFs; Node `crypto` for field encryption.

**Does NOT exist (must build/integrate):** no owners/properties/units/tenants tables (AppFolio v0 fetched live); the only lead table `lead_events` is a read-only KPI cache, not a writable pipeline; no realized fee income; no QuickBooks integration (`refreshFromQuickBooks()` throws); no per-user RLS; no field encryption. **Also:** a designed-but-unbuilt CRM with a `referrer` role already exists in `docs/hdpm-os/07-crm-and-workflows.md` — **reconcile before batch 1** to avoid a second parallel CRM.

**Central architectural fact — two auth systems:** Staff/admin → Entra + service-role app-enforced (existing). Referrer → new login + `auth.uid()` RLS (new). RLS protects only the referrer client path; admin stays app-enforced behind `requireRole()`.

## 2. Data model

New schema **`referrals`** (or `referral_` prefix). Every table: `org_id text default 'hdpm'`, idempotent DDL, applied manually by Craig in the Supabase SQL Editor. AppFolio linkage is **TEXT keys, never FKs** (no local owner/property row exists).

**Field encryption (new — none exists today):** `lib/referrals/crypto.ts` using Node `crypto` **AES-256-GCM** + env `REFERRAL_FIELD_KEY`. TIN + payout details stored in `*_encrypted` columns; decrypt only on the admin service-role path. Cleartext limited to `*_last4`. Prefer minimization (full payout details recorded in QBO, not Supabase).

**Tables:**
- **`referral_partner`** — `id`, `auth_user_id uuid unique` (RLS key), `type` (owner|agent|builder|vendor|other), `status` (pending|active|paused|terminated), contact, `license_number`, `w9_status`, `w9_doc_path`; **structured 1099 fields** `legal_name`, `tax_id_encrypted`, `tax_id_last4`, `tax_address jsonb`; payout `payout_method`/`payout_last4`/`payout_details_encrypted`; `agreement_accepted_at`, `agreement_doc_path`, `referral_code unique`.
- **`referral_lead`** — the pipeline row and **SoR for owner-acquisition stage/attribution/dedupe/fees/doors** (referral + organic). `partner_id` (null=organic), `source` (referral|organic), `stage` (submitted…closed/lost), `trailing_status` (none|accruing|ended) — **independent of stage**, `trailing_ended_at/reason`; prospect fields, attribution (`ref_code`, `utm`, `landing_page`, `hdpm_web_lead_id`), AppFolio link on signing (`appfolio_owner_id`, `appfolio_property_ids text[]`, `doors_under_mgmt`), dedupe (`dup_of_lead_id`, `dup_status`), `first_touch_at`.
- **`referral_lead_event`** — append-only history (copy the `wo_event` UPDATE/DELETE-rejecting trigger). Actor per `lib/agents/actor.ts`.
- **`fee_policy`** — **the data-driven, admin-configurable compensation table (Oregon eligibility lives here, NOT hardcoded).** `partner_type`, `fee_kind` (one_time_bounty|trailing), **`allowed boolean`** (the OR-eligibility switch, editable without deploy, seeded `false`), `bounty_mode`/`bounty_amount`/`bounty_trigger` (agreement_signed|first_rent), `trailing_pct`, `trailing_months`, `effective_from/to`. **`first_rent` has no AppFolio detection source — only `agreement_signed` is v1-implementable.**
- **`fee_agreement`** — terms **frozen onto the lead at signing** (snapshot; later policy edits never rewrite earned amounts), incl. `trailing_window_start/end` computed at signing. Write is gated on `fee_policy.allowed=true`.
- **`referral_ledger`** — append-only money ledger (BIGINT identity; corrections are new signed rows, never edits). `entry_type` (earned|adjusted|approved|paid|voided), `period` (YYYY-MM), signed `amount`, `qbo_reference`, `batch_id`. Balances computed by summing.
- **`property_fee_income`** — **new; the missing trailing-fee input; source unproven (Batch 6a spike).** `(appfolio_property_id, period)` pk, `mgmt_fee_income`, `source_report`.
- **`referral_notification_log`**, **`referral_acquisition_cost`** (optional manual spend input for cost-per-door), audit via existing `audit_event`.

**RLS:** Referrer path uses the anon client `getSupabaseClient()` **bound to the referrer's JWT** (first real use of that dead-code client) with `auth.uid()` policies (`referral_partner`: `auth_user_id = auth.uid()`; child tables scoped by partner ownership). Admin path stays on `getSupabaseAdmin()` behind `requireRole('admin')` + new `requireReferralAdmin()`; keep `service_role FOR ALL USING(true)` on every table. **This split is by design.**

**Trailing-fee computation (GATE: Batch 6a must prove the income source or trailing is descoped):** at signing, link lead → AppFolio via `fetchAppFolioPropertyOwnerMap()`, freeze pct/months, set `trailing_status='accruing'`. Monthly: pull realized income → `property_fee_income`; accrue `Σ(income × frozen pct)` across `appfolio_property_ids` within the frozen `[window_start, window_end]`; post one append-only `earned` row per `(lead, period)`. **Early termination is income-driven, NOT the manual `property_mgmt_status` field:** income-row absence flags the lead; two consecutive periods absent from the managed set auto-ends trailing; plus an admin "End trailing" control. Close job gates on `trailing_status='accruing'`, not `stage`.

## 3. Route & page map

**Two surfaces:** referrer routes opt **out** of the staff `AppShell`/`Sidebar` (route-group layout) and must be added to `PUBLIC_PREFIXES` in `proxy.ts` (else 307 → `/login` — the documented cron-middleware gotcha), guarded by new `requireReferrer()` (no `@highdesertpm.com` check). Admin routes reuse the staff shell + `requireReferralAdmin()`.

**Isolation hardening (CI-enforced, not review-only):** a single `lib/referrals/referrer-context.ts` wrapper is the only way a referrer route gets a DB client (returns the JWT-bound anon client); an **ESLint ban on `getSupabaseAdmin` under `app/partners/**`** (excl. admin) that fails the build; a **standing CI cross-tenant read test.**

**CRM SoR — resolved:** `referral_lead` = SoR for pipeline/attribution/dedupe/fees; hdpm-web `Lead` = SoR for website contact capture/marketing; linked by `referral_lead.hdpm_web_lead_id`, not duplicated. hdpm-web → intake API creates/updates the lead; this repo → `lib/web-callback.ts` reports status back.

**Website attribution contract (companion Batch-3 task in hdpm-web):** on `?ref=CODE`, hdpm-web sets first-party `hdpm_ref` cookie (90d, first-touch-wins) + `hdpm_attr` (utm/landing); owner-inquiry form posts them to `POST /api/intake/referral-lead` (S2S, new `referrals` scope). This repo owns the receiving endpoint + partner-code resolution.

- **Referrer `/partners`:** `/login`, `/invite/[token]`, `/apply`, `/agreement`, `/w9` (upload PDF + structured legal_name/TIN/tax_address), `/` (dashboard: earned/pending/paid/**next-expected-payout** = approved-not-paid), `/leads`, `/leads/new`, `/earnings`, `/settings`.
- **Admin `/partners/admin`:** board + list (model on `RocksBoard`), `/leads/[id]` (history, dedupe override, link-AppFolio, **End trailing**), `/referrers` (invite/approve/terms/pause/verify W-9), `/fee-policy` (the eligibility switches), `/close` (monthly), `/reporting` (leads by source/referrer, conversion, doors won, cost-per-door, fee liability, 1099 readiness).
- **APIs:** `POST /api/intake/referral-lead` (S2S), `/api/partners/leads` (referrer RLS client), `/api/partners/admin/*` (service role), `/api/partners/admin/close/cron` (CRON_SECRET).

## 4. Monthly close job

Clone `app/api/maintenance/cron/metrics/route.ts`: `POST` + `Bearer CRON_SECRET`, `maxDuration=300`, `?dryRun=1`, logic in `lib/referrals/close-run.ts`, `Promise.allSettled` per lead. Cron `0 8 3 * *` (3rd, after month-end settles); **path added to `PUBLIC_PREFIXES`.**

- **Inputs:** `period` = prior YYYY-MM; leads with `trailing_status='accruing'` whose frozen window covers `period`; `property_fee_income` for `period`; the active managed-property set.
- **Prerequisite (spike-gated):** the proven Reports-API report wired into `app/api/sync/af-reports` upserting `property_fee_income`.
- **IDEMPOTENCY:** existence guard (no second `earned` row per `(lead, period)`) + a period-level `close_run` marker; corrections are new `adjusted` rows.
- **Failure:** `allSettled` isolates per-lead; missing income → flagged, **not silently zeroed**; re-runnable.
- **Admin reviews at `/partners/admin/close`:** dryRun accrual table + flagged/skipped leads → approve batch (writes `approved`, `batch_id`) → export QBO file → mark paid (`paid` + `qbo_reference`). W-9-missing referrers held.

## 5. Build sequence (earliest usable value first)

- **Batch 0 — Migrations + RLS scaffolding + isolation guardrail.** All `referrals` tables (idempotent SQL), referrer RLS + admin service-role policies, `fee_policy` seeded `allowed=false`, `lib/referrals/crypto.ts` + `REFERRAL_FIELD_KEY`, ESLint `getSupabaseAdmin` ban in CI. *Test:* seeded auth user sees only its own row (standing CI test); ledger/event triggers reject UPDATE/DELETE; TIN encrypt/decrypt round-trips.
- **Batch 1 — Admin referrer management (no referrer login yet).** `/partners/admin/referrers` create/type/code/terms (writes `fee_agreement` gated on `allowed`)/pause. *Test:* admin creates **3 real referrers**; a disallowed-type fee is blocked.
- **Batch 2 — Referrer auth + apply/accept + agreement + W-9 + tax capture.** Invite → set credential → agreement (checkbox + stored PDF) → W-9 upload + structured TIN/address. Referrer layout, `requireReferrer()`, `PUBLIC_PREFIXES`, context wrapper. *Test:* referrer accepts on a non-`@highdesertpm.com` email, signs, uploads; RLS confirmed (can't read another's row); TIN encrypted at rest.
- **Batch 3 — Lead submission + admin pipeline + dedupe + website attribution.** `/partners/leads/new` + `POST /api/intake/referral-lead`; admin board/list; every stage change writes an event; dedupe vs live AppFolio owners + open leads (borrow `lib/haven-af-match.ts`), first-touch-wins + logged override; organic leads linked via `hdpm_web_lead_id`. **Companion cross-repo task:** hdpm-web cookie + form post. *Test:* **3 real leads logged**; a `?ref` submission resolves to a partner; an organic one captures UTM; a duplicate is flagged with first-touch retained.
- ***Value checkpoint after Batch 3 — onboarding + pipeline + attribution live; everything below is money.***
- **Batch 4 — Notifications** (Resend + `referral_notification_log`; verify DKIM/SPF for external mail).
- **Batch 5 — One-time bounty ledger + admin approval** (`agreement_signed` trigger only; `first_rent` deferred). Referrer dashboard earned/pending/paid.
- **Batch 6a — Trailing-fee data feasibility spike (BLOCKING).** Prove a Reports-API report yields per-property realized fee income reconcilable to an owner statement. **No-go → trailing descoped, portal ships bounty-only.**
- **Batch 6b — Property fee-income pull** (only if 6a go).
- **Batch 7 — Trailing-fee monthly close job** (only if 6a go): idempotency, dryRun, frozen-window boundary, income-absence flagging, managed-set-dropout end-trailing, admin End-trailing.
- **Batch 8 — QBO export + mark-paid + 1099 readiness** (CSV/IIF from approved rows; 1099 totals from structured TIN/address; drop-in path to future QBO API sync).

## 6. Open questions

**(a) Blocks the build:**
1. **Fee-policy legal sign-off (Oregon)** — attorney confirms which `partner_type × fee_kind` are permitted before any `allowed=true`. Blocks batch 5+ *going live*, not the schema.
2. **Trailing-fee income data source** — the Batch 6a spike; unconfirmed any report supplies it. Blocks Batches 6–8, not 0–3.
3. ~~Where `/partners` referrer pages live~~ — **RESOLVED: public carve-out in this repo** (Decisions locked #1).
4. **Referrer auth session coexistence** — with the choice locked to Supabase Auth, the one remaining detail is cookie coexistence with `next-auth.session-token` (which client each server component uses); handled in Batch 2, not plan-blocking.
5. **hdpm-web attribution cross-repo dependency** — schedule the cookie+form change with whoever owns that repo (before Batch 3's companion task).
6. ~~Reconcile with `docs/hdpm-os/07` unified CRM~~ — **RESOLVED: this portal is canonical, 07 is reference-only** (Decisions locked #2).

**(b) Decide later:** first/last trailing period boundary policy; QBO file format (CSV vs IIF); e-sign vendor vs checkbox+PDF (recommend latter); store encrypted payout details vs last4 only (recommend minimization); manual acquisition-spend input for cost-per-door; accrual digest cadence.

## 7. Risks & designed-in mitigations

- **Attribution disputes:** `first_touch_at` + append-only events make first-touch provable; override requires a logged reason; immutable history.
- **Duplicate leads:** dedupe at submit vs live AppFolio owners + open leads; suspected dupes hold before earning; fuzzy match → admin-confirm, never auto-reject.
- **Fee-computation errors:** frozen `fee_agreement` terms + explicit window boundary; append-only ledger; **idempotent** close; dryRun review; missing income flagged not zeroed; approval gate.
- **Trailing data may not exist:** blocking Batch 6a go/no-go; inert schema until fed; clean descope to bounty-only.
- **Early-termination over-accrual:** income-feed-driven stop (absence flag + two-period managed-set dropout auto-end + admin control), **not** the manual `property_mgmt_status`.
- **Oregon compensation illegality:** `fee_policy.allowed` data switch seeded `false`; write-gated at signing; attorney sign-off gate.
- **RLS/isolation failure:** JWT-bound anon client + `auth.uid()` policies; CI-enforced (context wrapper + ESLint ban + standing cross-tenant test), not review-only.
- **Sensitive data at rest:** AES-256-GCM app-layer encryption, admin-path decrypt only, minimization preferred.
- **1099 has no structured source:** capture structured legal_name/TIN/address at W-9 step, admin-verified vs PDF.
- **Silent email failure / external deliverability:** `referral_notification_log` records skips; verify `RESEND_API_KEY` + DKIM/SPF before batch 4.
- **Pending-migration lag** (this repo has shipped features whose migrations were never run): gate each batch's done-state on migration-confirmed-applied; strictly idempotent DDL.
- **QBO expectation mismatch:** v1 = generated file + manual mark-paid; shaped for a drop-in future API sync.

## Verification (per batch)

Each batch above ships with its own runnable test (listed inline). Overall end-to-end proof of the v1 value checkpoint: after Batch 3, an admin can create 3 real referrers, each accepts an invite on a non-company email and signs, submits a lead (and a `?ref`-cookied website submission arrives via the intake endpoint resolved to a partner), a duplicate is flagged first-touch-wins, and RLS is proven by a standing CI test that a referrer cannot read another referrer's rows via the anon client. Fee/close batches are verified against AppFolio owner statements (reconcile within rounding) and QBO sandbox import.

## Decisions locked (2026-08-28)

1. **Referrer auth = Supabase Auth + real `auth.uid()` RLS, hosted in this repo** (public `/partners` carve-out). DB-enforced isolation is the boundary for external financial data; the CI-enforced app guardrails in §3 are defense-in-depth on top. This is the design as written — no plan changes needed.
2. **This portal is the canonical owner-acquisition CRM.** `referral_lead` absorbs the `referrer`-role/attribution intent from `docs/hdpm-os/07`; that doc becomes reference-only. Resolves OQ #6 — no second parallel CRM.

Remaining open questions (§6) are external dependencies or batch-time decisions, not plan-blocking: Oregon legal sign-off (before batch 5 goes live), the Batch 6a income-feasibility spike (before batches 6–8), and the hdpm-web attribution cross-repo scheduling (before Batch 3's companion task).
