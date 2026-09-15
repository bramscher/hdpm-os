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

Eligible active company accounts enroll automatically on their first Timekeeping visit, with Craig as reviewer and participation starting that day. Employees choose their usual workdays, start/end and breaks in **My defaults**. New employees start as Hourly. Cheryl Waterman is the sole configured Salary employee, with Craig as reviewer; all employees still record time. An admin can change pay basis when needed. First-visit setup never overwrites an already configured or ended enrollment. Craig needs another assigned reviewer for his own time; no self-approval is allowed.

Jennifer Bertran (`Jen`), Jayme, Bryce Bramscher and Bianca Nyseth are excluded as non-employees through the timekeeping-only configuration. Company involvement/access is separate. Before the additive SQL is applied, the existing manual setup screen remains available.

## Admin setup and overrides

- Sign in as a staff member whose current directory `access_role` is `admin`.
- Open **People & defaults**. Active staff-directory accounts appear as **Not enrolled** until you configure them.
- Set payroll ID, Hourly or Salary, first participating day and a distinct approving manager. Enroll only intended pilot participants. Managers do not need their own payroll enrollment to review assigned staff.
- Each employee opens **My defaults**, selects weekdays and their usual hours, and reviews break defaults. New settings start at **7:00 AM–4:30 PM**, with **12:00–1:00 PM unpaid lunch** and **two separate 10-minute paid rest breaks**. Each employee can stagger their lunch window; saved schedules are preserved. Lunch start/end calculate the unpaid minutes. Default time choices use 15-minute steps and AM/PM; daily exceptions also allow exact minutes. Save, then use **Apply defaults to untouched days** on the initial sheet.
- Changes to defaults affect newly generated sheets. Refreshing a draft preserves existing exceptions, notes, miles, leave and recorded clock time.

## Preview the employee screens as an admin

Open **Company → Timekeeping → Employee preview**, or `/timekeeping/preview` while signed in as an admin. The preview uses the same employee screen components with fictional Taylor Example data. Only **My time** and **My defaults** appear within Timekeeping.

- **First visit**: choose usual workdays, hours and breaks, save, then apply defaults to the sheet.
- Open a weekend day, add work, flag **Emergency work** or **Emergency phone management**, and save notes. Use daily lunch start/end to try a shorter or later lunch.
- **Completed period**: review work, vacation, mileage and notes, then practice **Sign & submit to manager**.
- **Reset preview** starts over. All changes remain in memory in that tab; refresh discards them. No payroll data, real signature, employee enrollment or notifications are created. This demonstrates the employee UI, not a live Microsoft reauthentication or manager approval test.

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

Every calendar day can record work, including weekends. Emergency work and emergency phone management flags appear in daily details and payroll summary day counts; record actual time in work intervals and context in notes. Flags do not calculate premium pay. New leave entries offer Vacation and Sick. Put LOA in comments; historical LOA entries and their exports are retained.

## Routine use

Employees review their one active sheet and sign at period-end once their final shift finishes. Unfinished prior sheets stay active until submitted. Managers use **Review**; admins use **Payroll & history** to select a period, review details and download saved Excel packages.

The Excel package contains hours and miles for payroll to process. Download it, save it and email it manually. Use the latest version for any correction and retain the previously sent package for comparison.

Before deactivating a departing employee, finish their time entries, signature and manager approval. Set their last participating day and end enrollment; admins retain historical access. A reopened former-employee record cannot be finalized with an administrator pretending to be the employee.
