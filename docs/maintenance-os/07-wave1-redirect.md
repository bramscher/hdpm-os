# Wave 1 Redirect — Backlog-Data-Driven Priorities

**Source:** live AppFolio WO export analyzed 2026-07-05 (360 open WOs; full analysis in the Cowork project folder, `Work-Order-Backlog-Analysis.md`). This doc converts those findings into Claude Code session briefs. **One brief per session, plan mode first**, per `00-README.md`.

Findings driving this: 265/360 open WOs are coordination-stuck — 144 assigned-but-unscheduled, 81 estimate-approval pending (median 35 days), 40 scheduled-date passed. Firkus Plumbing: 46 WOs, median age 95d (every other major vendor ~10–13d). Internal WOs median 67d. AppFolio priority field unused (356/360 "Normal").

## Prerequisite (Craig, not Claude Code) — ship what's built

Launch checklist `06` items 2–4: Resend domain DNS verification, `RESEND_API_KEY` in Vercel, digest opt-ins, merge the PR. Nothing below matters until Wave 1 is deployed and crons run.

---

## Session A — Estimate-field sync + tripwire #11 extension  *(SHIPPED 2026-07-05, with a pivot)*

**Why:** The sync ingests no estimate fields (verified: zero matches for `estimate` in `lib/appfolio.ts` and `app/api/sync/work-orders/route.ts`), so TW11 is blind to the 81 WOs stuck in AppFolio-side estimate approval — the single largest pool of stuck money.

**API-limitation finding (verified live 2026-07-05):** the six report columns
(`Estimate Req On`, `Estimate Amount`, `Estimate Approval Status`, …) do **not
exist in any reachable API**. The v0 Database API's work-order response has no
estimate fields (docs mention "Estimate" only as `Status` enum values); the
Reports API 404s on `api.appfolio.com/api/v1|v2/reports/work_order.json` and on
the instance domain with our credentials. They are web-app report-export
columns — the same API-vs-web-app split as inspections' "Use Custom Inspection
Date". **Estimate dollar amounts therefore require the manual web report** (or
a future AppFolio contract change); flag for the Cowork analysis loop.

**What shipped instead (same detection goal, status-age proxy — commit `5b22cab`):**
1. TW11 source b: WOs sitting in `Estimate Requested` (chasing a vendor bid) or
   `Estimated` (bid in hand, decision pending) **> 3 business days** → exception
   owned by Jen; row shows status + days-pending (no amount — see above).
   De-duped against the existing in-app approval-record trigger.
2. Time-in-status clock: the sync now records a `sync_update` wo_event on every
   `appfolio_status` transition (exact clocks going forward) → fallback to the
   new `appfolio_last_updated_at` mirror column (migration
   `20260705_appfolio_last_updated.sql`, backfilled 484/493 open WOs) →
   `appfolio_created_at`.

**Acceptance (met):** dry-run flags **100** estimate-stuck WOs, median **24
business days** pending (≈34 calendar days — reconciles with the analysis's
35-day median), max 144d; 5 new unit tests for the business-day logic,
fallback ordering, and dedup; mirror-only upserts unchanged (no clobber).

## Session B — Batch AI triage (kill the 280-WO manual pass)

**Why:** Adoption step 5 (`06` §5) asks Cheryl to hand-triage ~280 NEW WOs. The per-WO "AI Next Action" panel already exists (`app/api/maintenance/work-orders/[id]/ai-triage/route.ts`, commit `79b0507`) — batch it so Cheryl reviews instead of enters.

**Scope:**
1. Batch endpoint: run the existing ai-triage logic across all WOs in NEW (rate-limited, resumable; store results as *proposals*, not applied values).
2. Review UI on the board: ranked list (P1 first, then age), each row shows proposed priority/stage/next-action/owner with one-tap **Apply** / inline-edit / skip. Bulk-apply for unedited rows.
3. Every apply is a normal `wo_event` (audit trail preserved, attributed to Cheryl).

**Acceptance:** Cheryl can clear the NEW backlog in one sitting; nothing auto-applies without her action; proposals survive page reloads.

## Session C — Vendor Scoreboard backfill from grandfathered WOs

**Why:** Scoreboard performance metrics start empty (rolling 90d on new assignments), but the 2,326 grandfathered WOs carry vendor + created/completed dates — enough to surface the Firkus problem (95d median) in week one instead of month three.

**Scope:**
1. Compute per-vendor cycle-time metrics (median/p90 created→completed, WO count, overdue-at-close rate) from the full mirror including `system:backfill`-closed WOs.
2. Scoreboard shows two windows: rolling 90d (existing) and all-time-backfilled, clearly labeled.
3. Exclude WOs with no completion date from cycle-time math.

**Acceptance:** Scoreboard ranks all active vendors on day one; Firkus's median visibly ≫ peers; numbers reconcile with the 2026-07-05 analysis (±normal data drift).

## Explicitly NOT in scope (Wave 2 gate, Sep 4)

Dispatch queue, magic links (vendor accept / owner approval pages), scope-change flow, tenant notifications. TW11's *nag* here is an exception row + digest, not an owner-facing page.

## Standing bridge

Strategy/analysis sessions (Cowork) write direction into this folder; implementation sessions (Claude Code in VS Code) read it. When priorities change, this file gets updated — check its git log for what changed.
