# Build Waves & Feasibility

37 capabilities assessed against the stack (Claude + Supabase + Next.js + AppFolio API): 5 HAVE (incl. route optimization, already live for inspections), 19 EASY, 8 MODERATE, 2 HARD (offline mobile, two-way SMS threading), 3 DON'T BUILD (resident portal, accounting/ledgers, inspection app — AppFolio/QBO own those).

## Blocking unknown — RESOLVED 2026-07-03

**AppFolio API write scope: Tier 1 exists, priced at $1.00/unit/month (~$850/mo
at 850 doors, ~$18K/yr at the 1,500-door goal).** Confirmed from the Database
API docs (v14): Create/Update Work Order, Create Work Order Attachment,
Create/Update Work Order Note, Create/Update Bill + attachments, Create/Update
Vendor, and more (POST/PATCH on most entities).

**Decision (Craig, 2026-07-03): defer purchase — run Wave 1 as Tier 2.**
Manual labor displaced by writes today is ~8–13 hrs/mo (~$300–500), well under
the fee. Cheryl's daily pass carries changes into AppFolio; `wo_event` logs
every stage change + invoice, so the Sep 4 decision can use the measured
monthly touch count instead of a guess. Revisit when: Wave 2 automation ships
(magic links / Haven auto-intake), invoice volume >~150/mo, or AppFolio
discounts/bundles it (negotiating lever: the Jobber alternative).

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
