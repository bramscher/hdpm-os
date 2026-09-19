# Maintenance workspace — first working release

Date: September 18, 2026. Branch: `feature/invoice-manager`.

The production migration `20260919_maintenance_workspace.sql` was applied through the HDPM Supabase SQL editor with Craig's explicit approval. The dashboard reported success; server-side reads confirmed the new tables are available. It creates server-only tables and functions, adds links to existing invoices and estimates, and preserves legacy records.

## Start here

- Work & Billing: `/maintenance/invoices` — Work Orders → Estimates → Invoices → Reports → Reconcile.
- Daily work and scheduling: `/maintenance/workspace`.
- Technician: `/maintenance/field`.
- Estimate queue: `/maintenance/invoices?tab=estimates`; templates and price-book scope start at `/turn-estimator/estimates/new`.

1. In Work Orders, choose Create estimate (or continue/review the existing estimate). Use Quick invoice for simple, already-authorized work ready to bill. Starting from a template also offers a work-order picker before editing.
2. Create an estimate from Standard unit turn, Light turn / refresh, or Maintenance visit / punch list. Confirm each chargeable item, resolve missing or placeholder pricing, and save or issue. Save a reusable template or publish a new version when useful.
3. Open an approved estimate and choose Set up job & schedule. This creates or reopens the linked job and imports its approved scope, then opens the job directly. Alternatively, add separately authorized price-book tasks directly in the workspace. Whole-estimate conversion and imported task billing cannot both bill the same scope.
4. Schedule a visit and assign technicians. The schedule is a local HDPM plan; it does not write back to AppFolio.
5. Technicians enter actual minutes, date, progress and work/material notes. Save unfinished work or submit it for review. Office can accept, hold, or return a question.
6. Select completed, reviewed tasks to add to the job's rolling draft. A task is reserved once, including work shared by multiple technicians. Generating an invoice with scope remaining requires recorded progress-billing authorization.
7. Open invoice tools to generate the PDF and use existing reconciliation and credit tools. Releasing an unissued draft voids it and frees its tasks. Voiding an issued invoice does not automatically make its tasks billable again.

Today and the calendar distinguish actual recorded hours from completed service value, draft value, and issued value. Service value is distributed over actual work dates and technicians by recorded minutes, with cents preserved. Default targets are 6–8 equivalent hours at $95; these are configurable, effective-dated benchmarks, not payroll hours or automatic charges. Materials and coordination do not count as technician service value.

## Current boundaries

- Existing work orders must be added to the workspace; this first release does not import the entire historical backlog or infer dates/hours from invoices.
- Phone entry currently uses an explicit minutes form and saved work records. The standalone prototype's timer, offline queue and camera workflow remain future work. Evidence is a text/reference field in this release.
- Progress billing selects whole completed tasks; it does not split an unfinished task by percentage. Split separately priced milestones in approved scope when appropriate.
- Packages and allowances require itemization. A visit minimum conservatively blocks additional direct tasks; use an itemized approved estimate to define its full scope and avoid overlapping charges.
- Price-book items marked PLACEHOLDER cannot be issued. Checklist components without a price-book mapping remain optional until pricing is approved. Prices are resolved again when issuing and then stored as snapshots.
- Imported estimates use the existing price-book categories to determine service value. Scope involving outside vendors needs office review; direct tasks have an explicit in-house switch.
- AppFolio posting, payment, credits, and payroll remain in existing tools. No automated external messages or live vendor texts are enabled.

## Validation

- `node scripts/test-maintenance-workspace-db.mjs`: 36 checks, including repeat migration, technician access, submitted record locking, review/return, actual date preservation, shared-task billing, retries, reservations, partial issue authorization, immutable invoice amounts, PDF snapshot conflicts, template versions, draft conflicts, and anonymous access denial.
- `npm test -- --reporter=dot`: 88 files, 909 tests passed, including maintenance value/date calculations.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.

The proposal in `invoice-manager-plan.md` remains the broader roadmap. This document describes the implemented first release and its operational limits.

## Estimates navigation cleanup

The Estimates queue combines saved drafts and issued estimates, grouped as Drafts, Awaiting approval, Approved, In billing, and Closed. Partial task drafts remain under Approved with an explicit undrafted-task count. The review page provides scope, estimate PDF, recorded approval/decline, job setup, and authorized full-scope invoice conversion. Existing approval and conversion role boundaries are retained; manager create/issue access now matches the existing manager builder and approval workflow. Work-order actions reopen existing active estimates instead of silently starting another draft. Suggested scope is explicitly requested and reviewed before issue; it does not approve work or send messages.

Validation for this cleanup: 919 tests across 90 files passed, including new queue-stage and estimate-to-job handoff checks. The production build passed. No additional database migration is required.

## Availability and revenue planning

Price Book is linked directly from the maintenance header, Estimates queue, estimate builder, review screen and calendar. The builder opens it in a separate tab to preserve edits. Templates reference price-book items; issued estimates and imported approved tasks retain their price snapshots.

Work orders now have Schedule actions. Approved estimates can schedule directly, importing their approved scope through the existing guarded handoff. Draft or unapproved scope may reserve a work-order visit, but the booking itself grants no approval and contributes no forecast revenue until approved pricing is attached.

The Schedule view shows booked crew hours, unbooked capacity for today onward, upcoming planned revenue and planned service value. It defaults to Alberto, Brody, and other assigned technicians, with an option for all staff. Capacity reads existing Timekeeping workweeks and subtracts all break minutes and recorded off/leave time; it does not write payroll records. The API returns only schedule availability and generic unavailable minutes, not leave categories, payroll information, notes or actual shifts. Missing workweeks are shown as unknown. Over-capacity plans are highlighted; time overlaps are still rejected by the existing visit RPC.

Forecasts allocate remaining approved job charges once across all upcoming planned visits, in proportion to planned crew minutes. Multi-technician visits split their share. A filtered date range only displays its allocated portion. Materials and coordination stay in revenue but are excluded from service value. Reported-complete or already-reserved tasks, cancelled/completed visits and overdue visits do not contribute to upcoming revenue. An unpriced booking is explicitly marked. These allocations are forecasts, not earned revenue, cash flow or invoice entries.

Availability covers local HDPM plans only. AppFolio-only appointments and travel must be allowed for separately. Current workweek defaults are used, so historical capacity is not an immutable payroll snapshot. No new database migration is needed.

Validation: 930 tests across 91 files passed, including revenue conservation across multiple visits/technicians, filtered forecast dates, completed/reserved scope exclusion, unpriced work, leave, overnight capacity and overbooking.

## Work & Billing navigation

The former Invoices section is named **Work & Billing** in the sidebar, mobile header, dashboard tile, page heading, and browser title. Work Orders, Estimates, Invoices, Reports, and Reconcile remain separate tabs. Estimate creation/review and the work workspace retain the same section highlight. Existing `/maintenance/invoices` links remain valid.

The Estimates tab was built on `feature/invoice-manager` but was absent from `main` when only the paper-workflow role change was promoted. The estimates queue requires the saved-draft, template, and maintenance-workspace implementation from this branch, including the already-applied `20260919_maintenance_workspace.sql` migration. Publish the connected release with the navigation rename so the tab, queue API, estimate review, and job/billing handoff are available together.
