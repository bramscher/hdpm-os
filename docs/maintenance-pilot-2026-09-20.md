# Work & Billing pilot — September 20, 2026

Status: production deployment verified; real-job pilot awaiting work-order selection, reviewer, and pricing decision. No production records or prices changed during this readiness check.

## Verified

- GitHub Production deployment `6545529976` for release `8aa3dc4` reports success (September 19).
- Latest Production deployment `6556824945` for `375ddea` (Allow deleting unissued draft estimates) reports success (September 20).
- Authenticated production Work & Billing and Estimates screens load. The estimate queue displayed zero estimates during inspection.
- Production Price Book loads 12 items. Four remain explicitly marked PLACEHOLDER; see below.
- Production Schedule loads Alberto and Brody with saved workweek capacity. The displayed September 14–20 week has zero booked crew hours and zero planned revenue. This is a local schedule, not proof of AppFolio availability.
- Production Field screen loads My Day, Jobs, and My Time under Craig's admin session, with no visits for September 20. Technician-account access and actual submission remain pilot checks.
- Local focused checks: 64 tests across 9 maintenance-workspace/turn-estimator files passed; 48 isolated PGlite maintenance database checks passed. These ran on the current working tree, not an isolated production checkout. A full build and complete test suite were not rerun.

## Pricing decision

These are observed production placeholder amounts, **not approved rates**:

| Item | Current placeholder | Definition needed |
| --- | --- | --- |
| CLEAN_STD | $250/turn | Unit size, condition, inclusions, and approved cleaning rate |
| PAINT_WALL | $120/room | Room/surface scope, prep, coats, materials, and approved rate |
| HAUL_LOAD | $95/load | Load size, disposal charges, and approved rate |
| PKG_STD_TURN | $450/package | Included tasks, labor allowance, materials, exclusions, and approved rate |

The seed describes the package as up to four labor hours with materials additional; reconfirm this scope before publication. Existing production standard labor displays $95/hour, standard visit $125 plus $21.25/15 minutes, and materials cost plus 25%. Verify applicability to the selected job. Do not combine overlapping minimum/package and labor charges.

Either supply approved rates and scope or explicitly omit these four items from the pilot. Included placeholder scope blocks estimate issue. The current Reprice UI changes only the amount and preserves the PLACEHOLDER name, so repricing alone does not approve an item or unblock issue. An approved replacement must also update the name/instructions through the existing versioned price-book API or an appropriate admin UI change, preserving issued snapshots.

## First real job

Pending inputs: work-order number/property, actual scope, office reviewer, and agreed visit date/time. Alberto is the proposed first technician; add Brody only if the real job requires him.

Craig will select the pilot work order and reviewer on Monday morning, September 21. Leave these unassigned until then. Pricing can be revised in this runbook, but actual estimate pricing and placeholder clearance must also be updated in the application's Price Book.

1. In [Work & Billing](https://hdpmchat.highdesertpm.com/maintenance/invoices), find the chosen work order and create or reopen its estimate. Record the work-order and estimate IDs below.
2. Select the appropriate template, include only confirmed chargeable scope with approved prices, and save/reopen the draft to check persistence.
3. Issue the estimate only when scope and pricing are ready. Record actual authorization and its source in review; do not fabricate approval to exercise the workflow.
4. Choose **Set up job & schedule**. Confirm the imported scope matches the approved estimate. Book the actual visit against technician capacity and separately check AppFolio appointments/travel.
5. Alberto uses [Field](https://hdpmchat.highdesertpm.com/maintenance/field) to enter actual work dates, minutes, progress, materials, and notes. Save unfinished work; submit completed work for review.
6. The named office reviewer accepts the record or returns a specific question. Confirm any returned record can be corrected and resubmitted without losing its work date.
7. Add completed, reviewed tasks to the rolling invoice draft. Check quantities, prices, materials, actual dates, technician attribution, and remaining scope. Confirm shared tasks are billed once.
8. Review the PDF and totals before issuing a real charge. If scope remains, record actual progress-billing authorization. Reconciliation follows the existing workflow after the real invoice/payment exists.

## Pilot record

| Evidence | Result |
| --- | --- |
| Work order / property | Pending selection |
| Estimate / approved scope | Pending |
| Approval source / date | Pending actual authorization |
| Job / visit / technician | Pending |
| Work records / actual minutes | Pending actual work |
| Office reviewer / review outcome | Pending |
| Invoice draft / checked total | Pending |
| Issued invoice / reconciliation | Pending actual billing/payment |
| Problems and owner | None recorded yet; pilot not started |

Expand only after one job completes the loop with correct scope, actual time, review, and no duplicate charges. Then exercise a normal turn, a small repair, a multiday job, and a scope-change case as applicable; record real outcomes rather than treating automated checks as field adoption.
