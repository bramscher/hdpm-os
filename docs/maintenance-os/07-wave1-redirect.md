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

## Session B — Batch AI triage *(SHIPPED 2026-07-05, commit `a558894`)*

**Shipped:** "✦ Triage Review" board tab. Proposals stored in
`ai_triage_proposal` (migration `20260705_ai_triage_proposal.sql`); AI
classifies, code derives the numbers (SLA-runway dates, owner rules);
applies/skips are Cheryl's, audited as normal wo_events. Batch is resumable
(chunks of 8, ~24s/WO measured, ≈4¢/WO). Live-verified: 10/10 NEW-pool
proposals, one applied end-to-end. Pool note: the status remap (7/3) shrank
NEW to ~11 — the UI's default pool is NEW+TRIAGED (~165), with a toggle for
the full re-date sweep (SCHEDULED+WAITING_ON, ~426, ≈$17).

### Original brief (for reference)

**Why:** Adoption step 5 (`06` §5) asks Cheryl to hand-triage ~280 NEW WOs. The per-WO "AI Next Action" panel already exists (`app/api/maintenance/work-orders/[id]/ai-triage/route.ts`, commit `79b0507`) — batch it so Cheryl reviews instead of enters.

**Scope:**
1. Batch endpoint: run the existing ai-triage logic across all WOs in NEW (rate-limited, resumable; store results as *proposals*, not applied values).
2. Review UI on the board: ranked list (P1 first, then age), each row shows proposed priority/stage/next-action/owner with one-tap **Apply** / inline-edit / skip. Bulk-apply for unedited rows.
3. Every apply is a normal `wo_event` (audit trail preserved, attributed to Cheryl).

**Acceptance:** Cheryl can clear the NEW backlog in one sitting; nothing auto-applies without her action; proposals survive page reloads.

## Session C — Vendor Scoreboard backfill *(SHIPPED 2026-07-05, commit `a54da42`)*

**Shipped:** "History (all-time)" column (n · median → p90 cycle · %>30d) from
8,362 closed vendor WOs; "Days open" now uses AppFolio's real created date and
shows the median (fixing a row-insert-time bug). Deviation: "overdue-at-close
rate" isn't derivable (no promised dates in history) → %>30d substitutes.
**Acceptance:** Firkus = 57 open @ 90d median vs peers 11–14d (reconciles with
the analysis). Key insight the history adds: Firkus *closes* work at a normal
16d median — the problem is accepted-but-unworked backlog, not slow execution.
Also surfaced: Blue Stone Gardens (33d med, 52% >30d), Chet's Electric (51d
open median).

### Original brief (for reference)

**Why:** Scoreboard performance metrics start empty (rolling 90d on new assignments), but the 2,326 grandfathered WOs carry vendor + created/completed dates — enough to surface the Firkus problem (95d median) in week one instead of month three.

**Scope:**
1. Compute per-vendor cycle-time metrics (median/p90 created→completed, WO count, overdue-at-close rate) from the full mirror including `system:backfill`-closed WOs.
2. Scoreboard shows two windows: rolling 90d (existing) and all-time-backfilled, clearly labeled.
3. Exclude WOs with no completion date from cycle-time math.

**Acceptance:** Scoreboard ranks all active vendors on day one; Firkus's median visibly ≫ peers; numbers reconcile with the 2026-07-05 analysis (±normal data drift).

## Session D — Ops close-out + end-of-day AppFolio write-back digest + reporting prune  *(IN PROGRESS, branch `feature/maint-os`, started 2026-08-17)*

**Source:** strategy session 2026-08-17 (Craig). Concern: the system is reporting-heavy but weak on *direct* day-to-day management, and edits made in HDPM-OS that also belong in AppFolio silently don't propagate — things slip. Four codebase surveys (reporting inventory, write-back capture points, email/cron infra, doc alignment) ground this brief.

**Framing correction from the surveys:** the "operations spine" is *already largely built* — the MaintOS Board already does assign/schedule/status/notes/close across 14 edit points, and the daily rhythm exists (Morning Card, Ops Brief, tripwires, `next_action_date` invariant). So this is **not** a new-spine build. The real gap is narrower: **every one of those 14 edits is Supabase-only and reaches AppFolio via nobody** (`lib/appfolio.ts` is GET-only; the mirror is AppFolio→Supabase only). That double-entry seam is where work slips.

