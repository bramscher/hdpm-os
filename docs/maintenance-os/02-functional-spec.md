# Functional Spec — statuses, fields, SLAs, tripwire rules

This is the behavioral contract. Every rule here should end up as either a DB constraint, a server-side validation, or a unit-tested cron function.

## 1. Statuses

`NEW → TRIAGED → SCHEDULED → IN_PROGRESS → WAITING_ON → VERIFY → BILL → CLOSED`

- `WAITING_ON` requires `waiting_reason` ∈ {TENANT, VENDOR, PARTS, OWNER, WEATHER, INTERNAL} — enforce with a check constraint.
- Any status change is an append-only event (audit trail). No silent overwrites.
- AppFolio mirror: our stage tag is source of truth; map to closest native AppFolio status (New / Assigned / Scheduled / Work Done / Completed). Exact instance status list: confirm with Cheryl.

## 2. Required fields on every open WO

| Field | Rule |
|-------|------|
| `owner` | ONE named person. NOT NULL while status != CLOSED. |
| `next_action_date` | NOT NULL while status != CLOSED. Past date = exception, not error. |
| `priority` | P1–P4 (see §4). NOT NULL after TRIAGED. |
| `waiting_reason` | NOT NULL iff status = WAITING_ON. |
| `vendor_or_tech` | NOT NULL from SCHEDULED onward. |
| `appfolio_wo_id` | Link back to system of record. |
| `property_unit`, `category`, `description`, `created_at` | Standard. |

## 3. Closure gate (server-side; all six or no CLOSED)

1. Verification recorded (photo review or field re-check; `verified_by`, `verified_at`).
2. Invoice generated in hdpm-chat and uploaded to AppFolio WO (single summary line).
3. Follow-up/recommended work → new WO created, or dismissed with written reason.
4. Tenant confirmation ping sent (Haven); negative reply spawns follow-up WO.
5. Failed-access / scope-change events documented if any occurred.
6. Next preventive item scheduled where applicable.

## 4. Priorities & SLAs (configurable, seed values)

| Class | Examples | SLA |
|-------|----------|-----|
| P1 Emergency | active water, fire/smoke, gas, electrical hazard, sewage, no heat (cold), security, life-safety | ack ≤1 hr; dispatch same day |
| P2 Urgent | no water, only toilet down, fridge failure, contained major leak | triage same business day; schedule ≤48 hrs |
| P3 Routine | minor plumbing/electrical, appliance w/o loss, doors | triage ≤1 business day; schedule ≤7 days target |
| P4 Planned | preventive, turns, owner improvements | per plan/turn deadline |

## 5. Tripwire rules (cron-driven; each = query + action + owner notification)

| # | Condition (exact) | Action | Cadence |
|---|-------------------|--------|---------|
| 1 | Haven contact-log entry with no matching WO by next morning | Exception row: create WO or log why not | nightly |
| 2 | `owner IS NULL` > 1 business day | Exception row | daily |
| 3 | `next_action_date` NULL or < today on open WO | Exception row | daily |
| 4 | vendor assignment `accepted_at IS NULL` > 24 hrs | Exception + notify Cheryl (phone script) | hourly |
| 5 | failed-access event logged | auto status → SCHEDULED + require new date same day | on event |
| 6 | scope-change event without matching approval record | block BILL; notify Alberto | on event |
| 7 | status = VERIFY and (photos = 0 OR time = 0 OR materials unlogged) | block BILL | on transition |
| 8 | verified_at < now()−5d AND no invoice | weekly unbilled report → Penny | weekly |
| 9 | tenant ping negative OR silent >5d on P1/P2 | follow-up WO / call task | daily |
| 10 | tech recommendation age >3d, no WO and no dismissal | notify Alberto | daily |
| 11 | owner-approval request pending >3 business days | task to requesting PM | daily |
| 12 | vacant unit turn with `next_action_date` NULL | Monday review flag | weekly |

## 6. Dashboard — 7 views (mockup = visual spec)

Open Board (kanban by status, priority edge colors, past-due red) · Waiting-On (ONE table, 7 fixed columns, type badges `--w-*` colors, days pill green ≤2 / amber 3–5 / red >5, chip filters) · Vendor Scoreboard (profiles + performance + ranking) · Aging (0–7/8–14/15–30/30+) · Exceptions (the sweep view — tripwire output) · Turnover (days vacant, target ready, blocker, budget vs actual) · Monday Review (composite filter: 30+ OR vendor-wait >5d OR P1 last 7d OR VERIFY).

## 7. Vendor profiles & ranking

Profile: trade(s), service area, license #/expiry, insurance carrier/expiry, W-9 on file, rates, minimum charge, emergency availability, preferred status, property restrictions, notes.
Performance (rolling 90d): accept time, schedule time, completion time, callback rate, overdue count, docs compliance.
Ranking: computed score per trade; dispatch proposes highest-ranked available; licensing gate blocks assignment where license required and missing (CCB work routes under Bryce's oversight, never Alberto-as-licensee).

## 8. SLAs for the software itself

Dashboard reads near-real-time from Supabase mirror; AppFolio sync cadence ≥ every 15 min (or manual-pass mode if write/read limits demand). All money math stays in the existing invoice module. RLS: vendors see only their assignments; techs see their jobs; tenants nothing (Haven is their interface).
