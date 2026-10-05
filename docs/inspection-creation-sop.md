---
ontology: true
type: sop
domain: maintenance
summary: Weekly procedure for routine inspections, from the AppFolio candidate queue through route scheduling, Outlook publishing, tenant notices and close-out
status: active
tags: [inspections, routing, sop, appfolio, notices]
related: [inspection-notice-dispatch, inspection-notices-appfolio]
---

# SOP — Creating & Scheduling Routine Inspections

**Applies to:** HDPM-OS `/maintenance/inspections`
**Owner:** Maintenance coordinator
**Last updated:** 2026-10-05 (Notices v2)

## Purpose

Every occupied unit gets a routine inspection **every 6 months**, with the clock
anchored to the current tenant's **move-in date** — a new tenant resets the
clock. The system finds who is due, you turn the due list into scheduled
day-routes, tenants get 7+ days' written notice logged in AppFolio, and
completing an inspection automatically queues the next one.

## The cadence rules (what the system does for you)

- **Next due date** = the later of (tenant move-in, last inspection) **+ 6 months**.
- A unit becomes **Ready to schedule** when its due date is within **21 days** (or overdue,
  or it has no move-in/inspection history at all).
- **Vacant units are deferred** — no tenant, no routine inspection.
- Units inspected within the last **90 days** show as "Recently inspected."
- Data syncs from AppFolio **automatically every morning** (~2:30 AM Pacific):
  properties, units, completed Inspection Detail records, and active tenants.
  The last inspection date is the newest completed visit date, unit-level date,
  or locally recorded completion. Draft/in-progress inspections do not count.
  Reports API credentials are required; a report failure stops the sync before
  candidate changes are written.
  Completions recorded in HDPM-OS never get overwritten by stale AppFolio dates.

## Weekly procedure

### 1. Review the candidate list

1. Sidebar → **Inspections** opens the **Inspection Queue**. A banner reading
   "N inspections need scheduling" means work is waiting; click **Review &
   schedule** (or the **AppFolio Candidates** button) to open **Inspection
   Candidates**.
2. If the data looks stale, click **Sync from AppFolio** (otherwise the nightly
   sync already ran).
3. Work the three groups (details in *Review before scheduling*, below):
   - **Ready to schedule** — the work queue: due within 21 days or overdue.
   - **Needs confirmation** — check the unit with **Open AppFolio unit**, fix
     it there, then **Refresh review**.
   - **Already handled / not due** — no action.
4. Housekeeping before scheduling:
   - **Dismiss** anything that should not be inspected (owner request, pending
     move-out, etc.). Dismissed units stay dismissed until someone clicks
     **Restore** — the sync will not resurrect them.
   - For a unit that should never get routine inspections, use **Exclude
     routine inspections**.
   - Units with **no coordinates** cannot be routed. Click **Batch Geocode** on
     the queue; fix any that still fail in AppFolio.

### 2. Schedule routes

1. On the Candidates page click **Schedule ready (N)**.
2. In **Schedule Verified Inspections**, set:
   - **Start date** / **End date** — 7–21 days out (hard rule; this is the
     tenant-notice lead time and the system rejects other dates).
   - **Assigned inspector** — dropdown of active staff, defaults to **Brody**.
   - **Max stops per day** (1–30, default 10).
   Every Ready unit is scheduled; you cannot hand-pick units here (use the
   Route Builder for that — see *Exception paths*).
3. Submit. The system then:
   - Creates one inspection per unit (15-minute stops, due date from the
     6-month cadence). If a follow-up inspection was already auto-queued from a
     previous completion, it is reused — no duplicates.
   - Groups stops by proximity into **day routes** across your date range,
     ordered by Google Directions (straight-line estimate if Google fails),
     starting from the office at 1515 SW Reindeer Ave, Redmond.
   - Marks each unit **Scheduled** so it drops out of Ready to schedule.
4. Check the result message for **excluded** units (usually geocoding) and
   resolve or reschedule them.

### 3. Check and publish each route

