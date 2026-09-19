# Maintenance workspace — first working release

Date: September 18, 2026. Branch: `feature/invoice-manager`.

The production migration `20260919_maintenance_workspace.sql` was applied through the HDPM Supabase SQL editor with Craig's explicit approval. The dashboard reported success; server-side reads confirmed the new tables are available. It creates server-only tables and functions, adds links to existing invoices and estimates, and preserves legacy records.

## Start here

- Office: `/maintenance/workspace` (also linked from Invoices).
- Technician: `/maintenance/field`.
- Estimate templates: `/turn-estimator/estimates/new`.

1. In Jobs & Estimates, add an existing work order. This opts the job into the workspace without duplicating the original work order.
2. Create an estimate from Standard unit turn, Light turn / refresh, or Maintenance visit / punch list. Confirm each chargeable item, resolve missing or placeholder pricing, and save or issue. Save a reusable template or publish a new version when useful.
3. For an approved estimate, return to its job and choose Import approved scope. Alternatively, add separately authorized price-book tasks directly. Use task billing for this workflow; whole-estimate conversion and imported task billing cannot both bill the same scope.
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
