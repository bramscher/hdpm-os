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

## Chosen model (2026-06-29): Flow heads-up + exact-date via bridge

Two layers, both logged in AppFolio:

1. **Automated heads-up — AppFolio Realm-X Flow.** Fires off the move-in / last-
   inspection cadence and tells the tenant a routine inspection is coming up "in the
   next few weeks" (cadence window, no exact day). Hands-off, logged in AppFolio.
2. **Exact-date entry notice — our bulk-send bridge.** Once the route is built and
   the inspection has a `target_date`, staff send the precise date/time notice via
   the "Send Notices" flow above (Realm-X Assistant), also logged in AppFolio. This
   is the notice that satisfies the legal entry-notice requirement.

### Flow setup runbook (configure in AppFolio → Realm-X → Flows)

Build two Flows (they together equal `max(move-in, last inspection) + 6 months`):

- **Flow 1 — first inspection of a tenancy**
  - Kickoff Trigger → *On Relative Date* → **~166 days after Move In** (≈ 6 months −
    a 2-week heads-up; adjust the lead to taste).
  - Audience: the unit's current tenant(s).
  - Action: Send email (and/or text) using the heads-up copy below.
- **Flow 2 — recurring every 6 months**
  - Kickoff Trigger → *On Relative Date* → **~166 days after Last Inspection Date**.
  - Audience / Action: same as Flow 1.

### Heads-up message copy (paste into the Flow action)

> Subject: Upcoming Routine Property Inspection
>
> Hello,
>
> This is an advance notice that High Desert Property Management conducts routine
> inspections of your home about twice a year, and your next one is coming up in the
> next few weeks. We'll follow up with the exact date and time before we visit.
>
> The inspection is a brief walkthrough to check the home's condition and note any
> maintenance needs — you're welcome to be present but don't need to be.
>
> Questions? Call us at (541) 406-6409 or reply to this message.
>
> Thank you,
> High Desert Property Management
> (541) 406-6409

The **exact-date** notice (with the scheduled day) is sent later by the bulk-send
bridge — its copy lives in `lib/inspection-notify.ts` (`buildNoticeContent`).

## Other automation paths (reference)

### Option A: Realm-X Flows (requires Plus or Max plan) — VERIFIED with AppFolio (2026-06-29)
Realm-X **Flows** can auto-send resident communications on a relative-date trigger.
AppFolio support confirmed the two load-bearing questions:

1. **Flow-sent messages ARE logged** — automated Flow emails appear in the
   communication history (Text Message Inbox), and Flows keep a **Run History**
   audit trail of when each flow fired and which residents were contacted.
   ✅ Satisfies the "logged inside AppFolio" requirement.
2. **Relative-date triggers can anchor on Move In and on Last Inspection Date** —
   "# days before/after Move In" and "# days after Last Inspection Date" are both
   selectable trigger anchors. ✅ Exactly our cadence's two anchors.

Reproducing our rule `max(move-in, last inspection) + 6 months` with native Flows:
- **Flow 1 — first inspection per tenancy:** trigger "~180 days after Move In"
  (minus desired notice lead). Handles new tenants / never-inspected units; the
  move-in reset is automatic because the anchor is the tenant's move-in.
- **Flow 2 — recurring:** trigger "~180 days after Last Inspection Date." Each
  completed inspection updates Last Inspection Date, so the next notice fires 6
  months later. Together these two flows = max(move-in, last inspection) + 6mo.

Caveats / open points:
- Flows fire on a fixed offset from an AppFolio date, so the Flow notice can't
  contain the **exact route date** our routing engine assigns (we can't write that
  back to AppFolio via API). Decide whether the Flow notice is the "heads-up /
  due-window" notice and the exact-date entry notice goes out separately (bulk-send
  bridge, or the MCP connector later), or whether the cadence date itself is the
  scheduled date.
- Confirm the AppFolio **plan tier** (Flows require Plus/Max).
- Flows are configured in the **AppFolio UI** — there is no API to create/fire one.

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
