---
ontology: true
type: analysis
domain: maintenance
status: active
summary: Gap analysis of Brody's Unit Turnover Tracker spec (2026-10-09) against what HDPM-OS already has
tags: [turnover, unit-turn, appfolio, reminders, gap-analysis]
related: [00-README, 10-restart-2026-08-20, HDPM_Chat_Turn_Estimator_Implementation_Plan]
discovered: 2026-10-11
---

# Unit Turnover Tracker — gap analysis

Source: `.orca/drops/Unit Turnover Tracker Product Requirements.docx` and `.orca/drops/Unit Turnover Tracker – Layout Pitch.pdf` (Brody, 2026-10-09).
Status: read-only analysis. Nothing is built. Building waits behind the Loop 1 gate (2026-10-15, `docs/agent-os/10-restart-2026-08-20.md` §8).

## Bottom line

About 40% of the spec already exists:
- Unit turns are created automatically from AppFolio and grouped with their work orders.
- AppFolio's turn-board categories are already pulled, and they are exactly the categories the spec uses.
- Move-out, move-in and target dates are already synced.
- A turnover tab, a Gantt chart and an append-only event log are already built.

What is missing falls into three groups:
1. **The checklist layer.** There is no per-turn checkbox, lockbox, deposit slip, coordinator or notes data.
2. **The tracker's own work-order status.** The 11-status model, with its own history, has to live next to our existing `stage` without fighting it.
3. **A task list.** The spec says "the website's existing task list", but **no such list exists**. This is the largest piece of new work.

Three things in the spec need resolving before anything is built:
- The work-order sync currently closes a work order as soon as AppFolio marks it complete. That collides with "Completed, awaiting invoice".
- AppFolio's v0 bills have no work-order ID, so "invoice received" can't be set automatically for outside vendors.
- Owner-approval reminders overlap with Loop 1's chase board.

## Legend

- **Have:** built and usable as-is
- **Extend:** the foundation exists and needs new columns, logic or UI
- **New:** nothing exists

## 1. Data from AppFolio (the spec's data map)

| Spec field | Status | Where / note |
|---|---|---|
| Work-order status | Have | v0 `Status` → `work_orders.appfolio_status` (`lib/appfolio.ts:671-704`); synced every 15 min, plus hourly 7-day, plus webhook (`vercel.json`) |
| Job description (title) | Have | `description`. Detect "Maintenance Follow Up" here. |
| Category (unit turn board) | **Have** (spec says verify) | `UnitTurnCategory` → `work_orders.unit_turn_category`. Values match the spec: `Keys / Locks`, `Housekeeping`, `Other`, plus Remotes, Maintenance / Repair, Floors / Carpets, Paint, Appliances, Landscape Maintenance (`lib/maintenance/turn-schedule.ts:12-21`). The plain `category` column is never written. |
| Assigned employee | Extend | `assigned_to` is a comma-joined **name string** (`lib/appfolio.ts:839-843`), not mapped to `staff`. Name-matching already exists for activities (`lib/activities.ts:141-144`). |
| Vendor | Have | `vendor_id`, `vendor_name` |
| Scheduled / done / cancelled dates | Have | `scheduled_start`, `completed_date`, `canceled_date`. There is no separate "work done on" field. |
| Estimate and approved amount | Extend | **Not in AppFolio v0.** Tool-side data exists: the `approval` table (estimate, approved_amount) and `estimate.work_order_id`. Show those, and leave blank when there are none. |
| Bills linked to work order | **Gap** | `lib/af-bills.ts:6`: v0 bills carry no WorkOrderId. In-house (HDMS) invoices do link (`hdms_invoices.work_order_id`). See §5. |
| Target turnaround date | Have | Reports API `unit_turn_detail.target_days_to_complete` → `unit_turn.target_ready`, via the daily true-up (`lib/maintenance/unit-turns.ts:378`) |
| Move-out / move-in | Have | `unit_turn.vacated_at` and `movein_date`, from the same report and from tenant `MoveOutOn` |
| Tenant names | Extend | Pulled from `/tenants` (`lib/appfolio.ts:1107`) but not stored on the turn |
| Security deposit | New | Not pulled anywhere. It's display-only; the slip due date needs only the move-out date. |
| Last updated | Have | `appfolio_last_updated_at`; sync is incremental by a days window |

