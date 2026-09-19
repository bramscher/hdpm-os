# Maintenance workspace and invoice manager — proposal

Status: implementation roadmap, September 18, 2026. Branch: `feature/invoice-manager`. The first working release is described in [maintenance-workspace-rollout.md](maintenance-workspace-rollout.md); sections below include capabilities planned for later iterations.

## Problem and intended result

HDPM already has work-order invoicing, a price-book estimate builder, maintenance boards, turnover schedules, and payroll timecards. Staff still have to connect these pieces themselves. This makes it difficult to prepare consistent estimates, see what each technician accomplished on a particular day, and collect every justified charge before a job disappears from view.

The proposed workspace follows the same work from scope through scheduling, completion, draft billing, AppFolio posting, and payment. Its primary daily question is: **What work is planned, what was performed, and what still needs to be billed?**

## What exists and what is missing

These findings are based on the current implementation, plus a read-only check of the live price book.

| Existing capability | Gap to address |
| --- | --- |
| Price-book estimate rows, live price preview, issued versions, approvals, PDF, conversion to an invoice | No reusable estimate-template workflow; the builder starts with an empty row or an AI suggestion. It needs resumable drafts and a template library. |
| Flat, hourly, minimum, package, quantity, cost-plus, quoted and allowance pricing types | The types are broader than the finished workflows. Package component exclusions, allowance reconciliation and progress billing need explicit behavior before relying on them. |
| Invoice drafts, work-order references, technician fields, PDFs, credits, AppFolio bill matching and payment reconciliation | No shared record of a completed task on a particular date, or durable links allocating that task to invoice lines. |
| Weekly and daily labor reports | Labor is assigned to invoice completion date or creation date. Line quantity is treated as labor hours; a flat-fee quantity of one is not necessarily one hour. Drafts can be included with issued invoices. |
| Approved estimate conversion | Conversion is for a whole version, guarded against duplicate conversion of that version. Progress billing requires protection across individual scope items, revised versions and multiple invoices. Conversion also needs to carry job/work-order links, price method, work dates and technician allocation. |
| Work-order board, turnover timeline and scheduled dates | No unified technician capacity calendar with actual work and billing overlays. Some current timeline dates are inferred; they must not become confirmed appointments or actual service dates. |
| Payroll timecards with daily shifts and leave | No work-order link on individual time entries. Payroll hours cannot identify which job or task produced the charge. |

The live price book has 12 active current items. `LABOR_STD` is $95/hour. Four items remain explicitly marked PLACEHOLDER: `CLEAN_STD`, `PAINT_WALL`, `HAUL_LOAD`, and `PKG_STD_TURN`. Do not silently adopt their current prices as an approved rate schedule. Inspection, coordination, standard and emergency visit minimums, labor, materials and appliance markup also exist.

Source files: `components/turn-estimator/EstimateBuilder.tsx`, `lib/turn-estimator/{types,pricing,convert,dispatch}.ts`, `lib/invoices.ts`, `app/maintenance/invoices/daily-report.tsx`, `lib/maintenance/turn-schedule.ts`, and `lib/timekeeping/model.ts`.

## Goals and pilot measures

Proposed success targets, to be validated during an initial two-week pilot:

1. Prepare a normal turn estimate from a template in under five minutes once inspection scope is known. Measure start-to-save time and edits per estimate.
2. Record technician, job, work date and disposition for at least 95% of completed work by the following morning. Report missing entries explicitly.
3. Put at least 95% of reviewed billable work into a draft or a named billing hold by the next business day. Show the age and responsible person for the rest.
4. Complete the morning review in approximately ten minutes, with one queue for exceptions and actionable links to the underlying jobs.
5. Produce zero duplicate task charges in the pilot and reconcile draft, issued, AppFolio-posted and paid totals independently.

Craig's starting daily productivity target is 6–8 equivalent billable hours at $95: $570–$760 of technician service value per working day. This is a proposed configurable target band, not a cap. The existing weekly 30–36-hour target should not be silently reused as a conflicting daily target; derive the new weekly target from scheduled working days and the configured daily band.

## Four primary views

