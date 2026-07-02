# Build Waves & Feasibility

37 capabilities assessed against the stack (Claude + Supabase + Next.js + AppFolio API): 5 HAVE (incl. route optimization, already live for inspections), 19 EASY, 8 MODERATE, 2 HARD (offline mobile, two-way SMS threading), 3 DON'T BUILD (resident portal, accounting/ledgers, inspection app — AppFolio/QBO own those).

## Blocking unknown — resolve FIRST

**AppFolio API write scope.** Reads proven in this codebase. Verify against our instance: WO create? status update? file attach? Outcomes:
- Tier 1 (writes work): hdpm-chat is a true front-end; AppFolio auto-current.
- Tier 2 (read-only): hdpm-chat drives workflow; Cheryl's 15-min daily pass carries changes into AppFolio (proven tolerable).
- Tier 3 (read-only + volume): browser-automation writeback or AppFolio Stack partnership.
Even Tier 2 does not kill the build. But architecture (sync design, event sourcing) depends on the tier — do not commit before verifying.

## Wave 1 — safe to build regardless of the Sep 4 decision

All EASY, all compounding, needed in every scenario:
1. Supabase schema + append-only events table (audit trail) — see `05-data-model.md`
2. AppFolio WO mirror (read sync, 15-min cadence)
3. Dashboard v2: the 7 views from the mockup
4. Tripwire engine: 12 cron rules → Exceptions view (+ Slack/email webhooks)
5. Vendor profiles + ranking (seed: Cheryl's roster cleanup)
6. Verified-but-unbilled weekly report (tripwire #8)
7. Closure-gate validation

Acceptance for Wave 1: Cheryl's daily sweep runs entirely on the Exceptions view; Monday review runs entirely on the Monday Review view; zero spreadsheet side-cars.

## Wave 2 — the moat (after Sep 4 decision confirms build path)

1. Dispatch queue: HDMS-first rules, skills/licensing gate (CCB → Bryce oversight), availability, ranking-driven vendor proposal; Claude proposes, human confirms
2. Vendor accept/decline magic-link page + acceptance tracking (tripwire #4)
3. Owner-approval magic-link page (photos, estimate, decision) + 3-day nag (tripwire #11)
4. Scope-change flow: field request → pause → approval match → bill unlock (tripwire #6)
5. Extend existing route optimization from inspections to maintenance dispatch (reuse)

## Wave 3 — field & polish

1. Tech mobile PWA (one-thumb usable; retry-queue uploads for weak signal — NOT full offline)
2. Scheduling UI (tenant/tech/vendor availability, failed-access re-queue)
3. Tenant notifications via stage transitions — AFTER deciding Haven overlap (one voice, not two bots)
4. QBO cost-layer sync; preventive-maintenance scheduler; turnover board data joins
5. Duplicate/repeat-issue detection (Claude-assisted matching on unit + category + history)

## Explicitly deferred / rent-vs-build later

Offline-first mobile, two-way SMS threading. Revisit only if the pain shows up in Cheryl's worksheet or Monday reviews. These are Jobber's strongest cards; everything else in this doc we build better ourselves because the dispatch logic is the moat.