**Dev-team checks answered:**
- **Category exposed?** Yes, as UnitTurnCategory.
- **Target turnaround exposed?** Yes, via the Reports API.
- **Estimate and approved amounts?** No, not from AppFolio. Use tool-side data.
- **Do bills link to work orders?** No, not in v0.
- **Does "Complete" mean paid?** Still open. We map Completed, Closed and Canceled to `CLOSED` without checking bills.

## 2. Turns and dashboard

| Spec | Status | Note |
|---|---|---|
| A turn exists per unit turnover | Have | `unit_turn` is auto-created from AppFolio ServiceRequestId groups (`syncUnitTurnsFromMirror`, `unit-turns.ts:207`) and from the daily `unit_turn_detail` true-up (180 days back). Manual create also exists. |
| "How is a turn created?" (open item) | Answer | **Automatically, already.** Manual create stays available as a fallback. |
| Visible from move-out until complete | Extend | Filter on `vacated_at <= today`. The board currently loads every non-closed turn regardless of date. |
| Not yet ready view (future move-out) | Extend, risk | Turns usually get created after WOs or after the report shows them. It's unconfirmed whether on-notice units appear before move-out, so this view may be thin. A fix would be seeding turns from on-notice tenants (`cached_vacancies` / tenants `MoveOutOn`). |
| Completed / All views | Extend | The API supports `?status=closed\|all` (`app/api/maintenance/unit-turns/route.ts`). The board never loads closed turns. |
| "Marked complete" | Extend, risk | There are two status fields that drift apart. Legacy `status` (active/ready/closed) is written by the board and sync. `lifecycle_status` (21 states) is written only by the turn estimator. The tracker should define "complete" once, and both fields need to agree. |
| Row with 7 category statuses | New | The board's turnover tab has phase columns (`app/maintenance/board/views/turnover.tsx:287-298`), but per AppFolio category, not the spec's 7 sections, and with no rollup or checkboxes. |
| Summary tiles | Extend | Current tiles are units, behind schedule, move-ins in 7 days, average days vacant. The spec's waiting on approval / waiting on funds / needs action tiles are new. |
| Filters: property, coordinator, status, search | New | The turnover tab has sorting only. There is no coordinator concept at all (§4). |
| Overdue items in red | New | Deposit slip due date, plus overdue reminders |
| Unit detail screen | Extend | There are two partial ones: `app/maintenance/board/turn/[id]` (a read-only Gantt) and `app/turn-estimator/turns/[id]` (lifecycle plus a work-order table). Neither has checkboxes, an AppFolio sidebar or notes. |

**Recommendation:** make the tracker *the* turnover view. Rebuild the board's turnover tab and the turn detail page to Brody's layout, keep the Gantt as a link from the detail page, and leave `/turn-estimator/turns` for the estimate and lifecycle work. Three separate turn screens is already one too many. Access: anything under `/maintenance/...` is already covered by the `maintos` section (`lib/access/sections.ts:100-107`), so no new section is needed unless Brody wants a separate menu item.

## 3. The 7-category checklist

**Mapping work orders to sections** (from `unit_turn_category`):

| Section | AppFolio categories | Note |
|---|---|---|
| 1 | Keys / Locks | |
| 2 | Housekeeping | |
| 4 | Other + description contains "Maintenance Follow Up" | |
| 3 | Everything else | Remotes, Maintenance / Repair, Floors / Carpets, Paint, Appliances, Landscape Maintenance, Other without that title, and manually linked WOs with no category. **Confirm that Remotes belongs in 3.** |

