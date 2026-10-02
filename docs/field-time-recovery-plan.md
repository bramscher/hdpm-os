---
ontology: true
type: plan
domain: maintenance
status: draft
summary: Re-plan of the field technician feature around two outcomes — more billable technician time and same-day recovery of every billable minute and material — with GPS moved to phase 2
tags: [field-app, technician-utilisation, billing-recovery, revenue-leakage, parts-runs, receipts, timekeeping, gps-phase-2]
related: [gps-timekeeping-plan, field-invoice-drafts, maintenance-pilot-2026-09-20, invoice-manager-plan]
supersedes: gps-timekeeping-plan
discovered: 2026-10-02
---

# Field time and recovery plan

Date: October 2, 2026. Status: draft for Craig's review. Branch: `feature/gps-timekeeping`.
Demo (sample data): [Field Day Recovery](https://claude.ai/artifact/1Una2CU1q7S8n8rmn5ktSv), a private claude.ai artifact.

This replaces the framing of `docs/gps-timekeeping-plan.md`. That document stays as the **phase 2 reference** for the iPhone location app (architecture, privacy, retention and test scenarios are still valid). What changed is the goal: GPS is a cheaper way to *capture* work, not the point.

## The two outcomes

1. **Technician time.** More of the paid day goes to billable work. Less goes to driving, unplanned parts runs, return visits and paperwork.
2. **Recovery.** Every billable minute and part done in the field reaches an invoice, the same day, with evidence the owner will accept.

Everything below is judged against these two. A feature that doesn't move one of them waits.

## Billing rule (decided October 2)

Hourly labor plus materials:

| Item | Rule | Source today |
| --- | --- | --- |
| On-site labor | Actual confirmed on-site minutes at `LABOR_STD` $95/h (after-hours ×1.5), billed in 15-minute increments, **1-hour minimum ($95) per job** | Price book, invoice form constants; the price book's $125 service minimum does not apply to these jobs |
| Job-related parts run / travel | Policy **still open** (see Decisions). Phase 1 records the time and links it to the job either way; nothing is charged until the policy is set. Never inferred from GPS alone | **No price-book item exists** |
| Materials | Receipt cost + markup (materials 25%, appliances 10%) | `DEFAULT_MARKUP_PCT`, `MATERIALS_CP` / `APPLIANCE_CP` |
| Flat-price jobs | Keep the approved price. Hours feed cost tracking and estimates, not the invoice | Task `pricing_method = flat` |
| Extra scope found on site | Needs office/owner approval before it's billed. The tech flags it; the phone never adds charges on its own authority | — |

## What exists today, and where recovery leaks

The field app (`/maintenance/field`, the workspace in field mode) already lets a tech see today's visits, record minutes, progress, free-text materials and notes, and submit for review (`maintenance_work_record`). Daily Billing Review flags unbilled completed work. The leaks are in the hand-offs:

| # | Leak | Why | Fix in this plan |
| --- | --- | --- | --- |
| L1 | **Logged minutes never become invoice quantities.** Invoices bill the task's pre-priced `amount`; actual time stops at the work record | The workspace `bill` op copies `maintenance_task.amount` | Closeout builds **proposed charges** from confirmed minutes (hourly tasks) |
| L2 | **Materials are free text.** Cost and markup are retyped by the office, if at all | No structured materials, no receipts | Receipt photo → structured material line with cost, markup applied |
| L3 | **Parts runs and travel are unpriced.** `activity_kind` can say `parts`/`travel`, but nothing charges for it | No trip / parts-run item in the price book | One policy item, applied by closeout when the run is linked to the job |
| L4 | **Leaks surface days later.** The unbilled report runs weekly for work verified 5+ days ago | Detection after the fact | Same-day closeout → draft invoice; recovery board shows unbilled $ by age |
| L5 | **No evidence attached.** Photos are typed URLs; owners dispute bills without them | No upload | Before/after photos and receipt images on the work record |
| L6 | **Start/stop times are reconstructed from memory.** Minutes are typed at day end | No timer | One-tap job timer with start/stop timestamps; GPS suggests them in phase 2 |

## The biggest sink: travel and shopping

Craig, October 2: *"part of the issue is how much time is spent travelling back and forth to the projects, to Lowe's, shopping and so on."*

Driving between projects, extra Lowe's runs mid-job and general shopping are paid time that rarely reaches an invoice. Today it's invisible: nothing records it, so nothing measures or charges it. The sample day in the demo shows the pattern: 3 jobs, 2 mid-job Lowe's runs, criss-crossing town. About a third of the paid day goes to driving and shopping.

Three moves, in order of payoff:

1. **See it.** Every drive and store stop becomes a recorded segment (one tap in phase 1, suggested automatically in phase 2), linked to the job it served or marked general. The day review and the office's utilisation view show **drive + shopping minutes per day and per billable hour**.
2. **Cut it.**
   - **Shop once, ahead of time.** The night before, the parts check for tomorrow's jobs becomes **one consolidated order** for pickup at the Lowe's Pro desk (already in `supplier`), or delivery to the site or shop. It goes into `parts_order` so it's tracked.
   - **Van stock.** Keep a short list of common parts (supply lines, wax rings, P-traps, fasteners) on the van, restocked weekly from the parts check. A missing common part shouldn't cost a 45-minute round trip.
   - **Route by area.** Group the day's jobs by part of town and order them to avoid crossing back. The existing Maps route link gets drive estimates and a "back-and-forth" warning.
   - **Return visits with the part in hand.** "Needs return" at closeout records the missing part, so the order is placed before the return is scheduled.
3. **Charge the part that belongs to a job.** A job-related parts run is charged by the parts-run policy (decision 1) and linked to that job. One trip serving several jobs is split across them by recorded time, never duplicated. General shopping and van restocking stay overhead, visible but not billed.

The phase 2 GPS app helps most here. Drive and store-stop time is exactly what location suggestions capture without taps. That is the main argument for phase 2 once phase 1 proves the workflow.

## Other time sinks, and what we change

| Time sink | Change | Measure |
| --- | --- | --- |
| Unplanned parts runs | See *The biggest sink* above: parts check the night before, one consolidated Pro-desk order, van stock | Parts runs per job; shopping minutes per day |
| Drive time | Route by area; see above | Drive minutes per billable hour |
| Return visits | Closeout asks "done / needs return" with the reason (part, access, scope); returns are scheduled with the part in hand | Return visits per job; reason mix |
| Paperwork at day end | Timer + receipt photo + closeout replaces typing minutes and materials from memory | Admin minutes per day; time from work done to draft invoice |
| Waiting / access problems | One-tap "blocked: no access" with time, so it's visible and chargeable if the policy allows | Blocked minutes per week |

## The technician's day (phase 1, in the Field app)

1. **Start day.** Clock in (existing Timekeeping). See today's jobs in route order with appointment windows, scope, and a **parts check** per job.
2. **Arrive → Start job** (one tap). Timer runs against the work order; start time is editable.
3. **Need a part → Parts run for this job.** The job pauses on-site time, starts a linked parts-run segment (travel → store → return). At the store, **snap the receipt**: the photo becomes material lines (description, qty, cost) the tech confirms. Return → **Resume job**.
4. **Finish → Closeout** (one screen): progress (done / needs return + reason), before/after photos, notes, flag any extra scope found. Below it, **proposed charges** appear: labor from confirmed on-site minutes, the parts-run policy line, materials at cost + markup, or the flat price. The tech confirms the record is accurate (not the price).
5. **Submit.** Submit stays disabled until every purchase has a receipt photo or is marked from van stock. The office (Penny or Brody for now) sees it within minutes as a **draft invoice**, not a weekly report finding.
6. **End day.** A short review of the day: paid hours, billable hours, drive, parts runs, unexplained gaps. Fix anything before clocking out.

Offline: everything above queues on the phone and syncs; nothing is lost if signal drops in a crawlspace.

## The office side

- **Same-day draft invoices** from submitted closeouts, with photos and receipts attached. The reviewer approves charges (especially parts-run lines and extra scope), then issues as today.
- **Recovery board:** captured value (work done) vs drafted vs issued vs posted, per day and per tech; unbilled $ aged 0–1 / 2–5 / 6+ days; top reasons (missing receipt, no closeout, awaiting approval). Replaces waiting for the Monday unbilled email.
- **Utilisation:** billable hours ÷ paid hours per tech per day/week, with the time-sink breakdown above. Reuses `dayMetrics` and timekeeping's worked hours; Craig keeps the admin-only paid-time comparison.

## Measures and targets

Take a **two-week baseline** before the pilot (current process), then the same two weeks with phase 1:

| Measure | Baseline source | Pilot target (confirm after baseline) |
| --- | --- | --- |
| Billable utilisation (billable ÷ paid hours) | Invoice labor hours vs timecards | +10 points |
| Work-done-to-draft-invoice time | Work record date → invoice created | Same day for 80% of jobs |
| Unbilled $ older than 5 days | Daily Billing Review / unbilled report | Near zero |
| Materials recovered (cost on invoices ÷ receipts) | Receipts vs invoice materials | ≥ 95% |
| Drive + shopping minutes per paid day | Activity records (phase 1); baseline from a two-week manual log | Down 40% |
| Parts runs per job | Activity records | Down 30% |
| Return visits per job | Visits per work order | Down |

These are proposals until the baseline is in. Nothing about GPS precision or recovery is assumed in advance.

## Build sequence

| Phase | Scope | Needs |
| --- | --- | --- |
| **1. Field closeout and recovery** (web, HDPM OS) | Job timer with timestamps; parts-run linked segments; receipt photo → material lines; before/after photos; closeout with proposed charges; hourly-from-actual billing on the workspace path; same-day draft invoice; recovery board; parts check before leaving | Photo storage; a pricing method that bills reviewed minutes; parts-run price-book item; receipt line entry (manual first, OCR optional) |
| **2. Location assistance** (native iPhone) | Arrival/departure and store-stop *suggestions* that pre-fill phase 1's timer; nothing else changes | Everything in `gps-timekeeping-plan.md`: SwiftUI + Core Location, mobile sign-in, privacy notice, 30-day raw-evidence retention |
| **3. Estimates from actuals** | Comparable reviewed jobs inform labor and parts in estimates; variance shown to Brody and Alberto | Enough reviewed closeouts (≥ 5 comparable per task) |

Phase 1 delivers both outcomes on its own. Phase 2 lowers the tap count and improves start/stop accuracy; it starts only if the phase 1 pilot shows missed or late timer starts are a real leak.

## Trip and return policy in the invoice system (proposed, October 2)

Craig asked how to implement a trip/return policy. The research he shared found no Oregon statute that sets trip charges; it's contract and disclosure. The norm splits on one question: **is it the same visit, or a new dispatch?** Proposed policy:

| Situation | Charge | System rule |
| --- | --- | --- |
| First dispatch to a job | The **1-hour minimum ($95)** acts as the trip charge. **No separate trip fee on top**, so the owner isn't charged for travel twice | Already decided (decision 2) |
| Same-day parts run (leave, buy, come back) | Billed as **labor at $95/h, capped at 30 minutes**, with a receipt showing the time | Parts-run segment linked to the job; cap enforced; receipt required (decision 4) |
| Parts run for a **van-stock item** (supply line, wax ring, cartridge, breaker, filter, smoke detector…) | **No charge** for the run; the part itself still bills at cost + markup | Price-book items flagged `van_stock`; the run line shows $0 with reason "van stock" |
| Return visit on another day for an ordered part | **Reduced return-trip charge of $47.50** (50% of the minimum) plus labor in 15-minute increments, **disclosed when the return is scheduled** | Visit kind `return`; charge needs a "policy disclosed" confirmation recorded at scheduling |
| Callback for tech error, wrong part ordered by the tech, or warranty | **No charge** (trip, run or labor) | Visit kind `callback` with fault `tech` / `warranty` zeroes the charges, shown as $0 lines with the reason |

Outside the system: the policy belongs in the **owner management agreement** (OREA disclosure of affiliated in-house maintenance fees), with a matching line in the tech SOP; confirm CCB licensing covers the billed work.

How it's built:

- **One pure, tested function** (`applyTripPolicy`) turns a job's visits, segments and receipts into charge lines. The closeout's proposed charges and the office's bill step both use it, so the tech, Penny/Brody and the invoice always agree.
- **Visit data:** `maintenance_visit` gains `visit_kind` (`dispatch | return | callback`), `fault` (`none | tech | warranty`) and `policy_disclosed_at`.
- **Price book:** new items `PARTS_RUN` (labor, 0.5 h cap) and `RETURN_TRIP` ($47.50); a `van_stock` flag on common parts.
- **Line items** gain `charge_basis` (`minimum | onsite | parts_run | return_trip | materials | no_charge`) and, for $0 lines, `no_charge_reason`. Zero lines stay on the invoice so the owner sees the work that wasn't billed.
- **Overrides:** Penny or Brody can override a rule on a draft with a required reason, which is kept in the audit trail.

## Owner charge or tenant charge, never both (proposed, October 2)

Every invoice says who pays: **Owner charge** or **Tenant charge**. One invoice never mixes them.

- **`hdms_invoices.charge_to`**: `owner | tenant`, NOT NULL, defaulting to `owner` (all existing invoices are owner charges). The payer lives on the invoice, not on line items, so a single invoice **can't** hold both.
- **Splitting a job:** when one work order has both, e.g. a repair the owner pays plus tenant-caused damage, each task or charge line is tagged with a payer at closeout. The bill step then creates **two invoices**, one per payer, linked by `work_order_id`. A job can have at most one open draft per payer, enforced by a unique index on (job, `charge_to`) for drafts.
- **Tenant charges need a basis (ORS 90):** tenant name and unit; a reason (`tenant_damage | lease_fee | other`) with a note; photos; and, for fees such as a no-access wasted trip, the lease clause that allows it. Without these, the invoice can't be generated.
- **PDF:** the header reads "Owner charge" or "Tenant charge · {tenant}, unit {n}"; tenant PDFs show the basis.
- **Reports and reconciliation:** billable reports, the unbilled queue and payments filter or group by `charge_to`. Owner invoices keep matching AppFolio bills; tenant invoices match whatever posting path is chosen (decision 7).

**Status (October 2):** v1 is built on `feature/invoice-charge-to`:
- `charge_to` and the tenant fields, with database constraints
- Owner/Tenant control on the invoice form
- PDF label and tenant block
- List badge and filter
- Reconciliation now sums every invoice on a work order
- Daily Billing Review "Post tenant ledger charge" follow-up

Still to come:
- automatic owner/tenant split of a workspace job (needs a payer on `maintenance_task`; ships with the field-app phase)
- an AppFolio tenant picker
- owner/tenant columns in the billable reports

Decisions still open for these two sections:

6. **Return-trip charge: $47.50** (half the minimum). *Decided October 2.*
7. **Tenant charge posting: option (a).** *Decided October 2.* The owner pays HDMS's bill as usual (AppFolio bill matching is unchanged), and the tenant charge is posted to the tenant ledger to reimburse the owner. HDMS's cash flow doesn't change.
8. **Van-stock list:** still to confirm the starting list of common parts.

Build order (decided October 2): the owner/tenant charge field ships first, on its own, before the field-app work.

## Data changes (phase 1, additive)

Reuse `maintenance_work_record`, `maintenance_task`, `maintenance_visit`, `maintenance_billing_allocation`, `hdms_invoices`, `parts_order`, Timekeeping. Proposed:

- `maintenance_work_record`: add `started_at`, `ended_at` (timer), `parent_record_id` (parts-run segment linked to its job record), `return_reason`.
- `maintenance_work_material`: record id, description, qty, unit cost, markup %, receipt attachment, supplier; replaces the free-text `materials` field going forward.
- `maintenance_attachment`: photos and receipts (Supabase Storage, private bucket), linked to work record / material.
- Pricing: a `pricing_method` (or `bill` op option) that bills **reviewed actual minutes** for hourly tasks, so L1 closes; flat tasks unchanged. Charges are computed by one pure, tested function used by both the phone preview and the bill op.
- Price book: one parts-run / trip item once the policy is decided.

Payroll stays separate: timer segments never edit timecards; the existing unexplained-time comparison keeps working.

## Decisions

Decided by Craig, October 2:

| # | Question | Decision |
| --- | --- | --- |
| 2 | Minimum charge for short hourly jobs | **1-hour minimum at $95** per job. Above an hour, 15-minute increments |
| 3 | Who approves proposed charges | **Penny and Brody** for now; moves to the new **Maintenance Coordinator Assistant** once hired. Approval happens on the draft invoice; issuing stays as today |
| 4 | Receipts | **Required before closeout.** A job with parts can't be submitted until each purchase has a receipt photo (or the part is marked "from van stock") |
| 5 | Pilot | **Yes:** Alberto and Brody. Two-week baseline on the current process, then two weeks on phase 1 |

Still open:

**1. Parts-run and travel charge.** Craig needs to think about this. Phase 1 can build and run without it: every drive and store stop is recorded and linked to its job, so the pilot will show how much time is at stake before a price is set. Options to weigh:

| Option | How it works | For | Against |
| --- | --- | --- | --- |
| A. Don't charge, absorb as overhead | Travel and parts runs stay cost; only on-site time bills | Simplest; owners rarely dispute | The biggest time sink stays unrecovered; no pressure to plan ahead |
| B. Flat trip charge per job-related run | e.g. one charge when a mid-job run was caused by the job (not by forgetting a van-stock part) | Predictable for owners; easy to explain | Needs a rule for whose fault the run was; may feel like a penalty |
| C. Actual minutes, capped | Bill recorded parts-run minutes at $95 up to a cap (e.g. 30 min) | Fair to actual effort | Varies job to job; owners may question drive time |
| D. Build into rates | Raise the hourly rate or the minimum slightly and never bill trips separately | No separate line to dispute | Penalises well-planned jobs; hides the cost |

Whichever is chosen, a trip serving several jobs is split by recorded time and never charged twice, and general shopping or van restocking stays overhead. The pilot data (drive + shopping minutes per job, and how many runs were avoidable) is the input for this decision.

Out of scope for this plan: payroll changes, automatic invoice issuing, GPS in phase 1, customer-facing tracking.