1. Sidebar → **Route Builder**, open each new route.
2. Check the stop order and arrival times. Routes start at **8:00 AM** unless
   changed: edit the start time and click **Save start time**. Click
   **Recalculate Route & Times** if anything changed (only possible before any
   stop has started).
3. Click **Publish to Operations**. This creates an Outlook event on the
   Operations calendar (operations@highdesertpm.com) with **Brody as a required
   attendee** and Operations optional, and a 30-minute reminder. The event
   doubles as the route sheet: stop-by-stop ETAs, tenant names, all
   financially responsible occupants, recorded pets, owner, an Apple Maps link
   per stop, and one-tap "Open Full Route in Apple Maps / Google Maps" links
   (multi-stop directions starting from the office).
4. Click **Dispatch**. This only sets the route's status; it sends nothing.

The route detail schedule and newly created calendar events include household
details from the last candidate sync. Financial responsibility comes from
AppFolio's `TenantType`, independently of the primary notice contact. Pets are
collected from active occupants, with identical records shown once. “None
recorded” means AppFolio returned an empty list; “Not available” means the data
has not been synced or was not provided. After syncing, open each previously
published route and choose **Republish to Outlook** to refresh its event
description with the latest occupants and pets. This updates the linked event
without creating a duplicate or changing its attendees or start/end times.
Older personal-calendar events must be republished by their original
publisher.

Deployment prerequisite: apply `20260928_inspection_household.sql` before
deploying the household display, then run **Sync from AppFolio** to populate
existing inspection properties (including already scheduled candidates).

### 4. Send tenant notices (required, logged in AppFolio)

All tenant correspondence must live in AppFolio, and AppFolio has no send API,
so notices are sent from AppFolio. HDPM-OS prepares everything per **route**
(one date and one arrival window, e.g. "between 8:30 AM and 1:00 PM").

1. On the Inspection Queue click **Send Notices**. Each route shows its date,
   arrival window and units, with each unit's estimated arrival and who to
   tick in AppFolio (financially responsible occupants from the last sync).
2. Click **Re-check tenants**. It pulls current tenants from AppFolio and warns
   about a tenant who changed since scheduling, a move-out on or before the
   visit, a vacant unit, or no email. Resolve warnings before sending.
3. Click **Open Inspection Letter in AppFolio** (template 197). Paste the
   date with **Copy date** (it includes the arrival window), search each unit
   with **Copy address**, tick the people listed for it, and send. **Copy
   message** and **Copy emails** are there if you need them.
   - *Once Realm-X is on the AppFolio plan:* set `NEXT_PUBLIC_REALMX_ENABLED=1`
     in Vercel. A **Copy Realm-X request** button appears; paste it into
     Realm-X Assistant, which drafts the email to each unit's current tenants
     for you to check and send.
4. Tick the units you sent and click **Mark selected sent**. HDPM-OS records
   who marked it and warns if it was less than 7 days before the visit.
5. Units with no email need a phone call or posted notice — handle manually,
   then mark them sent.

**Date changed:** units whose route moved after their notice went out return
here with a **Date changed (was …)** badge, and the notice text becomes an
"Updated" notice. Send it the same way.

**Dez (optional):** with `DEZ_INSPECTION_NOTICES=1`, Brody also gets a Slack
card per route with the date line, who to tick, and a **Mark all sent** button
(plus the Realm-X request once Realm-X is enabled).

### 5. Run the route & complete inspections

1. The inspector opens the route's page in Route Builder (map, **Route
   Timeline**, and buttons per stop).
2. For each stop: **Start Inspection**, add notes if needed (**Add inspection
   notes...**), then **Complete** — or **Flag Issue**, which completes the stop
   and records a medium-severity flag. Bulk **Change Status… → Completed** on
   the queue does the same completion.
3. Completion automatically:
   - Stamps the unit's last-inspected date and pushes its next due date out
     6 months (unit shows "Recently inspected").
   - **Pre-creates the next routine inspection** 6 months out, carrying the
     tenant contact forward. You never have to remember to re-add a unit — it
     reappears as Ready ~21 days before it's due.
   - Closes the route once every stop is completed or skipped.

