---
ontology: true
type: plan
domain: maintenance
status: active
summary: Phase 2 of field time and recovery — a company-iPhone location app that records where techs spend paid time, matches stops to work orders and Lowe's/Home Depot runs, and lists unbilled time in Daily Billing Review. Step 1 (server, review screens, sample days) built October 2026
tags: [field-location-app, gps-timekeeping, iphone-app, company-phones, unbilled-time, parts-runs, dump-runs, stop-locations, daily-billing-review, billing-recovery]
related: [field-time-recovery-plan, gps-timekeeping-plan, daily-billing-review]
relatedTo: [field-time-recovery-plan, gps-timekeeping-plan]
discovered: 2026-10-15
---

# Field location app plan

Date: October 15, 2026. Status: decisions answered by Craig on October 15 (see *Decisions*). **Step 1 is built** (see *Step 1: what was built*); step 2 (the iPhone app) is next.

This is the build plan for **phase 2** of [`field-time-recovery-plan.md`](field-time-recovery-plan.md). It keeps the architecture, privacy and test scenarios in [`gps-timekeeping-plan.md`](gps-timekeeping-plan.md) and changes three things:

1. **GPS moves first.** The October 2 plan said to build the manual phone workflow (phase 1) first and add GPS only if needed. Phase 1 was never built, and the work log has **zero entries** to date. Asking techs to log time by hand isn't happening. Recording location while they're on the clock, and asking them only to confirm, gets the data without that habit.
2. **The gap is now measured.** See the baseline below.
3. **Company phones** stay at work unless the tech is on call (Craig, October 15). That shapes tracking and distribution.

## The problem, in numbers

