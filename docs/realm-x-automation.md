# AppFolio Realm-X automation — Flow setup runbook

Standalone runbook for the **automated heads-up** layer of tenant inspection notices.
For the full context (why AppFolio-only, the bulk-send bridge, what the app stores,
and reference Options A/B/C), see [`inspection-notices-appfolio.md`](./inspection-notices-appfolio.md).

**Requirement recap:** all tenant correspondence must be **logged inside AppFolio**.
Realm-X Flow-sent messages appear in the tenant's communication history (Text Message
Inbox) and keep a **Run History** audit trail — so they satisfy the logging rule.
AppFolio's v0 API is read-only and has no send/Flow endpoint, so Flows are configured
in the **AppFolio UI**, not via API.

## Chosen model: Flow heads-up + exact-date via bridge

Two layers, both logged in AppFolio:

1. **Automated heads-up — Realm-X Flow (this doc).** Fires off the move-in / last-
   inspection cadence and tells the tenant a routine inspection is coming up "in the
   next few weeks" (cadence window, no exact day). Hands-off, logged in AppFolio.
2. **Exact-date entry notice — bulk-send bridge.** Once the route is built and the
   inspection has a `target_date`, staff send the precise date/time notice via the
   "Send Notices" flow (Realm-X Assistant → Send Bulk Email), also logged in AppFolio.
   This is the notice that satisfies the legal entry-notice requirement. Its copy
   lives in `lib/inspection-notify.ts` (`buildNoticeContent`).

## Starting template (2026-07-02) — scaffold, not the target

RealmX has **no blank "New / from scratch" workflow**. To build Flow 1 (the relative-
date heads-up below), we start from the **simplest available template** and prune it.
The template we're starting from is a monthly inspection scheduler with a follow-up
loop — captured here so we know what to change.

> **VERIFIED (2026-07-02): this template's trigger CANNOT anchor on Move In.** The
> "Scheduling Inspections Action" trigger is purpose-bound — "a trigger that initiates
> a flow to create an Inspection on a **predefined schedule**." Its only options are
> recurring-calendar dates (**Daily / Weekly / Monthly / Quarterly / Yearly**, run-at
> time, "every Nth day of the month"). There is **no relative-date / Move In / lease
> anchor**, and **no 6-month cadence** (it jumps Quarterly → Yearly). So this template
> is the **wrong scaffold for the move-in-anchored Flow 1** — you can't prune your way
> to a Move In trigger from a recurring scheduler.
>
> **ANSWERED (2026-07-02): there is NO relative-date trigger type.** The only trigger
> for inspection Flows is this recurring scheduler; its recurrence choices are
> **daily / weekly / monthly / quarterly / annual** — nothing anchored on Move In,
> lease, or any tenant date. **Conclusion: move-in-anchored automation cannot be built
> in RealmX Flows.** It stays in our app (cadence engine) + the bulk-send bridge
> (Realm-X Assistant), which is what the app already supports and is the accurate path.
>
> Do **not** use this scheduler to auto-create inspections either — a fixed calendar
> cadence would conflict with the app's move-in-anchored scheduling (double-booking).

Template structure (top → bottom):

1. **Scheduling Inspection Action** *(kickoff trigger)* — "Start this workflow when":
   runs on a **schedule**, *Every month on the 1st at 8:00 AM*, scoped across
   properties.
2. **Inspection Deleted** *(interrupt — "switch to this path when")* — fires when an
   inspection is cancelled manually from the inspection index page; routes to **End
   Workflow**.
3. **Create Inspection for Property** *(action)* — creates and schedules an inspection
   for a property. (The Flow itself creates the inspection object in AppFolio.)
4. **Email Selected Users** *(action)* — sends the notice email to selected users / user
   roles.
5. **Conditional Loop** — "Repeat loop path until" the **Inspection Status** leaves
   *New* / *In Progress*, **or until 3 attempts exceeded**. Three branches:
   - **Loop** → **Loop Pause** (*Pause workflow for 1 DAY*) → re-evaluate the loop.
   - **Condition Met** → **Email Selected Users** → **End Workflow**.
   - **After Max Attempts** → **Email Selected Users** → **End Workflow**.

