# Vacancy routing review

Owner-only route: /admin/habu-paper/workflows. Linked from the form library and earlier paper demo.

This review uses fictional properties and temporary React state. It does not assign work to real staff, send messages, write AppFolio records, or retain edits after reload. Role preview and assignment/date controls are review tools available to Craig, not production permission rules.

## Confirmed operating rules

- Front Desk starts vacancy intake.
- Assign to roles now: Front Desk, Property Manager, Maintenance, Accounting. Later map roles to groups and named people.
- Actual key return is Day 0. The following day is Day 1.
- Standard property readiness is due at the end of Day 10, counting weekends and holidays.
- Longer targets require a major remodel, reason, and revised target.

## Proposed review behavior

- My Work includes Ready, Coming Soon, and Waiting with follow-up dates.
- Sort urgent, high, normal; within each priority, overdue then earliest due.
- A row opens the shared gold sheet with a persistent route rail and highlighted assignment fields. Whole sheet and selected-section views use the same values.
- Required checks and fields gate handoff. N/A requires a reason. Completion records role/time; a production record will use the authenticated person's identity.
- Notice releases owner preparation and key receipt independently. Owner preparation releases advertising. Keys release inspection and accounting. Inspection releases maintenance, then maintenance releases verification.
- Suggested milestones for review: inspection Day 1, turn work Day 8, verification Day 10. Applying dates previews the affected open assignments; completed due dates and accounting dates stay unchanged.
- Accounting uses a separately entered deadline. Day 10 is the property-ready target, not an accounting or legal deadline.
- New runs start blank; three sample runs demonstrate ready, upcoming, waiting and overdue work.

## Before a staff pilot

Persist versioned runs and assignments; bind roles to authenticated users; enforce permissions server-side; record actor identity and server timestamps; make handoff transactions idempotent; add concurrency handling and durable history. Add notifications only after in-app assignments and deadline rules are approved. Confirm intermediate milestone defaults and accounting deadlines with the team.

## Validation

Date tests cover holidays/year end, weekends and DST, and reject invalid dates. Routing tests cover parallel release, blocked prerequisites, duplicate handoff, unfinished work orders, role consolidation, ordering and overdue/at-risk labels. Existing paper workflow and owner access tests remain applicable.