Timecard hours vs hours on issued and draft hourly invoice lines, from the Daily Billing Review timecard comparison (PR #186):

| Pay period | Tech | Timecard | Billed hourly | Not on an hourly invoice line |
| --- | --- | ---: | ---: | ---: |
| Sep 16–30 | Alberto | 80.5 h | 42.75 h | 37.8 h |
| Sep 16–30 | Brody | 92.4 h | 3 h | 89.4 h |
| Oct 1–15 | Alberto | 57.0 h | 33.25 h | 23.8 h |
| Oct 1–15 | Brody | 79.6 h | 1.5 h | 78.1 h |

- **Alberto** is the clean signal: **24–38 hours per pay period** are paid but don't appear as billed hours. That's roughly $2,300–3,600 at $95/h if all of it were billable. It isn't: some is drive time, shopping and shop work. The app's job is to show how much is which.
- **Brody's** gap is overstated. His re-keys are flat-priced (13 in these two periods, now marked flat, so they carry no hours), and he does **all the inspections**, which never go on a maintenance invoice. The app tracks his whole day and labels inspection stops separately, so his maintenance time stands on its own and inspection time per property becomes visible for the first time.

## What the app answers each day

For each tech, each day: **where did the paid hours go, and what didn't get billed?**

| Time | Comes from | Billing question it raises |
| --- | --- | --- |
| On site at a work order | Stop within the property's radius, while that WO is open and assigned to the tech | On-site 2.5 h, invoice bills 1 h? Is there an invoice at all? |
| Parts run for jobs | Stop at Lowe's or Home Depot; the tech says which jobs the parts were for | Is there a materials line and a receipt? Is the job's share of the run's time on the invoice? |
| Inspection | Stop at a property on Brody's inspection route that day | Not billed as maintenance; shows inspection time per property |
| General shopping / van stock | Store stop not tied to a job | Overhead; visible, not billed |
| Driving | Moving between stops | Drive to and from a store on a parts run is part of that run; other driving is overhead |
| Shop / office | Stop at the shop or office | Overhead |
| On-call callout | Home → property → home during an after-hours callout | Billed at the after-hours rate ($142.50)? |
| Unknown | Stops that match nothing | The tech labels it at end of day |

Location is evidence, not a bill. Nothing is invoiced automatically. A person still decides what is charged, as today.

## A tech's day with the app

1. **Clock in** (existing Timekeeping). This starts location recording. A banner on the phone shows recording is on.
2. **Work normally.** No tapping. The phone notes arrivals and departures in the background.
3. **Arrival at a job:** a quiet notification asks "At Cedar Creek 409, WO 43343?" One tap confirms, or they can answer later. Ignored suggestions wait for the end-of-day review; they're never silently accepted.
4. **Lowe's or Home Depot:** "Parts for which jobs?" with today's jobs to tick (one or several), or "Van stock / general." They snap the receipt. That covers phase 1's receipt rule without a separate app.
5. **End of day:** a short timeline: jobs, store stops, drives, gaps. Fix anything wrong, add notes, then **clock out**. This stops recording. The confirmed timeline becomes the day's work log, the entries the Daily Billing Review has always expected but never received.

## Company phones and on-call

- **Recording only while clocked in.** Phones stay at work overnight, so off-hours tracking mostly can't happen anyway. When a phone goes home on an on-call night, recording is **off** until the tech clocks in to a callout.
- **Callouts:** techs don't clock in for callouts today. The app adds a **Start callout** button that clocks them in to Timekeeping and starts recording: the drive from home, time on site and the drive back. That's the evidence for the after-hours charge, and it puts callout hours on the timecard where they belong. On-call nights with no callout record nothing.
- **Distribution:** the phones are in **Apple Business Manager and Mosyle**. The app is pushed through Mosyle as a custom (unlisted) app, with "Always" location access pre-approved by a configuration profile. No App Store listing, no TestFlight, and techs can't switch it off.
- **Missing data is a question, not a verdict.** A dead phone or a gap in recording creates an "unknown" block for the tech to explain. It is never treated as unpaid time or a deduction.

## Matching rules

All 1,871 properties already have coordinates (`inspection_properties`), and every HDMS work order carries `property_address`. Suppliers need a short list of their own.

| Rule | Detail |
| --- | --- |
| Property stop | Within ~120 m of the property, for at least 5 minutes. Tune on real phones during the pilot |
| Which job | The open work orders at that property assigned to the tech that day. If more than one, the tech picks; GPS can't tell units apart |
| Supplier stop | **Lowe's and Home Depot in Redmond**, sometimes **Bend**: four stores entered once in a `work_location` list with radius. More can be added in a settings screen |
| Parts run | Drive to the store + time in the store + drive back to the next job. The tech ticks which jobs the parts were for |
| Inspection stop | A property on Brody's inspection route for that day (the inspection scheduler already knows the route) |
| Shop / office | The shop and office addresses |
| Drive | Time between stops. Part of a parts run if it's to or from a store; otherwise overhead |

## In Daily Billing Review

A new **Unbilled time** list, one row per tech per day, alongside the timecard columns from PR #186:

- **On-site time without enough billing:** "Alberto, Oct 7, Weinberger 284: on site 3 h 10 m, invoice HDMS-INV-000480 bills 2 h" → open invoice / mark covered (flat price, warranty, not billable).
- **Job with no invoice:** on-site time at a work order with no linked invoice.
- **Parts run not on the invoices:** the job's share of the run's time, its materials line or its receipt is missing.
- **Unlabeled time:** gaps and unknown stops the tech didn't explain.
- **Callout** time not billed at the after-hours rate.
- **Inspection time** per property (Brody), for information; not billed.

Each row can be resolved with a reason (the existing "Record follow-up / decision" control). The office sees job time and stops, **not** a map of the tech's movements. Craig sees the full timeline.

## Privacy and access

- Recording runs only while clocked in (including callouts), and the phone shows when it's on.
- The tech sees and corrects their own timeline.
- Office billing reviewers see job-linked time, not raw location history or breaks.
- Craig (admin) sees the full timeline and the payroll comparison, and works the Unbilled time list until the Maintenance Coordinator Assistant is hired.
- Raw location points are deleted after **30 days**. Confirmed work entries are kept like any other billing record.
- Breaks pause recording.
- Brody and Alberto get a short written notice before the pilot: what's recorded, when, who sees it, how long it's kept.

## How it's built

Unchanged from `gps-timekeeping-plan.md` → *iPhone architecture* and *Data and integration plan*:

- **App:** a small native SwiftUI app using Core Location region monitoring, plus sampling while clocked in. It has an offline queue, and sign-in uses the company Microsoft account.
- **Server:** HDPM OS (Next.js + Supabase) keeps scheduling, review, invoices and reporting. The app never holds database credentials.
- **Data:** new tables `field_device`, `work_location`, `field_location_event` (raw, 30-day), `field_activity_segment` (suggested → confirmed). Confirmed segments write the existing `maintenance_work_record`. That way the Daily Billing Review's Project and Other columns fill in with no change to that page.
- **No second timecard.** Timekeeping stays the payroll record; location never edits it.

## Build sequence

| Step | What | Done when |
| --- | --- | --- |
| 0. Prep | Confirm iPhone models / iOS versions in Mosyle. Craig has an Apple Developer account: publish the app in App Store Connect as a **custom app** for the company's Apple Business organization ID, then assign it in Mosyle. Write the notice to Brody and Alberto | Notice sent; app can be pushed from Mosyle |
| 1. Server + review page **(built)** | Tables, supplier list, matching rules as one tested function, the Unbilled time list in Daily Billing Review. Test with hand-entered sample days | Sample day shows correct job time, parts runs and unbilled rows |
| 2. iPhone app pilot | Clock-in/out recording, arrival suggestions, store prompt with receipt photo, end-of-day timeline. Alberto and Brody, **suggestion-only, two weeks** | Battery lasts a full day; most arrivals matched correctly; techs spend < 5 min a day confirming |
| 3. Billing follow-through | Unbilled rows link straight to "prepare invoice" with the confirmed time and receipts pre-filled | Same-day draft invoices for most jobs |
| 4. Parts-run charges | Pre-fill each job's share of confirmed parts-run time as a labor line (see *Decisions*) | Parts-run time shows up on invoices, split across the jobs |

Step 1 can start now. Step 2 needs step 0.

## Measures

The baseline is the table above. The pilot target, to confirm after the first two weeks:

- **Alberto's "not on an hourly invoice line" hours** split into billable-missed vs overhead (drive, shopping, shop). The first win is knowing the split.
- **Billable hours found and invoiced** that would otherwise have been missed, in hours and dollars per pay period.
- **Parts-run hours billed** to jobs, and drive + shopping hours per tech per day, as the input for cutting runs (parts check the night before, van stock).
- **Inspection hours** per property and per route (Brody).
- **Callouts** billed at the after-hours rate.

## Decisions

Answered by Craig, October 15:

| # | Question | Decision |
| --- | --- | --- |
| 1 | Phone management | **Apple Business Manager + Mosyle.** Push the app as a custom app; pre-approve location |
| 2 | Brody's time | **Track his whole day, including inspections.** Inspection time is valuable on its own; it's labeled separately and not billed as maintenance |
| 3 | Callouts | Techs **don't clock in** for callouts today. The app adds **Start callout**, which clocks in and records |
| 4 | Parts-run / travel charge | **Charged as part of the job**, split among the jobs the parts were fetched for. The run's time (drive there, in store, drive back) is billed at the labor rate, divided across those jobs. Never charged twice; van stock and general shopping stay overhead. This settles decision 1 (option C-like, no cap) in the field-time plan |
| 5 | Who works the Unbilled time list | **Craig**, then the **Maintenance Coordinator Assistant** once hired |
| 6 | Stores | **Lowe's and Home Depot in Redmond**, sometimes **Bend** |
| 7 | How a parts run is split | **Evenly across the jobs, adjustable on review** (e.g. 70/30 when most parts were for one job) |
| 8 | Parts run vs the 1-hour minimum | **On top of the minimum**, in 15-minute increments, as part of the job's labor |
| 9 | Dump runs | **Flat fee per the runbook**, not measured hours. The dump trip is noted on the day and linked to the job(s) it served; one dump run may be charged to several jobs. Billing checks for a dump-run charge on each linked job |
| 10 | Other parts stores | **Ferguson, Parr Lumber and paint stores** count as parts runs, alongside Lowe's and Home Depot |
| 11 | Shop | **The shop is the office**, 1515 SW Reindeer Ave, Redmond |

## Step 1: what was built

Server side and review screens, testable with hand-entered sample days. Migration `supabase/migrations/20261029_field_time.sql`; logic in `lib/field-time/`.

- **Stop locations** (`/maintenance/daily-billing/locations`). Stores, dump sites and the shop, each with a match radius (store 200 m, dump 250 m, shop 150 m). Providers reuse the parts-order `supplier` list, so both Lowe's stores belong to Lowe's.
  - Seeded with: Lowe's and Home Depot in Redmond and Bend, Ferguson Bend, Parr Lumber Bend, Sherwin-Williams and Miller Paint in Redmond, Negus Transfer Station, Knott Landfill, and the shop.
  - Addresses are geocoded, or coordinates can be pasted. Admin edits locations; office edits providers. Locations are deactivated, never deleted.
- **Field day** (`/maintenance/daily-billing/field`). The day as a timeline:
  - jobs, parts runs (drive there, store, drive back), dump runs, inspections, shop, driving, unknown stops and no-signal gaps;
  - confirm, pick the job, split across jobs (even by default, adjustable), or say what a stop was.
  - Admin only: a sample-day editor (type the stops; the server turns them into GPS fixes and runs the same matching) and "Save as location" for an unknown stop.
- **Daily Billing Review.**
  - A Field time column and tile.
  - **"Field time vs billing"** items, per work order, from confirmed time only:
    - expected = on-site time with the 1-hour minimum, plus parts runs on top, in 15-minute steps;
    - this is compared with the hourly invoice lines;
    - flat-priced labor counts as covered, and dump-run lines are kept out of hours;
    - a dump run with no dump-run charge is flagged.
  - Sample days only show with **Show sample days** on.
- **Who sees what.**
  - The whole day: an admin, or the tech for their own day.
  - The review: anyone else sees only their own job and parts minutes. Both techs count as "office" elsewhere, so this checks admin or self, never office.
  - Segments never store coordinates.

Changes from the plan above, made while building:
- **No raw-points table yet.** Sample days are turned into points in memory. The points table, the phone upload endpoint and the 30-day purge ship together in step 2, so raw location never exists without its purge.
- **Confirmed time doesn't write `maintenance_work_record` yet.** Doing it now would put samples in the work log and double-count the existing work-record items. Decide in step 2.
- **Job suggestions are conservative.** A job is suggested only when exactly one candidate is the tech's own. Two of a tech's jobs at one property on the same day is real (Weinberger 284 on Oct 7 had 43280-2 and 43280-3), so the tech picks or splits. A parts run is pre-filled only for job A → store → job A.

Step 2 requirements this sets for the iPhone app:
- A location fix at least every 5 minutes while clocked in, with automatic pausing off, so "standing still" and "phone off" can be told apart.
- Upload the raw points.
- Use the same confirm API for arrival prompts and the end-of-day review.
