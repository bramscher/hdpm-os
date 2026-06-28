# Tenant inspection notices via AppFolio

**Hard requirement:** all tenant correspondence must be **logged inside AppFolio**.
That rules out any external sender (Microsoft 365 / Graph, Resend, SendGrid, etc.) —
those deliver mail but leave no record in AppFolio. AppFolio's API also has **no
endpoint to send messages** (the v0 Database API is read-only; `/communications`,
`/messages`, `/conversations` are not exposed).

So notices are sent through **AppFolio Realm-X**, which records them on the tenant's
AppFolio page. Our app's job is to compute *who is due and when* (move-in-anchored
6-month cadence) and hand that to AppFolio.

## What ships today — bulk-send bridge (any AppFolio tier)

1. Run the candidate sync + schedule inspections as normal (this sets each
   inspection's `target_date` and carries the tenant email from AppFolio).
2. On the Inspections page, click **Send Notices**. The app shows every scheduled
   inspection still awaiting a notice, grouped by date, with copyable recipient
   emails and a ready-to-paste message.
3. In AppFolio, open **Realm-X Assistant → Send Bulk Email**, paste the recipients
   + message for each date, and send. AppFolio logs it on each tenant's page.
4. Back in the app, click **Mark … as sent** so they stop showing as pending.

This is confirmed to satisfy the logging requirement (Realm-X Assistant bulk email
is recorded on the tenant page). It's manual per batch — no API send exists.

## Path to automation — needs verification

### Option A: Realm-X Flows (requires Plus or Max plan)
Realm-X **Flows** can auto-send resident communications on a relative-date trigger.
Before relying on it, confirm with your AppFolio rep / support:

1. **Are Flow-sent messages recorded in the per-tenant communication history?**
   (Confirmed for Assistant bulk email; **not documented** for Flows — this is the
   load-bearing question for the logging requirement.)
2. **Can a Flow's relative-date trigger anchor on the tenant move-in date**, or on
   the unit "Last Inspection On" / "Custom Inspection Date" field? (Relative-date
   triggers exist, but the valid anchor fields are not documented.)
3. **Can a Flow trigger off a custom date field** we'd populate (e.g. "Next
   Inspection Date")? (No evidence custom fields can be trigger sources — treat as
   unlikely until confirmed.)
4. **What plan are we on?** Flows + custom fields require **Plus or Max** (Core has
   only Assistant + Messages).

Note: even on Flows, a relative-date trigger off move-in alone won't reproduce our
exact rule (`max(move-in, last inspection) + 6 months`, reset per tenant). It would
be an approximation unless an inspection-date anchor is available.

There is **no API to create or fire a Flow** — Flows are configured in the AppFolio UI.

### Option B: AppFolio Realm-X ⇄ Claude connector (investigate)
AppFolio shipped an agent-to-agent connector (`mcp.appfolio.com`, June 2026) that
exposes "operational jobs executed inside AppFolio." It's connected to this project.
Until someone completes its OAuth (run `/mcp` → "claude.ai AppFolio Realm-X" →
authorize), only the login tools are visible. **Decisive test:** authorize once, then
check whether it exposes a "send tenant message" or "run Flow" job. If it does, our
scheduler could drive AppFolio to send + log notices fully automatically.

### Option C: Stack/Partner API work-order anchor (heavier)
The only API-writable anchor is a **Work Order** (Stack/Partner API, requires partner
approval). We could create a per-unit inspection work order whose date drives a Flow.
Downsides: needs partner approval, semantically a maintenance object, and whether a
Flow fires off a work-order date is unverified. Lower priority.

## What our app stores (channel-agnostic)
- `inspection_properties.move_in_date`, `next_due_date`, `resident_name`, `tenant_email`
- `inspections.move_in_date`, `notice_email`, `notice_status`, `notice_sent_at`

These support the cadence + the bulk-send bridge and would also feed any of the
automated options above.