| Checklist item | Status | Note |
|---|---|---|
| Checkbox storage (cats 1, 4, 5, 6, 7) | New | No per-turn checklist exists; the only versions are demos (`app/admin/habu-demo`). Needs a `unit_turn_check` table: turn, item key, checked_at/by, optional value (lockbox number, showing date, video link). |
| Keys received | New (can be prefilled) | `key_copy.returned_at` / `markKeyVacant` (`lib/keys.ts:451`) could tick it automatically |
| Move-out inspection done | New | Inspections only cover routine and move-in-anchored types; there is no move-out type |
| Lockbox assigned / pulled | New | Lockboxes aren't modelled anywhere |
| Showing status and date | New | Haven exposes tours but not listing or showing status |
| Listing photos / details / video | New (manual) | `cached_vacancies.ready_for_posting` (AppFolio `PostedToWebsite`) could hint at this |
| Ready for showing / updated on Haven | New (manual) | No Haven listing API (`lib/haven.ts`) |
| Invoices received for all WOs | New (calculated) | Depends on §5 |
| Closed out in AppFolio | New (manual) | Could be read from `unit_turn_detail.turn_end_date` later |
| Deposit return slip, due move-out + 30 | New | Nothing exists for deposit disposition |
| Move-in date entered | Have (calculated) | `unit_turn.movein_date` is set, so it can be computed instead of a checkbox |
| Notes and activity | New | The `unit_turn.notes` column exists but nothing renders it. `turn_status_event` only logs lifecycle changes. Needs a turn activity log (checks, status changes, notes). |

## 4. Work-order status model (11 statuses)

This is the riskiest part, because it overlaps the existing `stage` machine that the board, chase board and route builder all rely on.

**What exists:**
- `stage`: NEW / TRIAGED / SCHEDULED / IN_PROGRESS / WAITING_ON / VERIFY / BILL / CLOSED.
- `waiting_reason`: TENANT / VENDOR / PARTS / OWNER / WEATHER / INTERNAL.
- AppFolio status → stage mapping: `lib/maintenance/sync-rules.ts:116-137`.
- History: append-only `wo_event`, with `stage_change` and `sync_update` events.

**Conflicts with the spec:**
1. **The sync closes on complete.** Completed, Closed or Canceled in AppFolio force `CLOSED` from any stage (`sync-rules.ts:239-245`). The spec wants Completed → "Completed, awaiting invoice". The docstrings say "→ VERIFY" but the code goes to CLOSED, which is a separate bug worth noting.
2. **"Awaiting owner funds" doesn't exist** as a stage or waiting reason.
3. **"Last update wins" differs.** Today, an AppFolio status *change* overrides a manual stage, which matches the spec. But IN_PROGRESS, VERIFY and BILL are protected from sync, which doesn't exist in the spec.

**Recommendation:** don't reuse `stage`. Add a separate tracker status on work orders (`turn_status` plus `turn_status_source`, `turn_status_by` and `turn_status_at`), set by a pure mapper from `appfolio_status`, with manual overrides kept until the next AppFolio *change*. Log every change to `wo_event` (new kind `turn_status_change`) so "days in current status" and the reporting both come from one place. `stage` stays as it is for the board and the chase board.

**Status-model mapping notes:**
- **Assigned:** we already detect status *changes*, so "if AppFolio later shows Assigned or Scheduled, update" is cheap.
- **Complete, no bill needed:** the follow-up inspection defaults to it, keyed on the title match.
- **Status history:** have the mechanism (`wo_event`); the new event kind is new.

## 5. Invoices

- **Outside-vendor bills can't be linked automatically** (v0 bills have no WorkOrderId). Options:
  - (a) An "Invoice received" toggle per work order, the simplest option. The spec already allows setting it by hand.
  - (b) Heuristic matching on vendor, property, amount and date, with manual confirmation.
  - (c) Check whether the Reports API exposes a bill↔WO link.
  - **Recommend (a) now and (c) as a dev check.**
- **In-house (HDMS) invoices do link** through `hdms_invoices.work_order_id` and the daily-billing `work_order_id`, so those can set "invoice received" automatically.
- "Category 6 = invoices received when every WO is terminal" is a simple calculation once the statuses exist.

## 6. Reminders and tasks