| View | What it answers | Main actions |
| --- | --- | --- |
| Today — default landing page | What needs attention, and how is each technician's day looking? | Fill a schedule gap; assign a job; review completed work; resolve missing information; open the billing draft. |
| Schedule | Who is going where, when, and with what expected workload? | Schedule visits; assign one or more technicians; see unassigned work, conflicts, blocked jobs and available capacity. |
| Jobs & Estimates | What is the scope, approved price, progress and remaining work? | Start from a template; adjust scope; request approval; record work; view photos/materials; add a change order. |
| Billing | What has been earned, drafted, issued, posted and paid? | Review drafts; bill selected completed tasks; resolve holds; generate invoices; match AppFolio bills and payments. |

Templates and Price Book sit under Manage rather than competing with the daily views. Reports become drilldowns and exports from these views. Existing advanced reports remain accessible during rollout until parity is verified.

Every view opens the same job panel: property/unit, AppFolio work orders, estimate, approved scope, visits, work performed, materials, attachments, billing and history. A turn can group multiple work orders; an ordinary repair can use a single work order. These are links to existing records, not duplicate work orders.

Keep execution status and billing status separate. A job can be in progress with one invoice already issued and additional completed tasks awaiting billing.

## Estimate templates

Initial templates:

| Template | Default structure |
| --- | --- |
| Standard unit turn | Inspection and scope; maintenance punch list; cleaning; paint/touch-up; flooring/carpet review; locks/keys; smoke/CO and safety checks; appliances; hauling; materials; final readiness check. |
| Light turn / refresh | Inspection, small repair punch list, selective touch-up, cleaning, safety check and final readiness. |
| Maintenance visit / punch list | A visit minimum where applicable, selected flat-fee tasks, additional time only where the approved pricing calls for it, and materials. |

Template sections are reusable scope checklists. Their presence does not automatically create a charge. Each entry is either an included service, an optional service to confirm, or an inspection/checklist item. Missing price-book services are marked Needs pricing and block issue if included in chargeable scope.

Requirements:

- Start estimate → choose property/work order → choose template → confirm scope/quantities → save draft or issue for approval.
- Preload price-book items by stable item code, default quantities, room/category, planned duration, owner-facing description, and optional/internal checklist instructions.
- Resolve the price-book rate effective when pricing the estimate; persist the issued price snapshot and source template version. Repricing requires a deliberate action, with the change shown.
- Allow include/remove, quantity adjustment, per-room scope, assignment of in-house versus vendor work, and additional tasks.
- Default to flat task or per-unit prices where scope is defined. Hourly and quoted work remain available for uncertain scope. Show explicit exclusions and overage rules for packages.
- Save as template, duplicate, rename, edit, publish and archive. Published versions do not alter estimates already created. Templates retain no property, owner or tenant-specific data from the source estimate.
- Template authoring and publishing follow staff roles; price overrides require a recorded reason and appropriate review.
- Prevent charging both a package and its included components. Apply one visit minimum per continuous visit under the configured rule; identify tasks already covered by the minimum.
- Distinguish owner charge, materials/vendor cost and internal planned labor. Flat-fee quantity is a task count, not a time entry.

Review the four placeholder prices and add task-level items needed for locks, fixtures, safety devices, appliance service and common punch-list repairs. Source and approve those rates before publishing corresponding billable template lines.

## Work performed and rolling invoice drafts

Use a lightweight work record: **technician + job/task + date worked + actual time + quantity/progress + notes/materials/evidence**. Link it to an estimate scope item when present. Support unplanned repairs as additional work needing classification or approval.

Confirmed by Craig: technicians record completed tasks and actual time; the office reviews billing.

Technician quick update, designed for a phone: open My Day → select the assigned job → mark tasks Done / Part done / Blocked → enter actual time and completed quantity → add materials/photos where required → submit for office review. The job, technician and work date are prefilled, with the performed date confirmed when entering a late update. Autosave unfinished entries so an interruption does not lose the work.

The office sees a Needs billing review queue with the technician's submission, approved scope, price-book charge, materials and proposed draft lines together. The reviewer can accept eligible lines into the rolling draft, hold a line with a reason, or return a question to the technician. Submission alone does not approve a charge or issue an invoice. Technician-entered actual hours remain distinct from flat-fee equivalent hours.