> **Note:** completions are **not** written back to AppFolio (write API not
> purchased). HDPM-OS is the source of truth for inspection cadence; AppFolio's
> Last Inspected date will lag.

## Exception paths

- **No access / tenant not home:** click **Skip** on the stop. The inspection
  returns to the queue for a later route. The app records no reason, so put it
  in the stop notes.
- **Visit date passed, stop unfinished:** it shows as **Past appointment**
  (needs review). Complete it or Skip it.
- **Route needs a different day:** on the route page set **Route date** and
  click **Change date** (7–21 days out; not once a stop has started). Arrival
  times, the inspections and the Outlook event move with it, and tenants
  already noticed come back to **Send Notices** as **Date changed**.
- **Whole day cancelled:** Route Builder calendar → **Clear all routes for this
  day**.
- **Start time changes:** edit it, **Save start time**, then **Republish to
  Outlook**. If notices already went out, the arrival window in them is now
  wrong — call or message the affected tenants.
- **Urgent unit for an existing route:** not supported. Rebuild the route, or
  schedule the unit on its own route at least 7 days out.
- **Inspection should not happen:** select it on the queue and use **Change
  Status… → Canceled**; use **Exclude routine** for units that should never get
  routine inspections.
- **Ad-hoc route from the queue:** Route Builder → **Schedule Route** →
  **Pick Properties** (or **Auto-select** with the stops slider) builds a route
  directly from queued inspections (same engine, same 7–21 day rule).
  Units that aren't **Ready to schedule** show greyed out with the reason;
  resolve them on the Candidates page first.
- **Backfill / historical data:** **Import XLSX** (Import Inspections)
  validates rows and creates inspections in bulk. Legacy, one-off loads only.
- **Un-dismissing a unit:** click **Restore** on it; it reclassifies on the
  next sync.

## Known limitations

- AppFolio's **"Use Custom Inspection Date"** checkbox is invisible to the API;
  units using it can show a stale last-inspected date until reconciled via the
  web-app audit / CSV cross-check.
- Notices are a **manual bridge** into AppFolio — sending and marking sent are
  two separate human steps; skipping the second leaves notices perpetually
  "due."
- **Flag Issue** does not create a work order, and there are no photos or
  inspection reports in HDPM-OS.
- No **reorder stops**, **remove one stop**, or **add a stop**
  buttons yet (some exist in the API only).
- Units that fail geocoding sit out of routing until the address is fixed.

Scheduling and notice window: create or move routes only 7–21 calendar days ahead (Pacific time). Scheduling alerts exclude later due dates, even before the nightly sync refreshes stored eligibility. Tenant notice lists and notice cards include appointments only through day 21. Existing later appointments remain visible in route history and enter the notice window automatically.


## Review before scheduling

The Candidates page now separates **Ready to schedule**, **Already handled / not due**, and **Needs confirmation**. Only Ready candidates contribute to scheduling alerts and can be added to automatic routes. Due dates use the later of the current tenant’s move-in date or last inspection, plus six calendar months, and the 21-day scheduling window still applies. AppFolio’s Unit Inspection report Last Inspection Date is trusted for scheduling even when the individual inspection status remains New or In Progress. Newer local completions are preserved.

Each row shows both date anchors, the calculated due date, and its review reason. Missing current unit IDs, stale tenant records, open AppFolio records newer than the trusted last date, and unresolved local completions are held for confirmation. Open statuses alone do not establish an inspection date, and trusting the Unit Inspection report does not change those statuses. Invalid or future last dates still need correction. Confirmation counts are records, and multiple records can refer to the same unit.

Open the AppFolio unit to check the visit and correct its status/date there. Use **Sync from AppFolio** after tenant or move-in changes, then **Refresh review** to reread inspection evidence. The app reads this evidence without changing AppFolio records. If verification is unavailable, unverified candidates remain in Needs confirmation and scheduling is blocked. Inspection evidence is cached for at most five minutes for display; route creation performs a fresh check.
