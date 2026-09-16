# Timekeeping setup and first pilot

Entry point: **Company → Timekeeping** (`/timekeeping`). Source branch: `feature/timekeeping`.

## Database and deployment

1. Apply [20260915_timekeeping.sql](../supabase/migrations/20260915_timekeeping.sql) to a **test Supabase project** first. Per this repository's [migration convention](../supabase/migrations/README.md), Craig applies migrations manually in the Supabase SQL Editor. The migration is safe to replay and does not enroll or seed actual employees.
2. Run the branch against that test project's Supabase URL/service-role key and the app's existing Microsoft sign-in configuration. Keep service-role keys server-side. Required app secrets are already documented in the README.
3. Ensure `CRON_SECRET` is configured. `/api/timekeeping/cron` checks its bearer token. The daily Vercel schedule is `10 8 * * *` UTC; on-open generation also covers missed runs. Tables absent → setup message; no local mock fallback in the app.
4. Complete the fictional/account pilot below, then apply the same migration to production before deploying this branch's application changes. Main auto-deploys on Vercel, so coordinate that merge with database setup.

Craig applied the database migration on September 15, 2026. The six empty tables, employee signature columns and guarded command function were verified before merging to main. Staff still need enrollment. The temporary local test harness is outside the repository and is not part of the deployed app.

Roster exclusions are configured using `TIMEKEEPING_EXCLUDED_STAFF` (exact `staff.person` keys). Excluded profiles are omitted from setup and cannot enter time; retained historical sheets/exports remain available to administrators. This does not deactivate their company-wide staff accounts.

## Automatic first-visit setup

Apply [20260915_timekeeping_auto_enroll.sql](../supabase/migrations/20260915_timekeeping_auto_enroll.sql) after the base migration. Production uses `TIMEKEEPING_DEFAULT_MANAGER=Craig`.

Eligible active company accounts enroll automatically on their first Timekeeping visit, with Craig as reviewer and participation starting that day. Employees choose their usual workdays, start/end and breaks in **My defaults**. New employees start as Hourly. Cheryl Waterman is the sole configured Salary employee, with Craig as reviewer; all employees still record time. An admin can change pay basis when needed. First-visit setup never overwrites an already configured or ended enrollment. Craig is a reviewer and payroll administrator only: no personal time entry, schedule, payroll enrollment or generated timesheets. He remains available as the approving manager; no self-approval is allowed.

Jennifer Bertran (`Jen`), Jayme, Bryce Bramscher and Bianca Nyseth are excluded from timekeeping. On September 15, 2026, Craig confirmed that Jen, Jayme and Bianca had left the company: their directory profiles were deactivated, their app access blocked, and active responsibilities transferred to Craig. Historical records remain intact. Bryce's company access is unchanged. Before the additive SQL is applied, the existing manual setup screen remains available.

## Administrator schedule editing

Apply [20260915_timekeeping_admin_schedule.sql](../supabase/migrations/20260915_timekeeping_admin_schedule.sql) once in Supabase SQL Editor to enable admin edits to employee schedule defaults. The private function requires a live admin identity, checks the employee version and records before/after changes under the admin's identity. It does not change existing timesheets. Craig applied this migration on September 15, 2026; its identity guard was verified after installation.

In **People & defaults**, expand an employee to edit their usual week and choose **Save employee defaults**. Future pay periods fill automatically. To refresh an existing draft or returned sheet, open it in **Review** and use **Apply defaults to untouched days**. Explicit days off and recorded work remain protected; empty unfinished days can be filled even if they were previously cleared.

## Admin setup and overrides

- Sign in as a staff member whose current directory `access_role` is `admin`.
- Open **People & defaults**. Active staff-directory accounts appear as **Not enrolled** until you configure them.
- Set payroll ID, Hourly or Salary, first participating day and a distinct approving manager. Enroll only intended pilot participants. Managers do not need their own payroll enrollment to review assigned staff.
- Each employee opens **My defaults**, selects weekdays and their usual hours, and reviews break defaults. New settings start at **7:00 AM–4:30 PM**, with **12:00–1:00 PM unpaid lunch** and **two separate 10-minute paid rest breaks**. Each employee can stagger their lunch window; saved schedules are preserved. Lunch start/end calculate the unpaid minutes. Default time choices use 15-minute steps and AM/PM; daily exceptions also allow exact minutes. Save, then use **Apply defaults to untouched days** on the initial sheet.
- Every newly generated pay period automatically fills from the employee’s saved schedule, or the company 7:00 AM–4:30 PM / noon–1:00 PM lunch defaults if no personal schedule has been saved. Employees and admins can use **Apply defaults to untouched days** on draft/returned sheets. An admin applies the selected employee’s schedule, with the action recorded under the admin’s identity. Refreshing a draft preserves existing exceptions, notes, miles, leave and recorded clock time. The first/last participating dates still limit which days are filled.

## Staff rollout

Share `https://hdpmchat.highdesertpm.com/timekeeping` with staff and ask them to sign in with their company Microsoft account. Eligible employees enroll on their first visit with Craig as reviewer. Cheryl is configured as Salary; new employees default to Hourly.