Office-assisted corrections are an exception: retain the technician's original submission and record the editor, reason and revision. A correction after billing triggers review of the affected charge rather than silently changing an issued invoice.

Completed work creates or updates suggested billing lines in a rolling draft. A partial draft can remain open throughout the job. It shows completed work, items still pending, holds and remaining approved scope. A suggestion is not an issued charge.

Two distinct actions:

1. **Accumulate a draft:** collect completed tasks and materials each day, then issue one invoice at completion.
2. **Progress invoice:** select eligible completed tasks or agreed milestones to issue now, leaving the remainder available for later billing under the owner's authorization.

Default to accumulating a draft. Enable progress invoicing deliberately for suitable jobs. Estimated future work is never counted as completed production. Part-done flat tasks stay pending until complete or an agreed milestone is reached; a percentage entered by a technician does not automatically establish a billable amount.

Invoice-line allocations track source scope/work records, quantities and amounts already reserved in a draft, issued, credited and remaining. Enforce these limits transactionally, including simultaneous users and revised estimates. A newly issued estimate version must not make previously billed work billable again. Removing an unissued draft line releases its reservation; corrections to issued charges use the existing void/credit workflow with history retained.

Review holds include unapproved extra scope, missing price, missing work date or technician, incomplete evidence where required, missing vendor cost, unresolved responsibility, potential duplicate, and price/cost variance. Each hold has an owner and next action.

## Calendar and daily productivity

### Proposed technician mobile experience

Recommendation for Craig's review: build a dedicated phone-first technician view in the existing web application, with Home Screen installation, before considering a separate native iPhone app. Share the existing login, job records and office review workflow. The current app has no dedicated web-app manifest or service-worker file in the inspected app/public tree; installation metadata and any offline behavior need explicit implementation and device testing.

Use three bottom-navigation destinations: **My Day**, **Jobs**, and **My Time**. Keep office billing/reconciliation tools in the office workspace. My Time should link to the existing timecard and reconcile job-time coverage; job timers do not silently replace payroll shift records.

| Screen | Primary content and action |
| --- | --- |
| My Day | Today's assigned jobs in order, current job timer, submitted/pending work, office questions and a single prominent Start job / Resume job action. |
| Job | Address, scope checklist, access information limited to authorized users, directions link, approved tasks, and Start / Pause / Finish controls. |
| Finish visit | Confirm date and actual time; mark tasks complete, partial or blocked; add materials/receipt/photo and a short note; Submit for office review. |
| My Time | Actual shift/work summary, job allocations, travel/other time, missing entries and a link to the existing payroll timecard. |

Interaction requirements:

- Single-column layout, large labeled controls (target at least 44 × 44 CSS pixels), readable text, minimal typing, and bottom actions clear of the iPhone safe area and keyboard.
- Support quick manual time entry as well as Start / Pause / Finish. Only one active job timer per technician; switching jobs resolves the previous timer.
- Persist timer start/stop events and calculate elapsed time from timestamps when reopened. Do not depend on JavaScript continuing to run while the phone is locked. Detect forgotten running timers and ask the technician to confirm actual time.
- Clearly separate a shift clock from a job timer. Do not require clocking out of payroll to pause a job for travel, lunch, or a different task.
- Autosave in-progress forms. Display Saved, Pending sync, Submitted, Returned and Reviewed explicitly, with retry controls and idempotent submission. Only claim offline support after implementing secure local storage, account separation, attachment retry, conflict handling and reconnect tests.
- Phone camera/photo-library upload for completion evidence and receipts. Do not mark an attachment as submitted until upload succeeds.
- First release uses visible office-question and missing-entry badges. Optional push reminders can follow after Home Screen installation and explicit notification permission; no automatic notification enrollment.
- Test on actual iPhones: small screens, larger text, keyboard open, lock/reopen during a timer, poor signal, interrupted upload, session expiration and repeated taps.

Native iPhone development becomes a separate decision if the pilot establishes a need for deeper offline operation or device/background integrations that the web implementation cannot reliably support. Reuse the same server APIs and record identities if that happens.

