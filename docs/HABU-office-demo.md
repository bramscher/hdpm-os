# HABU office routing demo

Open **Admin → HABU Demo** at `/admin/habu-demo`.

This review version is restricted to `craig@highdesertpm.com` with an admin
session. The page and reference-document endpoints enforce the same server-side
policy; other admins cannot open them. The navigation entry is also owner-only.
PDFs live outside `public` and are served with private, no-store responses.

The subway map groups the vacancy-tracking and new-tenant setup checklists into
stops. Selecting a stop reveals its demo owner, prerequisites, checklist, and next
stops. Completion records the simulated actor and local date/time. Scheduling
and listing can progress alongside the unit-turn route.

All names, addresses, work orders, notifications, and actions are examples.
State lasts only until refresh. This does not send messages or change AppFolio.
The two supplied blank PDF forms remain available as reference documents.

Source snapshot: `feature/habu-demo`. The same implementation is intended for
`main`. This office-routing demo is independent of the separate HABU core work.

Validation: `npm test -- lib/__tests__/habu-demo-access.test.ts` checks account
restrictions and direct PDF access, including unlisted filenames.