**Decisions (Craig, 2026-08-17):** write-back = **end-of-day per-person email digest** (not realtime, not the $850/mo Write API, not read-only-only); cover **all four action classes** (assign / schedule / status / notes+completion); recipient = **whoever made the change**; reporting = **audit & prune**. Start order = **prune first**.

**Guardrail:** the digest is a *human-in-the-loop report*, NOT an AppFolio write — it respects "AppFolio is the system of record, no ledger writes ever." True auto-write stays behind the Sep 4 gate; the digest's own `wo_event` trail is the touch-count data that decides it. Dedup against the existing 6 AM tripwire digest + Ops Brief so nobody is double-pinged (per the `agent-os/00` Phase 0 carve-out rule).

### D1 — Reporting prune  *(first; reversible — code stays in git)*
Cut the passive layer; keep the action path (Cracks Radar + Board Exceptions/Monday + Ops Brief/tripwires already cover "untouched work"). Candidates from the inventory:
- **Delete:** `app/maintenance/work-orders/page.tsx` — dead redirect stub (only stale ref is `help-sops.ts`).
- **Remove from surface (home tiles / internal links; keep code):** KPI Trends (`/dashboard/trends`), Property Map (`/properties/map`), Org chart (`/company/org`).
- **Trim/demote:** Company KPIs (`/dashboard`) — 16 cards, admin-only, low action density.
- **Leave for now (review-in-meeting call):** Vendor Scoreboard, Rocks board.
- Prune the feeding crons only where the surface goes (KPI/metrics snapshots feed `/dashboard` + `/agents`).