### Pruning the template into Flow 1

| Template node | Do this |
|---|---|
| **Scheduling Inspection Action** (monthly) | **Change trigger** → On Relative Date, 165 days after **Move In** |
| **Create Inspection for Property** | **Delete** — Flow 1 only emails a heads-up; it shouldn't create inspections |
| **Email Selected Users** | **Keep** — paste the heads-up subject + body; scope recipients to current tenant(s) |
| **Conditional Loop + Loop Pause + branch emails** | **Delete** for minimal Flow 1 (optional: keep as a reminder nudge later) |
| **Inspection Deleted** interrupt | **Delete** — irrelevant to a heads-up email |

Note: the template's *Create Inspection for Property* step, if kept, would make the
Flow the source of truth for inspection creation — which overlaps with the app's
cadence engine. For the heads-up email Flow, delete it and let the app own scheduling.

## Flow setup runbook — relative-date design (NOT BUILDABLE in RealmX)

> ⚠️ **This design cannot be built in RealmX Flows** — confirmed 2026-07-02: RealmX has
> no relative-date/Move-In trigger (only calendar recurrence). Kept below only as the
> conceptual cadence spec; the actual implementation is the app's cadence engine + the
> bulk-send bridge. Do not attempt to configure these two Flows.

Build two Flows; together they equal `max(move-in, last inspection) + 6 months`.

**Before you start**
- Confirm your plan is **Plus or Max** (Flows require it; Core has only Assistant +
  Messages). If "Flows" isn't in the Realm-X menu, you're likely on Core.
- Day math: 6 months ≈ **182 days**. To give ~2.5 weeks of heads-up, trigger at
  **165 days** after the anchor. Adjust the number to change the lead time.

**Flow 1 — first inspection of a new tenancy (anchor: Move In)**
1. Go to **Realm-X → Flows** and click **Create Flow** (or **New Workflow**).
2. Name it `Inspection heads-up — 6mo after move-in`.
3. **Kickoff Trigger** → choose **On Relative Date**, and enable **Auto-Trigger**.
4. In the relative-date row, set: number **165**, unit **days**, direction **after**,
   and in the date-field dropdown pick **Move In** (the same dropdown where "Lease
   Start" appears).
5. **Audience / recipients:** scope to the **current tenant(s) of the unit** the
   trigger fired for (e.g. "Residents" / "Current tenants"). Avoid past residents.
6. **Action:** add a **Send Email** step (add **Send Text** too if you want SMS).
   Paste the heads-up subject + body from below.
7. (Optional) Add a **condition** so it only sends to **active/occupied** units if
   that isn't already implied by the audience.
8. **Activate / turn on** the Flow.

**Flow 2 — recurring every 6 months (anchor: Last Inspection Date)**
1. **Create Flow** again; name it `Inspection heads-up — 6mo after last inspection`.
2. **Kickoff Trigger** → **On Relative Date**, **Auto-Trigger** on.
3. Relative-date row: **165 days after** → date field **Last Inspection Date**.
4. Audience + Action: same as Flow 1 (current tenants; Send Email with the copy).
5. **Activate** the Flow.
   - This recurs because each completed inspection updates Last Inspection Date, so
     the trigger re-evaluates and fires ~165 days later. **Verify** in Run History
     after your first inspection cycle that it re-fires for the new date.

**Test & verify**
- Use the Flow builder's **Test / Preview** (or a test resident) before activating.
- After it runs, open **Realm-X → Flows → Run History** to confirm it fired and see
  which residents were contacted.
- Open a tenant's page → communication history / **Text Message Inbox** to confirm
  the message is logged there (this is the audit record you need).

## Heads-up message copy (paste into the Flow action)

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
bridge — see [`inspection-notices-appfolio.md`](./inspection-notices-appfolio.md).