| Spec | Status | Note |
|---|---|---|
| "Existing task list" | **New** | There is no employee task list. The closest options are:<br>• `todo` (`20260804_eos_core.sql:74`): per person (`owner_person` → `staff.person`), but its UI is meetings only, with no WO link and no snooze.<br>• `estimate_followup_review`: one row per WO with snooze (`next_review_at`), but it's chase-board specific. |
| A task per WO per recipient, auto-closed | New | Recommend extending `todo` with source `turn`, plus `work_order_id`, `snoozed_until` and a unique open-task key (wo, person, reason). A daily job opens and closes tasks to match status. Add a **My tasks** page, which other features will want too. |
| Weekdays 7am Pacific | Extend | Use the DST-correct pattern from the followups cron: two UTC slots plus a Pacific-hour gate (`app/api/maintenance/cron/followups/route.ts:11-12`). This answers the open item: **follow DST**, so 7am is local wall-clock time. |
| Recipients: coordinator + assigned employee | New | There is no coordinator field, and the assigned employee is a name string that needs mapping to `staff`. Unmatched names fall back to the coordinator. |
| Task on the scheduled date | New | Same job, with `scheduled_start = today` |
| "Assigned" grace, "awaiting invoice" grace (3 days) | New | Config values |
| Snooze until a date | New | Per WO, so it doesn't reset per recipient |
| Add a task to the route builder | Extend | The route builder (`app/maintenance/board/views/open-board-route.tsx`) only lets you pick WOs from open-board checkboxes. "Add to route" from a task means preselecting that task's WO. Inspections have their own route builder. |
| Vendors never reminded | Have, implicitly | Nothing in this build messages vendors |

**Overlap with Loop 1:** Estimate requested, Estimated and awaiting owner approval are exactly the pool the chase board and Morning 7 already work for Cheryl (`lib/agents/chase-board.ts`, owner lane). If the tracker also sends Cheryl a daily task for the same work orders, she gets two reminders for one job. **Recommend:** for those statuses, the tracker's task links to the chase-board card instead of duplicating it, or the tracker leaves them to the chase board altogether. This needs settling with you before the build, since the chase board is the gated experiment.

## 7. Suggested answers to Brody's open items

| Open item | Suggested answer |
|---|---|
| Reminders start on move-out date | Yes. The turn appears at the same moment. |
| Grace before "awaiting invoice" reminders | 3 business days, stored as config |
| What marks a turn complete | All 7 sections complete. Explicit "Mark complete" stays as an override, which sets legacy `status=closed` and `lifecycle_status=CLOSED` together. |
| How a turn is created | Automatically from AppFolio (already the case), with manual create as a fallback |
| Deposit slip due = move-out + 30 | Yes. Oregon's deadline is 31 days (ORS 90.300). Confirm with Brody that 30 is a deliberate buffer. |
| Lockbox pulled only after the move-in date has passed | Yes. Unlock the checkbox on the move-in date. |
| Category status rollup | Worst status wins, in this order: waiting funding > waiting approval > estimated > in progress > not started. Complete when every checkbox (except optional ones) is ticked and every WO is in a final status. A section with no WOs and no checkboxes counts as complete. |
| Who the coordinator is | A new `unit_turn.coordinator` (staff.person), defaulting to a configured person (Cheryl?), editable per turn |
| 7am DST | Follows DST |
| Walkthrough video link | Optional URL stored on the checkbox |
| Target turnaround beyond display | Show only for v1. Later, sort tasks by days to target. |
| Other categories → section 3 | Yes, except confirm Remotes |

## 8. Rough size

| Wave | Contents | Size |
|---|---|---|
| A | Data: `unit_turn_check`, coordinator, turn activity, WO `turn_status` + mapper + events, section mapper and rollup (pure, unit-tested) | M |
| B | Dashboard + unit detail UI, replacing the turnover tab and turn detail | M–L |
| C | Task list: extend `todo`, My tasks page, 7am job, snooze, auto-close, recipient mapping | L |
| D | Route-builder hook, HDMS invoice auto-link, keys-received prefill | S–M |

A and B on their own give Brody a usable tracker without reminders. C is the expensive part, and it's where the Loop 1 overlap has to be settled first.