### D2 — End-of-day write-back digest  *(the crack-closer)*
- **Source:** append-only `wo_event` (already records `actor`, `event_type`, `payload.from/to/field`; machine edits tagged `payload.system_override:true` → excluded). Cron: new route under **`/api/agents/cron/eod-digest`** (nested under already-allowlisted `/api/agents` — no `proxy.ts` edit) guarded by `Bearer CRON_SECRET`, GET→POST, `?dry_run=1`. Schedule ~`0 1 * * 1-6` (≈5 PM PT, Mon–Sat to catch Fri).
- **Send:** reuse Resend + `agent_outbox` (`enqueueOutbox` → `dispatchOutbox`, retry + kill-switch + audit for free); model on `morning-card-run.ts` email block + `haven/cron/digest` route shape. Map `actor` → `staff.email` (backfilled, `firstname@highdesertpm.com`).
- **Per person:** group the day's human edits, render one checklist line each via the event→AppFolio-action mapping (stage_change→set WO status; assign(assigned_tech)→set assignee; schedule→set scheduled date; note/photo→add WO comment/attachment; close→mark Completed). Quiet if a person made no edits.
- **`wo_event` coverage gaps to close first** (these mutate state but emit NO event, so a pure `wo_event` digest misses them): `priority_class` (#7), `aging_reason` (#14), `unit_turn` status/blocker (#13), `turn`/`is_turn` (#12). Fix = emit `wo_event` rows for them, or union with `updated_at` scans. Decide per-field whether it even needs an AppFolio edit (several are HDPM-internal with no AF equivalent — owner_name, aging_reason, tenant_ping).

### D3 — Ops close-out ritual  *(make the board the day's end)*
- A per-person end-of-day close-out surface/section: "your open items still needing a next-action date + what you changed today that needs an AppFolio update," so the board is where the day ends. Rides on D2's data; deduped against the 6 AM digest.

**Acceptance:** (D1) the passive reporting surfaces are gone from the home/tiles, action path intact, `tsc`+suite green. (D2) dry-run produces a correct per-person "update in AppFolio" checklist from a day of real `wo_event`s, excluding machine edits, with the four coverage gaps handled. (D3) a person can end the day from one place knowing nothing they touched is stranded.

## Session E — Maintenance Dashboard → simplify → reminders → Dez WO writes  *(Phase 1 SHIPPED 2026-09-04, branch `feature/maintenance-dashboard`)*

**Source:** Craig, 2026-09-04. Nobody could answer "where are we on maintenance?" from one screen: 8 board tabs (+4 Open Board sub-modes) and 8 home tiles, every number recomputed client-side, `metrics_snapshot` read by no maintenance view. Direction, in order: (1) one dashboard — open counts by step, time-in-step vs. typical, for WOs, vendor estimates, owner approvals, unit turns, drill-down; (2) *then* retire the tabs it makes redundant; (3) *then* derive Slack reminders from the same thresholds; (4) confirm whether Dez operating AppFolio removes the need for the Write API. Plan mode first; full plan in the session's plan file.

**Decisions (Craig):** pipeline axis = **AppFolio status** (HDPM `IN_PROGRESS/VERIFY/BILL` are dead for AppFolio-origin work); Dez's first WO write = **add internal note**; scope = dashboard now, phases sketched. Restart-plan §9 "no new dashboard views" acknowledged — this is a consolidation that removes views in Phase 2.

### E1 — Dashboard  *(shipped)*
- `lib/maintenance/dashboard-thresholds.ts` — the ONE threshold table (`DASHBOARD_THRESHOLDS`) + `isOverThreshold`. Phase 3 reminders read the same object.
- `lib/maintenance/dashboard.ts` — `loadDashboardInputs()` (tripwire snapshot, 90d `sync_update` events, 90d closed WOs, decided approvals, `agent_proposal` chase rows, `unit_turn` + `turn_status_event`) and pure `computeDashboard()`: pipeline `New → Assigned → Scheduled → Work completed` (+ `other`), `Closed (7d)` with created→completed cycle time, estimate lane (`Estimate requested`, `Estimated`, **owner-gated = undecided `approval.kind='OWNER'` only**, chase stats), waiting pocket (AppFolio Waiting ∪ stage WAITING_ON, by reason), turns by `lifecycle_status` (legacy fallback if 20260905 unapplied), attention (tripwires + needs-a-date). Every WO in exactly one bucket. Reuses `statusSinceFor`, `statusSpells`, `transitionsFrom`, `medianOf/p90Of`, `businessDaysBetween`.
- `GET /api/maintenance/dashboard`; new default `Dashboard` view in `board-client.tsx` with in-memory drill (`lib/maintenance/dashboard-drill.ts`) → existing list views → detail pages; `/maintenance` redirect; home tiles collapsed to Maintenance (badge = attention) + Turnovers + Vendors; canvas embed lands on the dashboard; daily `dashboard_pipeline` row in `metrics_snapshot`.
- 29 new unit tests (`lib/maintenance/__tests__/dashboard.test.ts`); suite 691 green; `tsc` clean.

### E2 — Simplify  *(next, after ~1 week on the dashboard)*
Retire from nav (code stays in git, then delete): Aging, Waiting-On, Monday Review, Kanban sub-mode; fold Exceptions into the dashboard's attention section (move the digest-recipients panel to `/agents`). Keep: Open Board By Property / By Vendor, Turnover + Gantt, Vendor Scoreboard; Triage Review off primary nav. Delete dead API routes `turns/[woId]`, `vendors` GET/POST, `unit-turns` GET; drop the legacy `turn` table with Monday Review. Decide build-UI-vs-drop for tripwires #4/#6/#10/#11's `assignments`/`approvals`/`recommendations` records (no UI creates them today). Target: ≤4 tabs.

### E3 — Slack reminders  *(after E2)*
One rule per `DASHBOARD_THRESHOLDS` entry; recipients via `getNotifyRecipients` (`/agents` editor); send via `agent_outbox`; dedupe via `agent_proposal`; one persona (Dez), a "why" line, one nudge max, ≤7 items. The 6 AM tripwire **email** digest becomes the Slack card — enable the already-built Morning Action Card capped at 7 rather than a new sender.

### E4 — Dez adds a WO internal note  *(supervised spike, Craig present)*
Map the AppFolio WO note flow once with Claude-in-Chrome; add `flows/wo-add-note.ts` + `POST /operator/wo/note` to `services/dez-operator` (prepare/commit + read-back verify); Dez intent + `agent_config('dez_operator','wo_note')` at L2; `wo_event('note', {source:'dez_operator', transport:'rpa', verified})` actor `agent:dez`; extend the weekly canary. **Write-API verdict:** not confirmable until (a) the AppFolio ToS/automated-seat answer and (b) one verified WO write land. Today Dez writes nothing to AppFolio (operator = deposit-to-hold preview only).

## Explicitly NOT in scope (Wave 2 gate, Sep 4)

Dispatch queue, magic links (vendor accept / owner approval pages), scope-change flow, tenant notifications. TW11's *nag* here is an exception row + digest, not an owner-facing page.

## Standing bridge

Strategy/analysis sessions (Cowork) write direction into this folder; implementation sessions (Claude Code in VS Code) read it. When priorities change, this file gets updated — check its git log for what changed.
