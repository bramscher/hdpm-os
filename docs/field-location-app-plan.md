---
ontology: true
type: plan
domain: maintenance
status: draft
summary: Phase 2 of field time and recovery — a company-iPhone location app that records where techs spend paid time, matches stops to work orders and Lowe's/Home Depot runs, and lists unbilled time in Daily Billing Review
tags: [field-location-app, gps-timekeeping, iphone-app, company-phones, unbilled-time, parts-runs, daily-billing-review, billing-recovery]
related: [field-time-recovery-plan, gps-timekeeping-plan, daily-billing-review]
relatedTo: [field-time-recovery-plan, gps-timekeeping-plan]
discovered: 2026-10-15
---

# Field location app plan

Date: October 15, 2026. Status: draft for Craig's review. No code yet.

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
- **Brody's** gap is overstated. His re-keys are flat-priced (13 in these two periods, now marked flat, so they carry no hours), and part of his day is property-management and turnover work that never goes on a maintenance invoice. The app needs a "PM / office work" category so his maintenance time can be separated out.

## What the app answers each day

For each tech, each day: **where did the paid hours go, and what didn't get billed?**

| Time | Comes from | Billing question it raises |
| --- | --- | --- |
| On site at a work order | Stop within the property's radius, while that WO is open and assigned to the tech | On-site 2.5 h, invoice bills 1 h? Is there an invoice at all? |
| Parts run for a job | Stop at Lowe's or Home Depot between two visits to the same job | Is there a materials line? A receipt? A parts-run charge (once the policy is set)? |
| General shopping / van stock | Store stop not tied to a job | Overhead; visible, not billed |
| Driving | Moving between stops | Overhead today; feeds the parts-run/travel decision |
| Shop / office | Stop at the shop or office | Overhead, or Brody's PM work |
| On-call callout | Home → property → home during an after-hours callout | Billed at the after-hours rate ($142.50)? |
| Unknown | Stops that match nothing | The tech labels it at end of day |

Location is evidence, not a bill. Nothing is invoiced automatically. A person still decides what is charged, as today.

## A tech's day with the app

1. **Clock in** (existing Timekeeping). This starts location recording. A banner on the phone shows recording is on.
2. **Work normally.** No tapping. The phone notes arrivals and departures in the background.
3. **Arrival at a job:** a quiet notification asks "At Cedar Creek 409, WO 43343?" One tap confirms, or they can answer later. Ignored suggestions wait for the end-of-day review; they're never silently accepted.
4. **Lowe's or Home Depot:** "Parts for Cedar Creek 409?" with buttons for that job, another job, or "Van stock / general." If parts were bought for a job, they snap the receipt. That covers phase 1's receipt rule without a separate app.
5. **End of day:** a short timeline: jobs, store stops, drives, gaps. Fix anything wrong, add notes, then **clock out**. This stops recording. The confirmed timeline becomes the day's work log, the entries the Daily Billing Review has always expected but never received.

## Company phones and on-call

- **Recording only while clocked in.** Phones stay at work overnight, so off-hours tracking mostly can't happen anyway. When a phone goes home on an on-call night, recording is **off** until the tech clocks in to a callout.
- **Callouts:** clocking in to a callout records the drive from home, time on site and the drive back. That's the evidence for the after-hours charge. On-call nights with no callout record nothing.
- **Distribution:** if the phones are in Apple Business Manager with a device-management service (Jamf, Kandji, Mosyle or similar), the app can be pushed straight to them, with "Always" location access pre-approved. No App Store, and techs can't switch it off. If not, TestFlight works for a pilot; MDM can come later.
- **Missing data is a question, not a verdict.** A dead phone or a gap in recording creates an "unknown" block for the tech to explain. It is never treated as unpaid time or a deduction.

## Matching rules

All 1,871 properties already have coordinates (`inspection_properties`), and every HDMS work order carries `property_address`. Suppliers need a short list of their own.