Platform references: [Apple Home Screen web-app instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios) and [WebKit Home Screen web push support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Home Screen installation and push support do not by themselves provide offline operation.

### Office calendar and measures

Default to a week calendar with a row per technician and a day-detail drawer. Provide Today, Week and Month modes, plus property/job filters. Future dates show planned visits and duration; past dates show actual work performed, completed service value, draft value and issued value. Use text labels as well as colors.

Three separate measures:

- **Actual hours worked:** recorded work time, with travel, purchasing, meetings, rework and other nonbillable categories separately explained. Payroll remains the payroll record.
- **Service value completed:** reviewed in-house labor/service value earned from completed scope, counted once whether it is unbilled, in draft, or invoiced.
- **Equivalent billable hours:** qualifying service value ÷ the configured $95 benchmark. This can exceed actual hours for efficiently completed flat-fee work. Never label it as hours physically worked or export it as payroll time.

Materials, tax, outside-vendor charges and coordination charges do not inflate a technician's service-value target. Mixed packages require an explicit service/material split. For multiple technicians, allocate the service value once across their contributions; default to their recorded work-time proportions, with an audited adjustment available.

Illustration only — not actual Alberto performance:

| Alberto — one workday | Value |
| --- | ---: |
| Actual recorded work | 7.0 hours |
| Completed in-house service value | $855 |
| Equivalent billable hours at $95 | 9.0 |
| Of that value, in draft | $665 |
| Of that value, issued | $190 |
| Daily target band | $570–$760 |

Draft and issued are parts of the $855, not amounts to add on top. Planned work contributes only to the forecast. Mark provisional/unreviewed entries explicitly.

For work across multiple days, preserve actual daily work records. A completed flat task's value can be allocated across those dates using recorded contribution, with a visible allocation rule. Before completion, show expected value as forecast, not earned value. Record both performed date and invoice issue date so late billing does not shift productivity to the wrong day.

Days off and leave reduce available capacity and target expectations. A day below target triggers a useful explanation prompt, not automatic billing: insufficient scheduled work, waiting on parts, travel, rework, missing work records, or completed work awaiting capture.

## Daily operating routine

**Morning:** Open Today. Review yesterday's completed work awaiting billing, open drafts and holds. Check today's technician loads, approvals, parts and access. Fill genuine capacity gaps from approved unscheduled jobs.

**During the day:** Record short task updates against the scheduled job. New scope is visible as a proposed change. Completed tasks appear in the billing review queue without recreating descriptions and rates.

**End of day:** Confirm each technician's work dates, tasks and hours; categorize unexplained time; review billable suggestions; advance eligible charges to a draft. Show exactly what remains unreviewed.

**Weekly:** Compare actual work, completed service value, drafts, issued charges, AppFolio posting and payment. Review pricing/margin outliers and repeatedly missed tasks to improve templates.

## Priorities and implementation sequence

### Phase 1 — templates and reliable job linkage (must-have)

Build the template library, three starters, autosaved/resumable estimate drafts, pricing-review flags and shared job links. Update estimate→invoice conversion to retain scope identity, pricing method and work-order linkage. Preview the four-view navigation using the existing tools underneath it.

Acceptance: a standard turn starts with the agreed components; optional entries are easy to omit; included placeholder-priced entries block issue; saving and reopening retains the draft; template/rate edits do not change issued estimates; conversion opens the existing invoice flow with the correct job.

### Phase 2 — actual work records, Today, and rolling drafts (must-have)

Add dated task records and technician allocations, with phone-friendly My Day entry and submission. Connect them to the office's Needs billing review queue, billing suggestions and draft reservations. Deliver the morning queue, named holds and per-technician daily cards. Add flat-fee service-value reporting independently of actual hours.

Acceptance: a technician can submit tasks and time from a phone without entering customer prices; submissions appear once in the office review queue; returned questions and held lines remain visible; work on Monday remains on Monday if invoiced Friday; an incomplete job can have a saved partial draft; draft work is visibly distinct from issued billing; reprocessing or simultaneous review cannot duplicate charges; one $950 service task shared by two technicians contributes $950 total, not $1,900.

### Phase 3 — unified scheduling and progress billing (must-have for the complete workflow)

Add weekly technician scheduling, capacity/conflict checks, unscheduled backlog, calendar history and optional progress invoices with remaining-scope tracking. Preserve AppFolio's work-order identity and expose integration freshness/errors. Initially distinguish local planned visits from confirmed AppFolio dates; any write-back needs explicit synchronization rules and conflict handling before activation.

Acceptance: move a planned visit without changing completed work dates; partially bill selected eligible scope without duplicating the remainder; scheduling two people preserves individual capacity and shared-job identity; a completed unbilled job cannot silently disappear from the Today queue.

### Phase 4 — refinements (should-have)

Template suggestions based on job history, stronger price/margin feedback, consolidated reports, simplified mobile capture and improved timecard comparison. Reconcile existing invoice/AF-bill matching so manually entered AppFolio charges do not get billed again. Basic AppFolio matching remains in use throughout the rollout.

Later: offline capture, route optimization, automated external posting and additional vendor workflows. These do not block the initial daily review and draft capture.

## Data and integration design

Extend the existing estimate, invoice, work-order and staff records rather than creating an independent billing system. Add:

- Estimate template header, immutable published template versions, ordered template entries, and mutable estimate-draft storage.
- Stable job/scope identifiers retained across estimate revisions; links to existing work orders and turns.
- Planned visits and technician assignments with timezone and source/confirmation status.
- Dated work records and task progress, including author, technician, classification, evidence and review status.
- Billing allocations joining source work/scope to invoice lines, with transactional duplicate and overbilling checks.
- Effective-dated daily target settings and attribution rules for service value; preserve benchmark rates used for historical calculations.

Use Pacific service dates explicitly. Historical invoices without known performed dates remain labeled as legacy completion-date attribution; do not invent daily allocations. Reconcile the new metrics against existing totals on a small sample before changing the dashboard defaults.

Enforce permissions server-side: technicians see assigned jobs and enter work; office reviewers prepare billing; authorized managers approve scope/pricing exceptions; administrators manage price books and targets. Keep margins and payroll details limited to appropriate roles. Every financial change retains an audit trail.

## Scope boundaries

- Continue using the existing invoice/PDF, credit, AppFolio reconciliation and payment facilities.
- Keep payroll hours and overtime calculations independent of flat-fee equivalent hours.
- Suggestions and drafts require review before issue; this plan does not enable automatic external sends, payments or AppFolio posting.
- Owner/tenant charge responsibility and authorization remain explicit decisions; templates do not automatically assign tenant liability.
- Do not redesign unrelated rent-comps or communication features as part of this work.

## Confirmed workflow and remaining decisions

**Confirmed:** technicians enter completed tasks and actual time; office staff review billing. Phase 2 includes phone-friendly entry, submission/review status, returns for clarification and audited corrections.

| Decision | Proposed starting point | Needed for |
| --- | --- | --- |
| Pilot team | Alberto first, with Brody supported by the same model; then expand after the daily routine works. | Pilot rollout |
| Target definition | 6–8 equivalent hours/day at $95 for in-house service value; configurable by technician and day. | Phase 2 metrics |
| Standard turn scope and prices | Review starter checklist and replace four placeholder prices; define package inclusions and exclusions. | Publishing billable templates |
| Progress billing practice | Accumulate a draft by default; issue selected completed tasks/milestones only where appropriate and authorized. | Phase 3 invoice rules |
| Calendar source of truth | Read AppFolio work orders; distinguish local planned visits from confirmed source dates until synchronization is designed. | Phase 3 scheduling |

## Verification plan

Test template versioning and retired price items; resume draft after interruption; price-book effective dates; package/minimum overlap; flat quantities versus hours; per-day and multi-technician attribution; Pacific midnight boundaries; duplicate clicks and concurrent billing; partial quantities and estimate revisions; credits/voids; permissions; and AppFolio matching failures. Pilot one normal turn, one small flat-fee repair, one multiday job and one job with a scope change before replacing the daily landing page.

The phone workflow can be reviewed in the [clickable prototype](maintenance-tech-prototype.md)
at `/prototypes/maintenance-tech.html`. It uses fictional browser-local data;
no live maintenance, billing, or payroll behavior changes are included.
