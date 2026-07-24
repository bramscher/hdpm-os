# SOP — Creating & Scheduling Routine Inspections

**Applies to:** HDPM-OS `/maintenance/inspections`
**Owner:** Maintenance coordinator
**Last updated:** 2026-07-24

## Purpose

Every occupied unit gets a routine inspection **every 6 months**, with the clock
anchored to the current tenant's **move-in date** — a new tenant resets the
clock. The system finds who is due, you turn the due list into scheduled
day-routes, tenants get 7+ days' written notice logged in AppFolio, and
completing an inspection automatically queues the next one.

## The cadence rules (what the system does for you)

- **Next due date** = the later of (tenant move-in, last inspection) **+ 6 months**.
- A unit becomes **Eligible** when its due date is within **45 days** (or overdue,
  or it has no move-in/inspection history at all).
- **Vacant units are deferred** — no tenant, no routine inspection.
- Units inspected within the last **90 days** show as "Recently inspected."
- Data syncs from AppFolio **automatically every morning** (~2:30 AM Pacific):
  properties, units (last-inspected date), and active tenants (move-in + email).
  Completions recorded in HDPM-OS never get overwritten by stale AppFolio dates.

## Weekly procedure

### 1. Review the candidate list

1. Go to **Maintenance → Inspections → Candidates**.
2. The **Eligible** tab is the work queue — these units are due within 45 days
   or overdue.
3. If the data looks stale, click **Sync from AppFolio** (otherwise the nightly
   sync already ran).
4. Housekeeping before scheduling:
   - **Dismiss** anything that should not be inspected (owner request, pending
     move-out, etc.). Dismissed units stay dismissed until manually restored —
     the sync will not resurrect them.
   - Units with **no coordinates** (geocode failed) cannot be routed — fix the
     address in AppFolio or flag for follow-up.

### 2. Schedule routes

1. On the Candidates page click **Schedule**.
2. Pick:
   - **Date range** — must start **at least 7 days out** (hard rule; this is the
     tenant-notice lead time and the system will reject earlier dates).
   - **Inspector** — dropdown of active staff, defaults to **Brody**.
   - **Max stops per route** (default 10).
   - Optionally hand-pick specific units; otherwise every eligible unit with
     coordinates is included.
3. Submit. The system then:
   - Creates one inspection per unit (30-minute stops, due date from the
     6-month cadence). If a follow-up inspection was already auto-queued from a
     previous completion, it is reused — no duplicates.
   - Groups stops by proximity into draft **day routes** across your date range
     (`Inspections → Routes` to view, reorder, optimize, or push to calendar).
   - **Push each route to calendar** (Routes page). This emails the inspector an
     Outlook invite that doubles as the route sheet: stop-by-stop ETAs, tenant
     names, an Apple Maps link per stop, and one-tap "Open Full Route in Apple
     Maps / Google Maps" buttons (multi-stop directions starting from the
     office). Craig is cc'd on every route.
   - Marks each unit **Scheduled** so it drops out of the Eligible tab.
4. Check the result message for **excluded** units (usually geocoding) and
   resolve or reschedule them.

### 3. Send tenant notices (required, logged in AppFolio)

All tenant correspondence must live in AppFolio, and AppFolio has no send API —
so notices go out through Realm-X, not from HDPM-OS directly.

1. On the Inspections dashboard click **Send notices**. This shows every
   scheduled inspection still needing notice, with recipient email and a
   ready-to-paste subject/body (route date filled in).
2. In AppFolio **Realm-X Assistant → Send Bulk Email**, paste the recipients and
   notice text and send. This logs the message on each tenant's AppFolio page.
3. Back in HDPM-OS, **mark those notices sent** so they stop surfacing.
4. Inspections flagged **"no email"** need a phone call or posted notice —
   handle manually and note it.

### 4. Run the route & complete inspections

1. Inspector works the day route (Routes page shows stop order and drive times).
2. Mark each stop **completed** as it's done (or use bulk status on the queue).
3. Completion automatically:
   - Stamps the unit's last-inspected date and pushes its next due date out
     6 months (unit shows "Recently inspected").
   - **Pre-creates the next routine inspection** 6 months out, carrying the
     tenant contact forward. You never have to remember to re-add a unit — it
     reappears as Eligible ~45 days before it's due.

> **Note:** completions are **not** written back to AppFolio (write API not
> purchased). HDPM-OS is the source of truth for inspection cadence; AppFolio's
> Last Inspected date will lag.

## Exception paths

- **Backfill / historical data:** `Inspections → Import` accepts a CSV/XLSX,
  validates rows (addresses, duplicates), and creates inspections in bulk. Used
  for one-time loads, not the routine cycle.
- **Ad-hoc route from the queue:** the Routes page can also build routes
  directly from existing queued inspections (same engine, same 7-day rule)
  without going through the candidate schedule.
- **Un-dismissing a unit:** filter the Dismissed tab and restore it; it will
  reclassify on the next sync.

## Known limitations

- AppFolio's **"Use Custom Inspection Date"** checkbox is invisible to the API;
  units using it can show a stale last-inspected date until reconciled via the
  web-app audit / CSV cross-check.
- Notices are a **manual copy-paste bridge** into Realm-X — sending and marking
  sent are two separate human steps; skipping the second leaves notices
  perpetually "due."
- Units that fail geocoding silently sit out of routing until the address is
  fixed.
