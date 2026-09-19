# Cloud build handoff: invoice manager

Implement the real maintenance invoicing and scheduling workflow in
`bramscher/hdpm-os`, starting from branch `feature/invoice-manager` (prototype
and plan commit `7a3b083`). Read repository instructions first, then
`docs/invoice-manager-plan.md` and `docs/maintenance-tech-prototype.md`.
The user approved building the office-side features and likes the existing
phone prototype at `public/prototypes/maintenance-tech.html`.

Deliver working, persistent features rather than another sample-data demo:

1. Reusable estimate templates built from the existing price book, starting
   with a unit-turn template. Support creating/editing templates and resuming
   job-specific estimate drafts. Preserve template versions and price snapshots;
   do not invent production prices for placeholder items.
2. Technician work records with performed dates, completed/partial/blocked
   tasks, actual minutes, notes, and materials. Use the phone prototype's
   interaction design. Technicians submit; office staff review, return
   questions, and prepare billing drafts.
3. A daily office view of completed work, missing records, unreviewed and
   unbilled work, and draft/issued amounts. Link rolling and partial invoice
   drafts to their source tasks and visits, preventing duplicate charges and
   overbilling, including concurrent requests and repeated submissions.
4. Today/week/month calendar views with technician rows, scheduled visits,
   actual work, and billing status; property/job filters and day details.
   Distinguish local planned visits from AppFolio-confirmed dates. Retain the
   work order identity and show unscheduled work and scheduling conflicts.
5. Show actual hours separately from flat-fee service value divided by the
   configurable $95/hour benchmark. Default service target is 6–8 equivalent
   hours per technician day; materials do not count toward service value.
   Never substitute equivalent hours for payroll hours or invent work dates.

Follow the phased implementation and acceptance details in the plan. Reuse
existing invoice, estimate, price-book, staff, work-order, authentication, and
Supabase patterns. Add migration files, transactional allocation rules,
server-side role/assignment permissions, and an audit trail. Retain existing
invoice/PDF, credit, payment, and AppFolio reconciliation behavior.

Keep this work on a feature branch. Do not change live records, run production
migrations, deploy to production, issue invoices, send messages, enable live
SMS, or post to AppFolio/QuickBooks from this cloud task. Vendor SMS must remain
in preview mode. Do not request or copy local secrets or unrelated scratch
listing files into the cloud task. Use isolated test fixtures. If an external
service is unavailable, finish code and migrations and report the exact
remaining integration check.

Run the repository's required build/checks and meaningful tests for template
versioning, performed dates/Pacific boundaries, partial work, duplicate and
concurrent billing, price/package overlap, role isolation, credits/voids, and
existing AppFolio reconciliation. Validate the phone and office layouts at
their intended sizes when browser tooling is available. Document any checks
that cannot be run.

Return a reviewable diff or PR with the implemented scope, validation results,
remaining limitations, required migration/deployment steps, and rollout plan.
Do not describe unfinished features as implemented. Update the implementation
plan to reflect the actual completed work.