Craig opens directly to **Review** and is omitted from employee setup and payroll employee lists.

On September 15, 2026, Craig authorized all seven current employees to participate from **September 1** for retroactive entry. Existing recorded time and exceptions were preserved when applying each schedule to the first period. Later new hires still use their actual first participating date.

Employees save **My defaults**, apply them to untouched days, and record actual work, breaks, leave, mileage and notes. These are live timesheets. Employees sign and submit at period-end for manager review.

The fictional employee preview was retired for staff rollout. Its menu link and pilot access were removed; existing `/timekeeping/preview` bookmarks redirect to `/timekeeping`. Fictional fixtures remain in automated tests only.

## First workflow to pass around

Use designated test accounts in the test environment: one salary employee, a separate reviewer and an admin. Use a completed pay period so signature and approval can be exercised immediately. Do not enroll fictional identities in the production staff directory.

| Person | Test action | Expected result |
| --- | --- | --- |
| Employee | Defaults: Monday–Friday, 7:00 AM–4:30 PM, unpaid lunch 12:00–1:00 PM, paid breaks 20 minutes | Each scheduled day has 8.5 worked hours to confirm; paid breaks are included |
| Employee | Replace one day with four hours work + four hours vacation | Work and vacation remain separate; default work removed |
| Employee | Add 12.5 miles and a daily note; add a pay-period note; reload | All values remain saved |
| Employee | Confirm no work on off days, check certification, Sign & submit | Microsoft account identity, timestamp and signed version recorded; sheet locked |
| Reviewer | Open submitted detail, return with reason | Employee receives one active returned sheet and must sign again |
| Employee, then reviewer | Correct, sign again, approve | Separate employee and manager timestamps visible |
| Admin | Export the completed period | Excel has SALARY, work/leave/miles totals, notes, employee signature and manager approval |
| Admin | Reopen, correct, have employee re-sign and manager reapprove; export again | Version 2 created; version 1 remains unchanged |
| Employee | In the next/current period, clock in, start/end a break, clock out | Actual shift replaces scheduled placeholder and stays saved |

Send the **test-environment link** plus each person's row above through your normal team channel. No automated team messages or payroll email are sent by this feature.

## Running checks

```sh
npm test
npm run test:timekeeping:db
npm run build -- --webpack
```

Database tests use PGlite (local PostgreSQL in memory) with fictional staff. No external database credentials are needed for those tests. A production build may require network access for the project's existing Google Fonts.

## Breaks and daily exceptions

Lunch windows are draft schedule entries, confirmed by the employee at submission. Changing a daily lunch updates its unpaid duration. Paid rest breaks stay included in worked hours. For the starting 7:00 AM–4:30 PM schedule, a one-hour unpaid lunch leaves **8.5 paid hours**. The suggested paid rest allowance uses the [Oregon BOLI adult non-exempt baseline](https://www.oregon.gov/boli/workers/pages/meals-and-breaks.aspx); company lunch defaults are one hour. Employees must correct any interrupted/working lunch rather than deduct it. Custom break settings are available.

Every calendar day can record work, including weekends. Emergency work and emergency phone management flags appear in daily details and payroll summary day counts; record actual time in work intervals and context in notes. Flags do not calculate premium pay. New leave entries offer Vacation, Sick, and Holiday on any calendar day. Holiday hours appear separately in the Excel Summary and Daily detail tabs and are included in the sheet’s leave total. Selecting Holiday asks for hours and replaces scheduled work after confirmation; manually recorded work is preserved, allowing partial holiday leave plus actual work. Put LOA in comments; historical LOA entries and their exports are retained.

## Routine use

Employees review their one active sheet and can sign on the final calendar day of the pay period using their planned departure time, even before that time arrives (Pacific time). Saved defaults or manually entered hours are accepted; a running clock must be stopped before submission. The employee signature locks the sheet for manager review, and manager approval is still required for payroll export. If actual hours change, return or reopen the sheet for correction and a new employee signature. Unfinished prior sheets stay active until submitted. Managers use **Review**; admins use **Payroll & history** to select a period, review details and download saved Excel packages.

Employees open **My history** to choose a submitted pay period and see **Awaiting approval**, **Approved**, or **Returned for correction**. Hours, leave, mileage, notes, signatures and approval history are read-only there. **Refresh status** loads the latest review result; returned sheets link back to **My time** for correction and a new signature. Each employee can access only their own personal history.

The Excel package contains hours and miles for payroll to process. Download it, save it and email it manually. Use the latest version for any correction and retain the previously sent package for comparison.

**Review** and **Payroll & history** show one pay period at a time. Choose a period from the date selector or use the previous/next buttons. The initial view opens the oldest unfinished ended period, then the current period when prior payroll is approved. Status counts cover everyone in the selected period; the employee filter narrows the table. Opening a sheet and returning keeps that period selected. Saved Excel packages and new exports use the selected period, and the export button becomes available once its sheets are approved.

Before deactivating a departing employee, finish their time entries, signature and manager approval. Set their last participating day and end enrollment; admins retain historical access. A reopened former-employee record cannot be finalized with an administrator pretending to be the employee.