| Rule | Detail |
| --- | --- |
| Property stop | Within ~120 m of the property, for at least 5 minutes. Tune on real phones during the pilot |
| Which job | The open work orders at that property assigned to the tech that day. If more than one, the tech picks; GPS can't tell units apart |
| Supplier stop | Bend/Redmond/Prineville Lowe's and Home Depot, plus the Lowe's Pro desk, entered once in a `work_location` list with radius |
| Parts run for a job | Store stop between two visits to the same job: **suggested** as that job's parts run; the tech confirms |
| Shop / office | The shop and office addresses |
| Drive | Time between stops. Belongs to the next job only once the parts-run/travel policy says so |

## In Daily Billing Review

A new **Unbilled time** list, one row per tech per day, alongside the timecard columns from PR #186:

- **On-site time without enough billing:** "Alberto, Oct 7, Weinberger 284: on site 3 h 10 m, invoice HDMS-INV-000480 bills 2 h" → open invoice / mark covered (flat price, warranty, not billable).
- **Job with no invoice:** on-site time at a work order with no linked invoice.
- **Parts run with no materials line or receipt.**
- **Unlabeled time:** gaps and unknown stops the tech didn't explain.
- **Callout** time not billed at the after-hours rate.

Each row can be resolved with a reason (the existing "Record follow-up / decision" control). The office sees job time and stops, **not** a map of the tech's movements. Craig sees the full timeline.

## Privacy and access

- Recording runs only while clocked in (including callouts), and the phone shows when it's on.
- The tech sees and corrects their own timeline.
- Office billing reviewers see job-linked time, not raw location history or breaks.
- Craig (admin) sees the full timeline and the payroll comparison.
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
| 0. Decide | Answer the open questions below; confirm the phones' MDM status, iOS versions, Apple developer account | Answers recorded here |
| 1. Server + review page | Tables, supplier list, matching rules as one tested function, the Unbilled time list in Daily Billing Review. Test with hand-entered sample days | Sample day shows correct job time, parts runs and unbilled rows |
| 2. iPhone app pilot | Clock-in/out recording, arrival suggestions, store prompt with receipt photo, end-of-day timeline. Alberto and Brody, **suggestion-only, two weeks** | Battery lasts a full day; most arrivals matched correctly; techs spend < 5 min a day confirming |
| 3. Billing follow-through | Unbilled rows link straight to "prepare invoice" with the confirmed time and receipts pre-filled | Same-day draft invoices for most jobs |
| 4. Trip charges | Once the parts-run/travel policy is set, apply it from confirmed parts runs | Policy decided |

Step 1 can start without the app or any decisions on charging. Step 2 needs the device answers.

## Measures

The baseline is the table above. The pilot target, to confirm after the first two weeks:

- **Alberto's "not on an hourly invoice line" hours** split into billable-missed vs overhead (drive, shopping, shop). The first win is knowing the split.
- **Billable hours found and invoiced** that would otherwise have been missed, in hours and dollars per pay period.
- **Drive + shopping hours** per tech per day, as the input for the parts-run decision and for cutting runs (parts check the night before, van stock).
- **Callouts** billed at the after-hours rate.

## Open questions

1. **Phones:** are they in Apple Business Manager / an MDM? Which iPhone models and iOS versions? Is there an Apple developer account?
2. **Brody's time:** which of Brody's hours are maintenance and which are property management or turnover? Should the app track him only on maintenance jobs, or track the whole day with a PM category?
3. **Callouts:** do techs already clock in for on-call callouts in Timekeeping? If not, the app adds a "Start callout" button that does.
4. **Parts-run / travel charge:** still open from October 2 (options A–D in the field-time plan). The pilot measures the time at stake first.
5. **Who works the Unbilled time list:** Penny and Brody today, moving to the Maintenance Coordinator Assistant once hired, as with charge approval?
6. **Supplier list:** which stores do they actually use (Lowe's Bend/Redmond, Home Depot Bend, Pro desk, others like Parr Lumber or plumbing supply)?
