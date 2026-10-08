# HDPM-OS . 

The operating system for **High Desert Property Management** (~850 doors across 467 properties, Central Oregon).

> **Mission: run HDPM like a system — every door, every dollar, and every decision visible, owned, and remembered.** Humans decide; agents watch, chase, brief, and file; the brain remembers. Full mission, system schematic, and agent org chart: [`docs/hdpm-os/13-mission-agents-and-schematic.md`](docs/hdpm-os/13-mission-agents-and-schematic.md).

Four layers on one Supabase spine, over the systems of record (AppFolio, M365, Slack, Zoom — never replaced):

1. **Maintenance OS** — live work-order board with an 8-stage lifecycle, one accountable owner + next-action date per WO, 12 crack-proofing tripwires, AI triage, vendor scoreboard, turnover board.
2. **EOS operating layer** (Company screens) — weekly scorecard, the Issues & To-Dos IDS queue fed by an escalation ladder, the meeting runner (solve requires an outcome), Rocks, and the accountability chart.
3. **Agent layer** — Morning Card, Estimate Chaser, Ops Brief, Escalation Ladder, Scorecard, Meeting Prep: proposal-first, audited, autonomy earned per action.
4. **Company brain** — pgvector memory over SOPs, decisions, and minutes; every answer cited.

Plus the tools: inspections + route builder, invoice generation + trust-payment reconciliation, rent comps, Craigslist ads, key manager, owner reports, the KPI dashboard, fee management, Knowledge Capture, and the referral partner portal.

**Stack:** Next.js 16 / React 18 / TypeScript 5.7 / Supabase (PostgreSQL + pgvector) / Tailwind CSS 3.4 / Recharts 3 / three.js / Anthropic SDK / Vercel
**Auth:** Microsoft Azure AD (@highdesertpm.com only)
**Domain:** os.highdesertpm.com (staff app) · partners.highdesertpm.com (referral partner portal)
  
---

## Table of Contents

- [What's new (Sep 24 – Oct 8, 2026)](#whats-new-sep-24--oct-8-2026)
- [Getting Started](#getting-started)
- [Home (Quick Actions)](#home-quick-actions)
- [Activities](#activities)
- [Maintenance OS (Live Board)](#maintenance-os-live-board)
  - [Open Board](#open-board)
  - [✦ Triage Review](#-triage-review)
  - [Waiting-On](#waiting-on)
  - [Vendor Scoreboard](#vendor-scoreboard)
  - [Aging](#aging)
  - [Exceptions](#exceptions)
  - [Turnover](#turnover)
  - [Monday Review](#monday-review)
  - [Work Order Detail](#work-order-detail)
  - [Tripwires & Email Digests](#tripwires--email-digests)
  - [Chase Board](#chase-board)
  - [Parts Orders](#parts-orders)
  - [Price Book & Turn Templates](#price-book--turn-templates)
- [Agent-OS (the Agent Team)](#agent-os-the-agent-team)
  - [Agents Page, Routine Calendar & Activity Feed](#agents-page-routine-calendar--activity-feed)
- [Company — the EOS Layer](#company--the-eos-layer)
- [Company — Timekeeping](#company--timekeeping)
- [Company — The Desk (demo)](#company--the-desk-demo)
- [Company Brain](#company-brain)
  - [Brain Map](#brain-map)
- [Knowledge Capture](#knowledge-capture)
- [KPI Dashboard](#kpi-dashboard)
  - [KPI Cards](#kpi-cards)
  - [KPI Trends](#kpi-trends)
  - [Daily KPI Snapshots](#daily-kpi-snapshots)
- [Inspections](#inspections)
  - [Inspection Queue](#inspection-queue)
  - [CSV / XLSX Import](#csv--xlsx-import)
  - [Geocoding](#geocoding)
  - [Route Builder](#route-builder)
  - [Inspection Candidates](#inspection-candidates)
  - [Send Notices](#send-notices)
- [Craigslist Ad Creator](#craigslist-ad-creator)
- [Invoice Generator](#invoice-generator)
  - [Owner vs Tenant Charges](#owner-vs-tenant-charges)
- [Rent Comps](#rent-comps)
  - [Comps Dashboard](#comps-dashboard)
  - [Comps Analysis Wizard](#comps-analysis-wizard)
  - [Rent Analysis Reports](#rent-analysis-reports)
- [Key Manager](#key-manager)
- [Owner Reports](#owner-reports)
- [Admin](#admin)
  - [User Settings & Delegated Admin](#user-settings--delegated-admin)
  - [Fee Management](#fee-management)
  - [Hiring, Website & Leads](#hiring-website--leads)
- [Referral Partner Portal](#referral-partner-portal)
- [Haven (Leasing & Reception)](#haven-leasing--reception)
- [Properties Map](#properties-map)
- [AI Chat (ORS 90)](#ai-chat-ors-90)
- [Dez — Slack Agent](#dez--slack-agent)
- [Scheduled Jobs (Crons)](#scheduled-jobs-crons)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Deployment](#deployment)
  - [Builds (self-hosted fonts)](#builds-self-hosted-fonts)

---

## What's new (Sep 24 – Oct 8, 2026)

PRs #69–#147. Details live in each feature's section below.

**Knowledge Capture (headline)**
- New [Knowledge Capture](#knowledge-capture) page: Matt and Penny record what they know about each AppFolio owner and property; Whisper transcript → Claude notes → company brain → living profiles (#140)
- Moved to the Admin menu and limited to Matt, Penny and Craig by a fixed email list (#141)
- Link duplicate and related owner records: same person (merge), related, not the same, with suggestions (#142)
- Both Matt's and Penny's take: "Who's talking", M/P dots, *Needs Matt's / Penny's take* filters, Perspectives on the profile (#143)
- Type or paste notes as a third input; iPhone Safari pass (#144)
- Hardened after a multi-reviewer pass: atomic processing claims, timeouts surface as Retry, safer profile rebuilds, confirm before discarding an in-progress recording (#147)

**Home, Activities & look**
- `/activities` page plus weekday Slack DMs for pending AppFolio activities (#69); admin dropdown lists every staff member, grouped into staff / former staff / not matched (#97, #98)
- Monochrome HDPM OS re-skin: new login page, compact Notion-style home dashboard (#71)
- Home: Admin tiles for every admin, not just Craig (#82); a "My activities" card for every employee, Activities on for every role (#95)

**Admin**
- Admin → User settings: per-person section switches (#83), roles with editable defaults (#84), delegated admin areas for non-admins (KPIs, Fee Management, Hiring, Partners) + Lisa Coffey (#130)
- Fee Management: Fee Index moved from the KPI dashboard (#70, #72); Owner Fee Opportunity campaign (#72); door-count schedule, raise steps and 0–100 opportunity grade (#73); owner contact card (#74); Fee Schedule tab (#75, #77) with market reference (#76); fee fatigue & churn (#78, #79, #80); Agreements tab (#112); Proposed Structure tab (#131)
- Hiring and Website sections (#122, #123); Leads section (#124); Partners in the sidebar, home tiles and `/admin` (#96)

**Referral Partner Portal**
- Served on partners.highdesertpm.com (#101); one-time bounty ledger + admin approval (#99); payouts, QuickBooks CSV and 1099 readiness (#100); escaped partner-typed values in emails (#103); admin-only management-fee income probe and findings (#104, #105)

**Maintenance**
- Chase board replaces the follow-up list: aging × action snapshot, today's focus, lanes, by-vendor batch chase (#89)
- Parts orders tracked and chased from the board (#90)
- Routine run log, routine calendar at `/agents/routines`, live activity feed on `/agents` (#91)
- Price Book: every line editable (#81); dump run ($95/hr, 1 hr) + dump fee ($10 default, at cost), cost-plus price = default line cost, Standard unit turn template v3 (#145)
- Improve with AI on invoice lines, work order notes and estimate scopes (#114)
- Daily Billing Review defaults to pay periods (#110)
- Invoices: Owner charge or Tenant charge, never both (#111); tenant name/unit prefill (#138); reason and lease clause optional for techs, required to post (#139)

**Inspections**
- Route Builder greys out picks that can't be routed, with the reason (#120); Route Builder routes show up in Send Notices (#126)
- Candidates: release units stuck as "marked scheduled" (#127); link unmatched completions; add Ready units to the queue (#128)
- Notices v2: change route dates, re-check recipients, per-unit sent; letter-first, Realm-X behind `NEXT_PUBLIC_REALMX_ENABLED` (#129)
- Route sheets show the property name, not AppFolio's internal id (#135); notices give the office phone (541) 548-0383 (#137); SOP refreshed (#121)

**Rent comps / rent analysis reports**
- Long notes, real page numbers, no duplicated listings (#115); Nearby Rentals page in the PDF (#116) and on screen (#117)
- Owner `/r/` links open without login; no same-day overwrites (#118); Data Sources lists only contributing sources (#119)
- Standard owner notes: insert button (#132), auto-fill when empty (#133), office phone (#134)

**Brain, agents & demos**
- Brain map: nightly snapshot + 3D `/brain` (#92, #93, #94); rebuilt as an anatomical brain, galaxy kept as Brain 2 (#107, #108, #109); Brain 2 hidden from the menu (#124)
- Agents page: plain-English catalog of what each agent does and why (#86)
- The Desk (demo) at `/desk-demo`: gold vacancy, green new tenant setup and blue owner onboarding folders (#85, #87, #88)

**Timekeeping, auth & builds**
- Timekeeping: edit earlier days while clocked in (#125)
- Auth: Microsoft token refresh so Outlook publishing works all session (#136)
- Fonts self-hosted; builds no longer fetch Google Fonts (#146)
- **Security (#147):** browser roles (`anon`/`authenticated`) lose access to ~50 server-only tables whose “service role” policies applied to every role (`20261018_harden_table_grants.sql`); `MarkdownLite` escapes quotes and only links plain URLs; Price Book template cleanup removes a duplicate marked-up “Dump fees” line (`20261019_dump_template_cleanup.sql`)
- Docs: field time & recovery plan (#111) with the GPS plan kept as its phase 2 reference (#113); parts-orders review checklist (#102)

---

## Getting Started

```bash
npm install
cp .env.example .env.local   # Fill in all required env vars
npm run dev                   # http://localhost:3000
```

Login requires a `@highdesertpm.com` Microsoft account. All pages and API endpoints are protected behind Azure AD authentication, and each page area belongs to a section in `lib/access/sections.ts` (see [Admin → User settings](#user-settings--delegated-admin)).

**Microsoft token refresh (#136):** sign-in requests the `offline_access` scope, so the session cookie (encrypted, never exposed to the browser session) keeps a Microsoft refresh token and swaps in a new access token ~5 minutes before expiry. Outlook publishing (route calendars) now works for the whole 8-hour session; if a refresh fails, publishing shows the "sign out and back in" message. Sessions from before the deploy need one sign-out/sign-in.

---

## Home (Quick Actions)

**Path:** `/`

Landing page with a time-aware greeting, live portfolio stats, and one-click entries into every tool. Re-skinned in **monochrome** (#71): black-and-white neutrals (token names kept, so every page picked it up), a new black-panel login page ("HDPM OS · os.highdesertpm.com"), compact Notion-style rows instead of colored tiles, and red count pills as the only color.

- **My activities** card (#95): every signed-in employee sees Overdue / Due today / Next 7 days / Later counts and their 5 most urgent AppFolio activities, each with an AppFolio link; **See all →** opens [Activities](#activities). Hidden if Activities is switched off for the person.
- **Admin tiles** for every admin (`staff.access_role = 'admin'`), not just Craig (#82), including Fee Management and Partners. Tiles and sidebar items follow the person's section switches.
- **Live stats strip:** total inspections, overdue count, inspections this week, active routes, dispatched stops, vacant units
- **Quick-action rows:** Inspections, Route Builder, Invoice Generator, Rent Comps, Craigslist Ad Creator, KPI Dashboard
- **System status bar:** connection indicators for AppFolio and Rentometer

---

## Activities

**Path:** `/activities` (sidebar, under Dashboard) · **Section:** `activities` — on for every role (#69, #95)

Each person's pending **AppFolio activities**, plus weekday Slack DMs so nothing due slips.

- **Page:** the signed-in user's activities grouped into Overdue, Due today, Next 7 days and Later, with count tiles and an "Open in AppFolio" link per row (to the tenant's Upcoming Activities panel, or the property page when there's no tenant).
- **Admin "View activities for" dropdown** (#97, #98): grouped into **Staff** (every active staff member, `— 0` when nothing is pending), **Former staff — reassign in AppFolio** (departed or AppFolio-deactivated users who still hold activities), and **Not matched to staff** (including unassigned). Staff with the Activities section switched off are left out.
- **Slack DMs (weekdays, via `agent_outbox`):** 7 AM everything due today + overdue count; hourly 8:30 AM–4:30 PM for newly-due items (each announced once, via `alerted_keys` fingerprints); 1 PM reminder for anything still due today.
- **Data:** Reports API v2 `upcoming_activities` (pending only, including overdue), 5-minute in-memory cache for the page; DM passes run fresh.
- **Matching:** AppFolio `assigned_user` → active `staff` by `name`, then `person` ("(Hidden)" suffix stripped). An employee's activities show only if their staff name matches their AppFolio user name.
- **Off switches:** the global agent kill switch, or `agent_config` row `activities / daily_dm` with `enabled=false`. Cron test flags: `dryRun=1`, `only=<person>`, `previewAs=<assignee>&to=<staff>&asOf=YYYY-MM-DD&kind=morning|new|nudge`.

---

## Maintenance OS (Live Board)

**Path:** `/maintenance/board` · **Sidebar:** MaintOS (wrench icon) · **Spec:** `docs/maintenance-os/`

The maintenance command center: every work order moves through an 8-stage lifecycle (`NEW → TRIAGED → SCHEDULED → IN PROGRESS → WAITING ON → VERIFY → BILL → CLOSED`) with one accountable **HDPM owner** and a **next-action date** at all times. **AppFolio stays the system of record** — status, scheduling, and vendor assignment are edited *there* (every card has an "Open in AppFolio ↗" link); the board mirrors AppFolio within 15 minutes and adds the accountability layer AppFolio can't track: owners, dates, priorities, the closure gate, and 12 automated tripwires.

The **Dashboard** tab is the default landing; eight further tabs sit behind it — each deep-linkable via `?view=`. `/maintenance` redirects here.

### Dashboard (default)

*Where are we on maintenance?* on one screen, so the daily sweep and the Monday meeting start from the same numbers. Served by `GET /api/maintenance/dashboard` (`lib/maintenance/dashboard.ts`, pure and unit-tested).

- **Axis = AppFolio status**, not the HDPM stage: `New → Assigned → Scheduled → Work completed → Closed (7d)`, plus an **estimate lane** (`Estimate requested → Estimated → Owner approval pending`, with estimate-chaser activity) and a **Waiting** pocket. Every open work order lands in exactly one bucket, so the tiles sum to the open total.
- **Each tile** shows the count, how long the current occupants have been in the step (median · p90, from the `sync_update` status log), and how long the step *typically* takes (completed spells over the last 90 days, with `n`).
- **"N over" pill** = past the shared threshold table in `lib/maintenance/dashboard-thresholds.ts` (New >1 business day, Assigned >5, estimates >3, Waiting >5 days, visit date passed, turn behind target). The same table will drive the Slack reminders, so the number you see and the nudge you get can never disagree.
- **Unit turns** by lifecycle state (`turn_status_event` clocks; falls back to the legacy status if migration `20260905` is not applied), days vacant, and behind-target.
- **Needs attention today**: tripwire total, needs-a-date backlog, vendors with overdue work, and the eight oldest exceptions.
- **Drill-down**: click any number → the matching list view narrowed to those ids (a filter chip above the list clears it) → the work-order or turn detail page.
- **Not measured** (no timestamp exists): request → WO, reschedules, estimate dollar amounts, vendor bill timing. "Estimated" is *not* treated as waiting on the property owner — only a recorded owner-approval request is.
- A daily `dashboard_pipeline` row (counts only) is written to `metrics_snapshot` by the 6:30 AM metrics cron for future trends.

### Open Board

Kanban of all open work orders, one column per stage.

- Card = what/where · HDPM owner · next-action date (red = past due = automatic exception)
- Left-edge color = priority: red P1 (emergency) · amber P2 (urgent) · green P3 (routine) · gray P4 (planned)
- Header tiles: open count, exceptions to fix today, 30+ days old, P1s this week, owner+date coverage
- Click any card to open its [Work Order Detail](#work-order-detail); scroll sideways for more columns

### ✦ Triage Review

Batch AI triage — clear the backlog by reviewing instead of typing.

- **Generate proposals** runs Claude across untriaged WOs (~24s / ~4¢ each, pausable, resumes where it left off)
- Each row: AI summary + risk flags + recommended next action, with proposed **priority / date / HDPM owner** as editable dropdowns
- **Apply** (one tap), edit-then-apply, or **Skip** — nothing changes a work order until you act
- **Apply all untouched** bulk-applies; any row you edited is excluded and stays for individual review
- Every apply lands in the WO timeline under your name, exactly like manual triage

### Waiting-On

One table for everything blocked, filterable by wait type.

- Chip filters: Tenant / Vendor / Parts / Owner / Weather / Internal — badge colors are consistent everywhere
- Days pill = urgency: green ≤2 · amber 3–5 · red >5 (red = chase by phone today)
- Every row has a next action, a date, and one HDPM owner — nothing waits silently
- Note: the purple OWNER badge means the *property* owner; "HDPM Owner" is the accountable team member

### Vendor Scoreboard

Rankings with teeth, from day one.

- **History (all-time):** jobs closed · median → p90 cycle time · % taking >30 days — seeded from 8,000+ historical closed WOs
- **Days open (med/avg):** current open backlog age per vendor — red flag when the median passes 21 days
- **90-day columns** (accept time, callbacks) build up from live assignments and take over as the operative signal
- **Edit** any row to maintain the profile: trades, license/insurance + expiry, W-9, rates, preferred/emergency flags, and the **demoted** switch (forces bottom rank — set it at Monday review)

### Aging

Where old work orders explain themselves.

- Buckets: 0–7 / 8–14 / 15–30 / **30+** days (real AppFolio ages, not sync dates)
- Every 15+ day item needs a **written reason** ("why it's old") — set it on the WO detail page; missing reasons flag red
- Target from the ops plan: 30+ bucket under 5, each reason said aloud on Monday

### Exceptions

Cheryl's daily sweep — the day is done when this reads ZERO.

- Live run of the 12 tripwire rules: every row = one broken invariant + the fix required today + who owns it
- Rows link straight to the offending work order
- Admins: the **Digest recipients** panel at the top controls who gets the 6 AM weekday email (enter email, tick enabled — takes effect next morning, no deploy)
- Phase-1 definition of done: five consecutive business days at zero

### Turnover

Vacant-unit turns — vacancy is rent lost daily.

- Days vacant · target-ready date (on track / at risk / slipping) · single current blocker · assignee · budget vs actual
- Flag a WO as a turn from its detail page ("This is a turn" checkbox), then set vacated/target/budget there

### Monday Review

The 30-minute ops meeting agenda, generated live — no slides, no prep.

- 0–5 min: P1s last week · 5–12: the 30+ bucket (summarized with the 8 oldest when long) · 12–18: vendor waits >5d (last chance or reassign+demote) · 18–23: verify + unbilled · 23–28: turns · 28–30: one improvement
- Every line links to the work order it came from

### Work Order Detail

Click any card. The left panel is the workflow; the right panel is the closure gate.

- **✦ AI Next Action:** generate a summary, priority recommendation with escalate-if conditions, risk flags, blocker, next step, a copy-paste draft message, and an AppFolio checklist (~4¢, cached until you regenerate)
- **Workflow controls:** stage dropdown (only legal moves shown), HDPM owner, next-action date, P1–P4, tech, wait reason, "why it's old"
- **Closure gate:** live six-condition checklist — verification, invoice linked, recommendations resolved, tenant ping sent, incidents documented, preventive scheduled. CLOSED is unreachable until all six pass (the Close button enables itself)
- **Failed access:** log what happened + a new date — the WO auto-returns to SCHEDULED (tripwire #5)
- **Timeline:** append-only history of every change, who made it, and when — including sync and tripwire activity
- **Add parts order** (see [Parts Orders](#parts-orders)) and **Improve with AI** on work order notes (#114): suggests clearer wording you review and apply; nothing changes until you accept (`POST /api/maintenance/improve-copy`, also used by invoice line descriptions and estimate scope descriptions)
- **Open in AppFolio ↗** for anything AppFolio owns (status, scheduling, vendor)

### Tripwires & Email Digests

Twelve if-then rules run every weekday at 6 AM PT; each person gets **one email listing only their items** (nothing on a clean day). Highlights:

| # | Fires when | Owner |
|---|-----------|-------|
| 2 | WO unassigned/untriaged > 1 business day | Cheryl |
| 3 | Next-action date blank or past | WO's owner |
| 4 | Vendor hasn't accepted in 24h | Cheryl |
| 7 | In VERIFY without photos + time + materials | Tech |
| 8 | Verified > 5 days, no invoice | Penny (plus a Monday report) |
| 11 | Approval or **AppFolio estimate** pending > 3 business days | Jen |

(#1 and #9 await the Haven.AI integration. Full rule table: `docs/maintenance-os/02-functional-spec.md` §5.)

### Chase Board

**Path:** `/maintenance/estimate-followups` (sidebar: Chase board) · **Section:** `chase_board` (admins by default; switch on per person) · **Logic:** `lib/agents/chase-board.ts` (#89)

Replaced the uncapped follow-up list — same URL, so Slack "Open shared queue" links and the `/company/issues` embed still work.

- **Aging × Action snapshot:** one-sentence summary (stuck / need cleanup / over 45 days), a stage × age grid, and a "What they need next" bar (Fix first, Decide, Chase, Check). Clicking a cell, stage, total or step filters the cards.
- **Next step on every card and drawer** in plain words (e.g. "Assign a vendor in AppFolio — no one has been asked for this bid"); the email form folds away when cleanup must come first.
- **Today's focus:** at most 7 cards, round-robin across lanes, beside sends this week vs the gate of 15, a countdown to Oct 15 and an 8-week chart.
- **Lanes:** Vendor estimate, Owner approval, Needs scheduling, Waiting on parts, Needs help — 8 cards each then "show more"; a **Parked** tray for work waiting on replies and closed work.
- **By vendor:** "Chase all N in one email" for 2–25 WOs per vendor (`decideVendorBatch`). Every WO passes the same checks as a single send (data ≤2 hours old, matching context version, 8-day block against the old chaser) and gets its own claim + history; if any claim fails nothing is sent.
- Dez now logs which sources it cited (`dez_activity.detail.cited`), feeding the [Brain Map](#brain-map).

### Parts Orders

**Migration:** `20261001_parts_orders.sql` (`supplier`, `parts_order`, `parts_order_event`; seeds Lowe's Bend Pro desk, Home Depot, Ferguson) · **Logic:** `lib/maintenance/parts.ts` (#90)

- **Add parts order** on the work order page and in the chase drawer. Saving sets the WO to WAITING_ON / PARTS in HDPM (no AppFolio write); if that stage change is blocked, the order still saves with a warning.
- **Chase due (`partsChaseDue`):** >1 business day past the expected date; no expected date and ordered >5 business days ago; delivered but no service date after >2 business days; or status `issue`.
- On the chase board: a **Waiting on parts** lane with supplier next steps and a supplier draft; not-yet-due orders sit in Parked; an `issue` or 3+ contacts moves the card to Needs help; a WO with an open order shows only in the parts lane.
- **Contacts** (call, email, text, note) logged with minutes spent; supplier sends from the drawer log automatically. Missing tables are treated as no orders.

### Price Book & Turn Templates

**Path:** `/turn-estimator/price-book` · **Section:** `price_book` (editing is admin-only)

- **Every line fully editable** (#81): name, category, charging method (fixed, hourly, minimum visit, package, per item, cost plus, quote, allowance), price, unit, included / block minutes and price, standard minutes, markup %, GL code, trade, owner-facing description, internal instructions, "can be charged to tenant", "needs pricing review". **Add item** uses the same form; the internal reference is fixed at creation. Search + category filter.
- **Version-on-change:** saving closes the current row and writes a new one effective today, so issued estimates keep their price; every save is audit-logged. Server-side validation in `lib/turn-estimator/price-book-input.ts`.
- **Dump run + dump fee** (#145, migration `20261017_dump_run_price_book.sql`; follow-up `20261019_dump_template_cleanup.sql` in #147 removes the old duplicate “Dump fees” materials line from saved unit-turn templates and lets the fee's cost come from the Price Book default):

  | Item | Charged as | Default | Editable |
  |---|---|---|---|
  | `DUMP_RUN` Dump run | Hourly labor, $95/hr | 1 hour = $95.00 | Hours on the estimate line; rate in the Price Book |
  | `DUMP_FEE` Dump fee | Cost-plus at 0% markup (owner pays exactly the receipt) | $10.00 | Amount on each line; default in the Price Book |

- **Cost-plus default cost:** a cost-plus item's price-book price now pre-fills the cost on new lines (picking the item or applying a template) — labelled "Default cost on new lines (0 = none)". Materials and Appliance stay at 0.
- **Standard unit turn template v3:** *Dump run* and *Dump fee* follow *Haul-away* (unchecked by default), replacing the old Materials-based *Dump fees* line. The migration publishes a new version of every non-archived saved "unit turn" template with both lines appended (old versions kept, audited).

---

## Agent-OS (the Agent Team)

**Sidebar:** Click **Agents** · **Docs:** `docs/agent-os/00-DRAFT-master-plan.md` (the plan) + `docs/agent-os/02-brief-b-conventions.md` (the contract) · **Team guide:** Notion → "SOP: Maintenance Agents"

The agent layer converts the Maintenance OS's *detection* (tripwires, exceptions) into *staff motion* in the channels people already use — Slack, Outlook, and Zoom SMS. Every agent output is an `agent_proposal` row first (audit trail + approval queue), every outbound message goes through `agent_outbox` (channel adapters: `slack`, `email`, `outlook_draft`, `sms_zoom`, `in_app` — all five live), and autonomy is data, not code: `agent_config` holds one row per (agent, action) on the **L0 observe → L1 draft → L2 act-on-tap → L3 act-then-notify → L4 silent** ladder, with per-action ceilings (owner/tenant-facing hard-walled at L2 forever) and a global kill switch (`agent='*', action_type='*', enabled=false`).

**Status (2026-08-04):** full roster, schedules, and the agent org chart live in [`docs/hdpm-os/13-mission-agents-and-schematic.md`](docs/hdpm-os/13-mission-agents-and-schematic.md).

| Agent | What it does | Autonomy | Status |
|-------|--------------|----------|--------|
| **Morning Action Card** | Weekday 6:30 AM PT: Cheryl's 7 most important exceptions as a Slack card with Done / Snooze / Set-date / Reassign buttons; Brody + Matt read-only copies + email mirror; one 1 PM nudge | L2 | ⏸️ Built; gated off until Loop 1 clears |
| **Estimate Chaser — email** | Weekday 6:45 AM PT: TW11 stuck estimates become ready-to-send Outlook drafts in the owner's Drafts folder (vendor bid chases + owner-approval asks; never a dollar amount; 3-business-day cooldown; subject numbers the round — "Bid follow-up (2nd request)"; round 3 carries a firm hand-datable close). Production owner **Jayme** (`ESTIMATE_CHASER_OWNER`) | L1 | ✅ Live |
| **Estimate Chaser — SMS** | Vendor chases go SMS-first when a phone is known: Slack "Text chase queue" card, taps send from the sender's Zoom line via their own OAuth token | L2 | 🟡 Built; runs in shadow during the pilot (a tap records motion, no text leaves) |
| **Estimate Chaser — escalations** | Stuck >45 days → Slack DM to the maintenance leads + (via the ladder) an EOS issue. "Chased 3×" escalation now applies **only to vendor chases that have an assigned vendor** — owner-approval asks (bid in hand) and un-assigned Estimate-Requested WOs keep following through to the owner's Drafts instead of parking | L3 | ✅ Live |
| **Ops Brief** | Daily ~5 PM PT + Monday deep brief: metrics + deltas, agent activity, open escalations with [Acknowledge] taps, brain context — Brody interactive, Matt + Craig read-only | L3 | ✅ Live |
| **Escalation Ladder** | Weekday 7:15 AM PT: aged/recurring tripwires, chaser escalations, and twice-missed to-dos auto-file EOS issues (deduped, capped 10/rung/run) so nothing evaporates from a DM | files only | ✅ Live |
| **Scorecard** | Friday 3 PM PT: auto-fills the weekly scorecard, nudges manual-metric owners, files issues at 2 weeks off-track, sends the one-tap Friday Rock check | L2 | ✅ Live |
| **Meeting Prep** | Monday 7:30 AM PT: builds the L10 prep packet (scorecard deltas, aged issues, cited brain context) and DMs the facilitator | L1 | ✅ Live |
| Email Triage, Intake, Day-Close SMS, Reconciliation, Vendor Chaser, Inspections | See the master plan roster | — | Backlog |

**Key routes:** `/agents` (dashboard: config matrix, proposals, outbox) · `/api/agents/cron/morning-card` (built, not scheduled) + `/api/agents/cron/estimate-chaser` (cron; takes `?dryRun=1` and pilot flags `?pilotSeed=N&seedChannel=sms|email`) · `/api/agents/slack/interact` (button taps; Slack-signature auth) · `/api/agents/dispatch` (manual outbox drain) · `/api/agents/sms-test` (Zoom SMS probe) · `/api/agents/vendor-contact-audit` (AppFolio contact-field diagnostics) · `/api/agents/zoom-oauth/start` (one-time SMS sender authorization)

### Loop 1 — estimate chase (live, owner: Jayme — 2026-08-27)

Per [`docs/agent-os/10-restart-2026-08-20.md`](docs/agent-os/10-restart-2026-08-20.md), the estimate chase is the one loop being proven. It ran as a Craig + Brody shadow pilot (2026-08-25), then handed to assistant **Jayme** as the production owner. Every weekday the chaser drafts stuck-estimate follow-ups into Jayme's Outlook Drafts; she reviews and sends each — the send *is* the completed action, nothing to re-type into AppFolio.

**What the backlog actually is (dug in 2026-08-27):** it's a **decision backlog, not a vendor-capacity one**. Of the genuinely-stuck estimate WOs, most have a **bid already in hand** and are waiting a median ~19 days (some 100+) on an approval *decision* — the vendor did its job. Only a minority are actually waiting on a vendor bid. So the chaser follows both: vendor-bid chases *and* owner-approval nudges, and no longer parks the owner-approval / un-assigned ones in the Ops Brief after 3 tries (see the escalations row above).

Delivery is env-driven (`ESTIMATE_CHASER_OWNER` sets the owner; the pilot `AGENT_PILOT_RECIPIENTS` / `AGENT_PILOT_SHADOW` flags still exist for reroute/shadow). The Outlook draft path requires the app-only Graph `ApplicationAccessPolicy` (`agent-mail` group) to include the owner's mailbox, and `AGENT_GRAPH_DRYRUN` unset. `?pilotSeed=N&seedChannel=sms|email` (via `scripts/pilot-fire.sh`) is a **test tool only** — it re-drafts the same oldest WOs and inflates chase rounds, so it is not used against the live owner.

**Adoption gate (restart §8):** ≥15 estimate-chase sends/week for 2 consecutive weeks (baseline ~0) and the owner says "keep it," else stop. The gate date moved from 2026-10-01 to **2026-10-15** (§8 amended) so the follow-up queue could be rebuilt as the [Chase Board](#chase-board) first (#89). Metrics captured daily in `metrics_snapshot`; baseline frozen pre-agents.

### Agents Page, Routine Calendar & Activity Feed

**Paths:** `/agents` · `/agents/routines` · **Catalog:** `lib/agents/catalog.ts` · **Registry:** `lib/routines/registry.ts`

- **Agents & automations catalog** (#86): `/agents` opens with plain-English cards — **Running now / Built but not running** — giving name, what it does, **why**, who it helps, when it runs and what it delivers. Status (Running / Off / Trial · off / Halted) is live from `agent_config`, the kill switch and env gates, with the reason shown. Below: a **Scheduled reports** table and a collapsed **Planned, not built** list. Display names (code keys unchanged): Dez: Ask HDPM · Daily Ops Brief · Activity Reminders · Stuck Estimate Chaser · Maintenance Follow-up Queue · Estimate Drafter · Open Estimates Card · AppFolio Form Filler · Inspection Notice Card · Cheryl's Morning Seven.
- **Run log** (#91): every cron route exports `GET = withCronRun(handleGET)` (`lib/cron/run.ts`), recording each cron-bearer call in `routine_run`; `{halted}` / `{skipped}` / `{disabled}` responses are recorded as such, so silent no-ops are visible. The wrapper only observes — each route keeps its own auth, and crons run unchanged if `routine_run` is missing. `registry.test.ts` fails if the registry and `vercel.json` drift or a cron isn't wrapped.
- **Routine calendar** at `/agents/routines`: Monday–Sunday grid in Pacific time, coloured by last run; click a block for owner, recipients, next run and the last 20 runs.
- **Activity feed** (`GET /api/agents/activity?since=`): merges routine runs, proposals, outbox sends, chase and parts events, human `wo_event`s, `dez_activity` and `brain_ingest_log` (each source fails soft). The `/agents` hero shows the motion number (human actions, last 7 days vs prior week), the gate countdown, the feed (polled every 20s) and agent cards with status orb, L0–L4 ladder, last/next run and recipients.

---

## Company — the EOS Layer

**Path:** `/company/*` (Company in the top nav, five tabs) · **Docs:** `docs/hdpm-os/06-eos-operating-layer.md` + `docs/hdpm-os/briefs/phase2-briefs.md`

The management loop: scorecard → issues → weekly meeting → decisions → to-dos → memory. Slack is the notification surface (cards, one-tap actions); these screens are where the deep work happens. Shipped as Phase 2 briefs 2A–2E (2026-08-04); no data here is ever agent-"solved" — agents file and draft, humans decide.

| Tab | Path | What it does |
|-----|------|--------------|
| **Scorecard** | `/company/scorecard` | 8-week grid of the 7 weekly metrics vs goal, red/green with sparklines. Auto-fills Friday 3 PM from `metrics_snapshot`; manual metrics entered inline (owners get a Friday Slack nudge). Two weeks off-track auto-files an issue. [→ Issue] on any metric. |
| **Issues & To-Dos** | `/company/issues` | The priority-ordered IDS queue with an evidence side-panel driven by `source_ref` (metric history, work-order + AppFolio links, or the to-do chain). Issues arrive from the escalation ladder, the scorecard, or + Issue. Solving requires an outcome (decision and/or to-dos). Below it: the 7-day to-do list — missed to-dos roll once (owner gets one nudge), then file as issues. |
| **Meetings** | `/company/meetings` | This week's L10 + archive. The runner is a standing-agenda stepper with per-step timer (Segue → Scorecard → Rock review → Headlines → To-do review → IDS → Conclude). The Monday prep packet renders up top. Conclude fans confirmed to-dos out as Slack cards and files minutes + decisions into the brain. |
| **Rocks** | `/company/rocks` | Quarter board by owner with on/off/done/dropped badges + past-quarter archive. Owners get a one-tap On/Off Slack check every Friday. |
| **Org** | `/company/org` | Read-only accountability chart: the 11 seats with roles, owned metrics, active Rocks, and the agents attached to each seat (agents under seats, never as seats). |

**Escalation ladder** (weekdays 7:15 AM PT): tripwire exceptions aged 21+ days or genuinely recurring, estimate-chaser escalations, and twice-missed to-dos each auto-file an issue — deduplicated against open issues by `source_ref`, capped at 10 per rung per run (worst-first, deferred counts reported). The system escalates visibility, never applies pressure.

---

## Company — Timekeeping

**Path:** `/timekeeping` under Company. [Setup and pilot guide](docs/timekeeping-setup.md) · [Scope and workflow](docs/timekeeping-plan.md).

Staff use **Company → Timekeeping** for live timesheets. Every new period fills from saved employee defaults (company defaults until customized). Admins can edit any employee’s usual week in **People & defaults** and apply it to untouched days on an existing sheet. The fictional preview has been retired; old preview links redirect to Timekeeping. New schedule settings start at 7:00 AM–4:30 PM with a noon–1:00 PM unpaid lunch and 20 minutes of paid rest breaks; employees can choose their own lunch window. Times display in AM/PM with 15-minute choices and exact daily exceptions. Weekend work and emergency work/phone flags are supported; LOA belongs in comments.

Employee sheets cover the 1st–15th and 16th–month-end, with personal schedule defaults, live clock/breaks, manual exceptions, leave, miles and notes. Hourly and salary employees both enter time. Employees digitally sign using their Microsoft company session; the app records their identity, server timestamp and signed version. A separate assigned manager approves before admins export a saved Excel payroll package. Admins retain all historical detail and export versions; employees see one active sheet plus their submitted timecards in **My history**, with approval status and read-only detail.

**Editing while clocked in (#125):** a running clock no longer locks the whole sheet. Days before today stay editable; today and later stay read-only (dimmed) until clock-out, and the database rejects changes to them. Submit and "Apply defaults" still require clocking out. Every save writes a `timekeeping_event` row; clocked-in edits are labelled "Edited earlier days while clocked in" in *Change and approval history*. Migration: `20261008_timekeeping_edit_past_days_while_clocked_in.sql`.

---

## Company — The Desk (demo)

**Path:** `/desk-demo` (sidebar: Company → *The Desk (demo)*) · **Section:** `desk_demo` (admins by default; switch on per person or role) · **Plan:** `docs/habu-desk-plan.md`

Stage 0 of the Desk plan: a clickable demo for team buy-in — **sample data only; nothing is saved, printed, uploaded, sent or written to AppFolio** (#85). Each guided step shows *"Today on paper"* next to *"With the Desk"*. Screens: a desk per person (**In**, **Waiting on**, **Passed on**), an office view of where every folder is, a folder panel (documents by stage Prefilled → On paper → Scanned back → Filed in AppFolio, routing slip, back of the sheet, history), and print-preview / QR scan-back / file-to-AppFolio dialogs.

- **Gold · Vacancy** (VT-118) — 12 steps, using the real form names (30 Day Notice to Vacate, Confirmation, Vacancy Tracking) (#85, #87)
- **Green · New tenant setup** (NT-219) — 12 steps from the setup packet to eight filed documents (#87)
- **Blue · Owner onboarding** (OW-14) — 13 steps following the New Owner Information Packet, with a required-items gate before the home is released to advertise; routing is still a draft for the team to correct (#88)

---

## Company Brain

**Docs:** `docs/hdpm-os/04-gbrain-company-brain.md` · **Tables:** `brain_chunk`, `brain_node`, `brain_ingest_log` (pgvector)

Institutional memory with citations. Content flows in from the Notion SOP corpus (weekly sync), EOS decisions (`decision:<id>`, ingested at solve time), and meeting minutes (`meeting:<id>#n`, ingested at conclude) — all idempotent on `source_key`. A nightly consolidation cron ("dream cycle") summarizes, reconciles contradictions, and decays stale salience. Retrieval is hybrid (vector + full-text); `think()` produces cited syntheses and powers the Knowledge Chat, the Ops Brief's memory context, and the Monday meeting-prep packet. Humans correct the record via `human_correction` chunks that supersede the old fact. [Knowledge Capture](#knowledge-capture) adds owner and property knowledge as brain nodes and chunks.

### Brain Map

**Path:** `/brain` (sidebar: Brain map) · **Section:** `brain` (PM roles by default) · **Brief:** `docs/agent-os/15-brain-anatomy-rebuild.md`

A 3D map of everything Dez knows (policies, SOPs, Oregon law, company memory) and how often each piece is cited. Plain three.js (no react-three-fiber — Next 16's App Router runs its bundled React 19).

- **Nightly snapshot** (#92, #93): `/api/brain/cron/snapshot` at 10:30 UTC builds a JSON snapshot in the private `brain-viz` storage bucket. Each document's chunk embeddings are averaged (`brain_viz_doc_emb`) and its top neighbours found in pages, so the run fits the database statement timeout (it writes what it has if paging passes 200s). Citation heat comes from the last 90 days of `dez_activity.detail.cited`; routine nodes take their colour from their last `routine_run`. Restricted chunks, nodes and their edges are excluded in SQL. Migrations `20261003_brain_viz.sql`, `20261004_brain_viz_paged_knn.sql`.
- **Anatomical layout** (#108, #109): one lobe per layer — Core → frontal, Skills → parietal/motor, Memory → temporal, Routines → cerebellum, Integrations → brainstem, Dez → thalamus (vision reserved). Left half = **Taught** (knowledge docs and intake routines), right half = **Learned** (brain docs and routines where Dez acts). Opens exploded and settles inside a faint skull; explode slider and view presets; citation beams pulse from Dez to the most-cited documents. Layout runs in the browser (`lib/brain/anatomy.ts`) from the same snapshot.
- **Search / Ask:** title search filters as you type; Enter runs a meaning search (`/api/brain/search`); **Ask** goes through `askRAG` (`/api/brain/viz/ask`). Results light up a relevance scan by score, everything else goes nearly dark, and a results list shows each match's score and region. Click a node for its title, source link, excerpt, citation count and neighbours.
- **Access** (#94): `/api/brain/viz*` goes through the normal session + section gate; only `/api/brain/cron`, `/api/brain/search` and `/api/brain/think` stay public (they guard themselves with `CRON_SECRET` or a service token).
- **Brain 2:** the original galaxy view lives at `/brain-2` (section `brain_2`), off the menu since #124.

---

## Knowledge Capture

**Path:** `/knowledge-capture` (sidebar: **Admin** → Knowledge Capture) · **Section:** `knowledge_capture` · **Spec:** [`docs/knowledge-capture.md`](docs/knowledge-capture.md) · **Code:** `lib/knowledge-capture/` (#140–#144)

Matt and Penny carry years of knowledge about owners and properties that isn't written down anywhere — who to call, what an owner will and won't pay for, which vendor knows the crawlspace. Knowledge Capture lets them talk it through one owner or property at a time, so it stays in the company brain. Dez and agents pick it up through ordinary brain retrieval (`searchBrain` / `think`).

**Access (#141):** only **matt@, penny@ and craig@highdesertpm.com**, via a fixed `allowedEmails` list in `lib/access/sections.ts` that beats every role, role default and User settings switch — other admins don't see it either. Enforced in the proxy, `requireSection` (page + all APIs) and the sidebar; User settings shows it locked with the three names. The page lives outside `/admin` so the proxy's admin-role gate doesn't apply.

**Flow**
1. **Pick a subject** — every active AppFolio **owner** (owner sets split into people) and **property**, from the same cached daily AppFolio pull as Fee Management (`lib/fee-management/facts-cache.ts`). Coverage progress bars and a "Not captured yet" filter show what's left.
2. **Add knowledge three ways:** **record in the browser** (pause/resume, 45-minute cap per take), **attach a voice memo** (25 MB max), or **Type or paste** (#144) emails, text threads or old notes in a popup. A typed note is a take with no audio (`mime_type = text/plain`, the text as its transcript) and runs through the same pipeline. Interview prompts sit beside the recorder.
3. **Upload** straight to the private `knowledge-capture` Supabase bucket with a signed upload URL (no API body limit).
4. **Process** (`POST /api/knowledge-capture/recordings/:id/process`):
   - **Transcribe** with OpenAI Whisper (`whisper-1`, prompted with local place names; override with `KC_TRANSCRIBE_MODEL`)
   - **Distill** into structured notes with Claude — only what the speaker said; anything unclear goes under "Open questions"
   - **Ingest** into the brain (`brain_chunk`, domain `company`, sensitivity `internal`): transcript windows as `kind=fact` (author `human:<email>`), notes as `kind=summary` (author `agent:knowledge-capture`), on `owner:appfolio:<id>` / `property:appfolio:<id>` brain nodes linked by `owns` edges
   - **Rebuild the living profile** from all of the subject's takes: stored in `kc_profile`, written to the node's `brain_node.summary_md`, and ingested as a high-salience chunk
5. **Read** — each subject shows the profile and every take (audio, transcript, notes), retry for failed takes, delete, and **Rebuild profile**.

**Transcript editor (#140):** **Edit** on a take opens its transcript under the audio player. Saving keeps the first machine transcript in `transcript_original`, records who edited it and when, and rebuilds that take's notes, brain chunks and the profile from the corrected text. Audio isn't re-transcribed, and Retry never overwrites an edit.

**Both Matt's and Penny's take (#143):**
- **Who's talking?** chips (Matt / Penny / Craig, multi-select, default = whoever is signed in) stored as `kc_recording.voices`, separate from who pressed record — so joint conversations and takes recorded on someone else's laptop are attributed correctly.
- **M/P dots** per owner and property (filled = that person's take exists), plus **Needs Matt's take** / **Needs Penny's take** filters (covered by someone, not yet by that person). The profile header reads e.g. "Matt: 3 takes · No take from Penny yet".
- Notes attribute judgment calls to the person; in a joint take only when it's clear who said them.
- Once more than one person has contributed, the profile adds **Perspectives** — each person's take plus "Where they differ"; one view never overwrites the other.
- Anyone whose voice is in a take, or who recorded it, can edit or delete it (admins: any).

**Owner record linking (#142, `kc_owner_link`):** profiles are already per person, not per ownership group ({John, Mary} and {John, Bob} → one John profile; Bob keeps his own). The **Linked records** card handles the rest:
- **Same person** — duplicate records merge into the viewed profile. Recordings keep their original record id and resolve to the kept profile when read, so **Unlink** splits them back into two profiles. (Merging a record that already had its own duplicates moves those onto the kept profile; unlinking undoes only the record you unlink.) Brain edge: kept `supersedes` duplicate.
- **Related** — a trust or LLC, spouse or partner: separate profiles that name each other, optional note, `related_to` edges both ways.
- **Not the same** — dismisses a suggestion.
- **Suggestions** — same email, phone or exact name → likely the same person; overlapping names (John Smith ↔ John Smith Family Trust) → likely related. Shown as a "Possible duplicates" filter, a **Check** badge and a "Possible matches" list. A person always decides; nothing merges automatically.

**iPhone (#144):** works in Safari on iPhone — recording uses `audio/mp4` (keep the screen open; iOS pauses the mic on lock or app switch); voice memos attach from Files and are recognised by extension when there's no MIME type (m4a, mp3, wav, aac, mp4, webm); inputs are 16px so Safari doesn't zoom; on phones the list and profile are separate screens with an "All owners / All properties" back link; the Type-or-paste box stays above the keyboard and asks once before discarding unsaved text.

**Reliability (#147):** processing claims a take atomically (a double click can't pay twice); runs past Vercel's 300s limit show **Timed out — Retry** instead of hanging; a profile failure never undoes a take that's already in the brain, and a failed brain save fails the take loudly; two takes finishing together can't drop one from the profile; deleting is blocked while a take processes. In the browser, switching to another owner/property mid-recording asks first, recordings auto-stop near 24 MB (iPhone may ignore the bitrate), and typed notes are capped at 60k characters.

**Setup:** apply `20261014_knowledge_capture.sql` (creates `kc_recording`, `kc_profile` and the private bucket), `20261015_kc_owner_links.sql` and `20261016_kc_voices.sql` (apply before deploying code that reads `voices`). Uses the existing `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

**Not yet:** editing the profile directly (correct the transcript or record a correction take instead), unit-level subjects, vendor profiles.

---

## KPI Dashboard

**Path:** `/dashboard` · **Section:** `kpis` (Admin group, admins by default; delegable — see [Delegated admin](#user-settings--delegated-admin))

The **Management Fee Index** (doors per fee band, potential-revenue scenarios) added in #70 now lives in [Fee Management](#fee-management); the Annual Mgmt Fees tile stays here. KPI settings writes (`PUT /api/config`) remain admin-only.

Executive operations dashboard surfacing thirteen KPI cards that track the health of the portfolio. Every card shows a primary metric, a secondary context metric, a 40px sparkline of recent history, a delta arrow (direction + sentiment), and a data-source tag (`live`, `mock`, `estimated`). Cards are clickable for drill-down detail.

### KPI Cards

| Card | Primary metric | Secondary / context |
|------|----------------|---------------------|
| **Delinquency Rate** | % of tenants past due | Count and dollar amount outstanding |
| **Vacancy Rate** | % vacant | Vacant / total units |
| **Work Order Cycle Time** | Avg days to close | Open work order count |
| **30-Day Notice Volume** | Notices given | Rolling 30-day window |
| **Insurance Compliance** | % compliant | Compliant / total owners |
| **Owner Retention** | Retention % | Cancellations + active owner count |
| **Maintenance Cost %** | % of gross rent | Dollars spent vs rent roll |
| **Avg Days to Lease** | Avg days vacant-to-leased | Fastest / slowest in range |
| **Lease Renewal Rate** | Renewal % | Renewals vs move-outs |
| **Properties / Doors** | Doors under management | Monthly net change + 1,500-door goal |
| **Guest Card Volume** | Weekly guest cards | Source breakdown + WoW / MoM delta |
| **Leasing Funnel** | Guest-card → lease conversion % | 4-stage funnel + avg first-response time |
| **Annual Management Fees** | Properties billed | Annualized fee total |

### KPI Trends

**Path:** `/dashboard/trends`

Historical charts for every KPI above with multi-metric overlays.

- **Date ranges:** 4 weeks, 8 weeks, 12 weeks, 6 months, 1 year, 2 years, all-time
- **Chart types:** area, line, bar, and composed charts from Recharts (e.g. delinquency line-over-area, work orders line-over-bar, maintenance cost stacked bars, net doors with goal reference line)
- **Per-chart stat pills:** current, high, low, average for the selected range
- **Year boundary markers** so long date ranges remain readable
- **Custom tooltips** with properly formatted percentages, currency, and durations

### Daily KPI Snapshots

A Vercel cron job runs **daily at 2:00 PM UTC** hitting `/api/kpi/cron` to capture the current value of every KPI into `kpi_snapshots`. The trends page reads from this snapshot table (paginated past Supabase's 1000-row cap), and the dashboard uses a cached endpoint (`/api/kpi/cached`) for fast page load.

---

## Inspections

**Path:** `/maintenance/inspections`

Manages biannual property inspections across ~850 doors. The system tracks every property, schedules inspections on 6-month cycles, and builds optimized driving routes. Inspection records are loaded by importing XLSX/CSV exports and by syncing inspection candidates from AppFolio.

### Inspection Queue

The main inspections page shows all properties with their inspection status, due date, and assigned inspector.

**Statuses:** Imported > Validated > Queued > Scheduled > In Progress > Completed

**How to use:**
1. Load inspections via XLSX/CSV import or the AppFolio candidate sync (see below)
2. Each property gets one inspection. When completed, the next one is auto-created 6 months out
3. Filter by status, city, assignee, or search by address
4. Bulk update: select multiple inspections to change status, assignee, or priority at once
5. 12-Month Summary tab shows a calendar view of inspection volume

**Key rules:**
- Inspections require **7 days minimum lead time** before the scheduled date (Oregon tenant notice law). The notices themselves go out from AppFolio (no send API); the app tracks them — see [Send Notices](#send-notices). Operator SOP: `docs/inspection-creation-sop.md` (refreshed to match the app in #121).
- When an inspection is completed, the system automatically creates the next biannual inspection due 6 months later
- Unit numbers are tracked and displayed for multi-unit properties

### CSV / XLSX Import

**Path:** `/maintenance/inspections/import`

Three-step wizard for bulk-loading inspection records from spreadsheets (used for the initial backfill from AppFolio exports and for one-off batches).

1. **Upload** — drag-and-drop a CSV or XLSX file; headers are auto-detected.
2. **Column mapping** — headers are auto-matched to the 10 supported fields (`address_1`, `city`, `zip`, `unit_name`, `resident_name`, `last_inspection_date`, `inspection_type`, `due_date`, `owner_name`, `priority`, `notes`). Required columns are marked with `*` and a live preview table shows the first rows.
3. **Review & commit** — shows counts for valid / warning / error / duplicate rows with per-row issue detail. Valid and warning rows are pre-selected; errors must be resolved or deselected before committing.

Each import is recorded in `import_batches` for audit, and the commit step writes through the same validation pipeline used by the AppFolio candidate sync so unit matching stays consistent.

### Geocoding

Properties must be geocoded before they can be added to routes (the route optimizer needs lat/lng coordinates).

**How to geocode:**
1. Click **Geocode** button on the inspections page
2. Only processes properties with status `pending` or `failed` — already-geocoded properties are skipped
3. Uses Google Maps Geocoding API in batches of 10 with rate limiting
4. After a sync, just run geocode to process the new ones

### Route Builder

**Path:** `/maintenance/inspections/routes`

Creates optimized driving routes for inspectors. Groups properties geographically and uses nearest-neighbor routing to minimize drive time.

**How to create a route:**
1. Go to Route Builder
2. Set the date range (must be 7+ days out for tenant notice compliance)
3. Assign an inspector
4. Click **Generate** — the system auto-selects the most urgent inspections and builds an optimized route

**Pick Properties — unroutable picks (#120):** inspections the Candidates review holds back are greyed out and can't be ticked, each with its reason (*Needs confirmation*, *Already handled / not due*, *Excluded from routine inspections*, *Not matched to an AppFolio unit*) and "resolve on the Candidates page", sorted last. City chips and **Select all** count only routable rows. If route creation still finds a blocker (it re-checks with fresh evidence), the 409 names the addresses and reasons (`lib/inspection-route-blockers.ts`, `GET /api/inspections/routes/blocked`).

**Routes feed Send Notices (#126):** scheduling from Route Builder now saves `target_date`, `route_plan_id` and `assigned_to` on each inspection, like the Candidates scheduler, so its tenants appear in Send Notices (migration `20261009_route_builder_inspection_target_dates.sql` backfills upcoming routes).

**Outlook route sheets (#135):** each stop shows the property name (or a legacy short code), never AppFolio's internal UUID. Events published earlier keep the old text until **Republish to Outlook**.

**Routing algorithm:**
- **Address clustering:** All units at the same physical address are always grouped on the same route day. A 16-unit apartment complex at 2796 SW 23rd becomes one day's work, not spread across weeks.
- **Dedicated days:** If a single address has enough units to fill a route (>= max stops), it gets its own dedicated route day automatically.
- **City clustering:** Properties are grouped by city (Bend, Redmond, Sisters, Prineville, La Pine, Madras) since Central Oregon cities are 20-40 min apart.
- **Priority sorting:** Overdue inspections first, then by due date, then by priority level.
- **Route optimization:** Nearest-neighbor TSP starting from HDPM office (1515 SW Reindeer Ave, Redmond). Can be further optimized with Google Directions API.

**Unit numbers in routes:**
- Each stop displays the address with a prominent unit number badge (e.g. **#101**, **#A**)
- Multi-unit buildings show all their units in sequence with 0 min drive time between them
- Unit numbers come from the imported / AppFolio inspection data

**Using a route on inspection day:**
1. Open the route from Route Builder
2. Each stop shows address, unit number badge, drive time, due date, and service time
3. Click **Start Inspection** — begins the inspection
4. Click **Complete** when done, or **Skip** to return it to the queue
5. Use **Flag Issue** to mark problems found during inspection
6. When all stops are done, the route auto-completes

### Inspection Candidates

The AppFolio candidate sync (daily) proposes which units are due; the Candidates review groups them (Ready to schedule, Needs confirmation, Already handled, …).

- **Release on removal (#127):** deleting a route, clearing a day or skipping a stop now resets the unit from `'scheduled'` back to `'eligible'` (`lib/inspection-candidate-release.ts`), so it regroups normally. A **Return to queue** button handles scheduled rows that need confirmation; migration `20261010_release_stale_scheduled_candidates.sql` released units already stuck.
- **Link to unit (#128):** a completed routine inspection that matched no AppFolio unit can be linked to the right one (unit search prefilled with the street number). Linking moves the inspection, deletes the stray never-scheduled follow-up, re-runs the completion cascade (last inspected, next due +6 months), moves the unit's open routine inspections to the new due date, and writes an audit entry.
- **Add Ready units to the queue (#128):** checkboxes, select-all, **Add N to queue** and a per-row **Add to queue** create (or reuse) a queued inspection without scheduling, after a fresh AppFolio check — so the units show up in Route Builder → Pick Properties. Never duplicates; units already on a route are left alone.

### Send Notices

**Notices v2 (#129) — letter-first.** Tenant notices are still sent from AppFolio (no API); the app makes that step fast and hard to get wrong.

- **Change date** on a route (7–21 days out, only before any stop starts) moves the route, its inspections' `target_date`, stop arrival times and the Outlook event. Tenants already told the old date return to Send Notices with a **Date changed (was …)** badge and "Updated" notice text; the same re-queue applies whenever an already-noticed inspection lands on a new route.
- **Grouped by route:** date, arrival window (e.g. "between 8:30 AM and 1:00 PM"), assignee and each unit's estimated arrival.
- **Re-check tenants:** pulls live tenants from AppFolio and warns about a changed tenant, a move-out on or before the visit, a vacant unit, or no email. Each unit lists who to tick in AppFolio (financially responsible occupants).
- **Per-unit sent:** checkboxes + **Mark selected sent** replace mark-all; records `notice_sent_by` and warns if marked less than 7 days before the visit (migration `20261011_inspection_notice_tracking.sql`).
- **Letter first, Realm-X behind a switch:** notices go through the AppFolio letter template. The **Copy Realm-X request** (paste-ready text for Realm-X Assistant) stays hidden until `NEXT_PUBLIC_REALMX_ENABLED=1`, since Realm-X isn't on HDPM's AppFolio plan yet.
- **Office phone (#137):** notice text, the letter and the Realm-X message give **(541) 548-0383** (the office), not the AI leasing line.
- **Dez card** (behind `DEZ_INSPECTION_NOTICES=1`): one Slack card per route with the window and request text; reposts as "Date changed" after a move; Route Builder triggers it too.

---

## Craigslist Ad Creator

**Path:** `/craigslist`

Generates professional, HTML-formatted Craigslist rental listings from AppFolio vacancy data.

**Workflow:**
1. Open the Craigslist tool — cached vacancies load instantly from Supabase
2. Click **Sync Vacancies** to pull fresh data from AppFolio (upserts new units, removes ones no longer vacant)
3. Optionally toggle **Rently** on for units with self-guided tour access and enter the Rently URL
4. Click **Generate Listing** — Claude AI creates HTML-formatted copy
5. Review the preview (shown first by default)
6. Click **Copy HTML to Clipboard** and paste directly into Craigslist's posting body
7. Use **Download All** or **Open All in Tabs** for photos, then drag into Craigslist's image uploader

**Listing format:**
- Quick-glance summary table (rent, beds, baths, sqft, availability)
- "About This Home" section with neighborhood context
- "Features & Amenities" bullet list with bold key selling points
- "Apply Now" link to rentzap.com
- "Questions? We're Available 24/7" contact block with phone and website
- Rently self-guided tour block (when enabled)
- Professional disclaimer footer with HDPM address
- All HTML uses Craigslist-compatible tags only (`h2`, `table`, `ul`, `b`, `hr`, `a`, `p`)
- Section headers in HDPM brand green (#2c4a29)

**Editing:**
- Preview is the default view for quick copy-paste workflow
- Expand **Edit HTML Source** to modify the title, Rently URL, or body HTML
- Changes reflect live in the preview above
- Click **Save** to store listings in Supabase for history/re-use

**Photos:**
- Automatically scraped from AppFolio's public listings page
- Craigslist strips `<img>` tags — photos must be uploaded through their image uploader
- **Download All** saves images as files you can drag into Craigslist
- **Open All in Tabs** opens each photo in a browser tab for drag-and-drop

**Vacancy caching:**
- Vacancies are cached in Supabase so the page loads instantly
- **Sync Vacancies** pulls fresh from AppFolio, upserts new/changed units, and removes stale ones
- Units that get rented disappear automatically on next sync

---

## Invoice Generator

**Path:** `/maintenance/invoices`

Creates maintenance invoices from three input sources:

1. **AppFolio Work Orders** — pull open work orders and generate invoices with auto-populated line items
2. **CSV Upload** — import invoice line items from spreadsheets
3. **PDF Scan** — extract invoice data from scanned/photographed PDFs using Claude AI

**Features:**
- Line items with Type (Labor/Materials/Appliance/Other), Qty, Price, Extended (auto-calculated)
- Internal cost + markup model: materials/appliance lines carry internal cost with default markup (**25% materials, 10% appliances**); the owner-facing PDF is cost-blind (shows only the marked-up price)
- Default labor rate $95/hr with after-hours/emergency toggle (1.5x = $142.50/hr)
- Claude AI rewrites work descriptions into professional invoice language — now the shared **Improve with AI** control (#114): a reviewable suggestion you apply or ignore (`/api/invoices/rewrite-description` re-exports `/api/maintenance/improve-copy`)
- Auto-extracts materials and line items from descriptions
- PDF export with HDMS branding (Qty/Price/Extended columns, subtotals, totals)
- Auto-save with 2-second debounce
- Internal notes pre-populated with full work order reference data
- Status tracking: Draft → Generated → Attached (Void to cancel); "paid" is separate — an invoice is paid once it's linked to a payment in the Reconcile tab
- **Invoice reporting periods** — the invoice list, Billable report, and Daily Labor & Markup report share a **Period preset** selector for the three most recent payroll periods (1–15 / 16–month end) and Monday–Sunday weeks, using Pacific calendar dates. Custom date ranges remain available.
- **Daily Billing Review** (Work & Billing → Reports, `/maintenance/daily-billing`) opens on the **current pay period** (1–15 / 16–month end, Pacific) with **This pay period / Last pay period** buttons; weeks remain in the dropdown and `?date=` still opens a single day (#110)
- **Markup report** — select invoices on the Invoices tab → "Report from selection" for an internal cost/markup/charged breakdown (materials vs appliances), with CSV export and print

### Payment Reconciliation (Reconcile tab)

AppFolio pays HDMS out of the Client Trust Account as lump ACHs covering many invoices. The Reconcile tab is the ledger that ties those payments back to individual invoices:

- **Capture ACH payment** — record a trust-account payment (date, amount, payee, reference) as an "open" payment, with or without invoices attached yet
- **New reconciliation** — select the invoices a payment covered and attach them. Attaching sets `payment_id` on each invoice (that link *is* the paid state) and snapshots the payment's totals: labor / materials / appliances / other / invoice total. Snapshots are recomputed only on attach/detach so the ledger stays stable as an audit record even if an invoice is edited later
- **Reconcile Payment modal** — shows the selection split as five cards (Labor / Materials / Appliances / Other / Total) plus a **tie-out check**: the buckets must reconstruct the invoice totals to the cent, or an amber warning shows the exact variance before you record. Variance vs the payment amount (short/over/balanced) is shown live
- **AppFolio billing view** — HDMS-vendor bills synced from AppFolio (`af_bills`), auto-matched to invoices by reference (~91%); work the unmatched/mismatched remainder by hand
- Payments are fully reversible: deleting a payment (or detaching invoices) reverts the invoices to unpaid and re-snapshots

One-time backfill after schema changes: `npx tsx scripts/recompute-payment-snapshots.ts` re-splits every payment's snapshot from its linked invoices' line items (idempotent).

### Owner vs Tenant Charges

Every HDMS invoice says who pays — **Owner charge** or **Tenant charge** — and never both (#111). First piece of the field time & recovery plan ([`docs/field-time-recovery-plan.md`](docs/field-time-recovery-plan.md); the GPS plan is kept as its phase 2 reference, #113).

- **One payer per invoice:** `charge_to` is an invoice column, so a job with both is billed as two invoices. Existing invoices default to Owner charge (migration `20261006_invoice_charge_to.sql`).
- **Invoice form:** required **Charge to** control. Tenant shows name, unit, reason (Tenant damage / Lease fee / Other), lease clause and an internal note on what happened and the evidence.
- **Tenant prefill (#138):** `GET /api/invoices/tenant-lookup?address=&unit=` matches the WO's address and unit against `inspection_properties` (kept current by the nightly AppFolio sync) and fills the financially responsible occupants' names and the unit — one match fills, several households show pick buttons, no match asks for the name as on the lease. Never overwrites a typed name or a locked/posted charge.
- **Basis rules (#139, migration `20261013_tenant_charge_basis_at_posting.sql`):** generating a tenant invoice needs only tenant, unit and what happened — Reason and Lease clause are "(optional — the office can add it)". **Posting** to the tenant ledger requires the reason, plus the lease clause for a lease fee (ORS 90 basis); the Daily Billing card asks for missing items inline. A reason or clause already set is never rewritten.
- **Locks:** a credit memo must charge the same party as the invoice it corrects; the payer is fixed once the invoice is attached in AppFolio or the tenant charge is posted — after that, void and reissue.
- **PDF:** **OWNER CHARGE** / **TENANT CHARGE** label plus a "Charged to tenant" block; the internal note stays off the PDF.
- **Invoice list:** Owner/Tenant badge, an **Owner + tenant / Owner / Tenant** filter, search by tenant name.
- **Daily Billing Review:** a **"Post tenant ledger charge in AppFolio"** item per generated tenant invoice with **Mark tenant charge posted**. The owner pays HDMS's bill as usual; the tenant ledger charge reimburses the owner.
- **HDMS reconciliation:** a WO with two invoices now sums every live invoice and labels it owner, tenant or both.
- **Not yet:** automatic owner + tenant split of one workspace job, an AppFolio tenant picker, owner/tenant columns in billable reports.

---

## Rent Comps

**Path:** `/comps`

Rental market analysis combining three data sources:

- **AppFolio** — current portfolio rental rates and vacancy data
- **RentCast** — advertised rental comparables (with similarity, distance and listed dates) and a rent estimate
- **Rentometer** — market comparison data by address
- **HUD Fair Market Rent** — government baseline rates by area (synced annually)
- **Zillow** (via `/api/comps/zillow`) — supplemental public-listing data when available

### Comps Dashboard

The main `/comps` page is a data-exploration interface: filter comps by date, town, bedroom count, or data source; toggle between table and chart views; and review stats cards comparing portfolio averages against HUD and market baselines. Manual comps can be added via **Add Comp**, and the embedded Rentometer widget runs ad-hoc lookups. HUD baselines are seeded automatically via `/api/comps/seed-baselines` and refreshed each January.

### Comps Analysis Wizard

**Path:** `/comps/analysis`

A three-step wizard that produces a shareable comp report for owner presentations:

1. **Enter subject property** (address, beds/baths, sqft, current rent)
2. **Pull comparables** from AppFolio, Rentometer, Zillow, and HUD; the system applies weighted similarity scoring on bedrooms, bathrooms, sqft, and distance
3. **Generate report** — produces a branded PDF with summary stats, comp table, and recommended rent range; saved analyses are accessible from the "Saved reports" list for re-use

### Rent Analysis Reports

Owner-facing PDFs from the analysis wizard (`lib/rent-report-pdf.ts`).

- **Owner links (#118):** `/r/<id>` short links open **without a staff login** (`/r/` is a public proxy prefix — the trailing slash keeps `/reports`, `/routes` gated). Each link has a random 8-character id, expires after 30 days (`report_links.expires_at`) and redirects to a 1-hour signed storage URL. Generated PDFs get a timestamp + random suffix (`lib/rent-report-files.ts`), so regenerating the same property on the same day never overwrites a file already sent.
- **Nearby Rentals (#116, #117):** modelled on AppFolio's *Nearby Advertised Units*, built from RentCast comparables: a rent histogram ($50 bins, median shaded, **your rent** as a dashed column with a house marker on a low → high band) and a table ranked by similarity with ▲▼ sq-ft and rent differences, distance and last advertised date. A page in the PDF and a panel on the Analysis step that updates as you type a rent override (`lib/rent-report-nearby.ts`). Skipped when RentCast returns fewer than 3 comps.
- **Layout fixes (#115):** long notes continue onto the next page ("Notes (continued)"), Market Snapshot stays together, page numbers use the real page count. Competing listings are de-duplicated by address and price and labelled with their real source (RentCast / Zillow / both) — previously RentCast comps were re-appended on each regeneration.
- **Data Sources (#119):** lists only sources that contributed (no "0 data points"), counts RentCast database comps, labels "Advertised rental comps" vs "nearby listings" separately, and shows the one HUD figure used (e.g. "Redmond 3BR Fair Market Rent, $2,336/mo").
- **Standard owner notes (#132, #133, #134):** **Insert standard notes** above "Notes from High Desert Property Management" adds editable text covering how the range was reached (naming only the sources this analysis used), why it's a desk estimate, owner choices that change the rent, and a call to action — "Give us a call at (541) 548-0383". A new analysis auto-fills it when the box is empty; an untouched draft regenerates after a Zillow search, edited notes are never replaced, and reopened saved reports keep their notes.
- The analysis page footer now credits AppFolio, RentCast and HUD Fair Market Rent (#117).

---

## Key Manager

**Path:** `/keys`

Physical key registry for the office key wall: 972 permanent key numbers, each either open (available), assigned to a property, vacant (move-out processed, awaiting reissue), or retired. Key numbers are permanent identities that can be recycled to a different property when freed — full history is preserved in an append-only event log per key.

**Dashboard cards** (each clickable to filter the table):

| Card | Meaning |
|------|---------|
| **Total Keys** | All key numbers in the registry |
| **Assigned** | Keys attached to a property with copies issued |
| **Vacant** | Move-out processed on the key: copies accounted for, waiting for reissue |
| **AppFolio Vacant** | Linked keys whose AppFolio unit has no current tenants — the move-out work queue |
| **Open #s** | Unused numbers available for new properties |
| **Flagged** | Key state disagrees with AppFolio (e.g. key assigned but unit vacant) |

**Copy custody model.** Default issue is 4 copies of the main key: 2 tenant copies (out), plus an **Office** copy and a **Vendor loaner** held in office custody. "X of 4 out" counts only copies issued to someone other than the office. The vendor loaner is checked out to a vendor from the key detail page (vendor-name chips, self-curating list via `/api/keys/vendors`) and checked back in when returned. Extra tenant copies are issued as charged. Additional key types (garage, shed, mailbox…) can be added per key.

**Key detail page** (`/keys/[id]`): status transitions (assign → mark vacant → reissue → release/retire), per-copy tracking with click-to-edit holders (tenant chips from the AppFolio sync), notes, full history feed, and prev/next navigation between key numbers (chevrons or arrow keys).

**Working the move-out queue:** click **AppFolio Vacant** → open each key → **Mark vacant** → record what happened to each outstanding copy (returned / lost) → key moves to Vacant and the flag clears. On the next move-in, **Reissue** creates a fresh copy set.

**AppFolio sync** (hourly at :45) refreshes property/owner/tenant/occupancy snapshots on every linked key and raises flags on mismatches. Owner names are resolved via per-property `/owners` lookups, which are heavily rate-limited — the sync only resolves owners for keys missing one, capped at 60 lookups per run. The AppFolio "Owner Name" property custom field is unused in this account and cannot be relied on.

**Seed import** (`/keys/import`, one-time): parses the master key list spreadsheet, matches addresses to AppFolio units through a tiered matcher (exact → street+unit → direction-insensitive → typo-tolerant), and previews matched / unmatched / open per row before commit. Unmatched rows import as **unlinked** and can be linked to a unit later from the detail page (Unlinked tab tracks the backlog).

---

## Owner Reports

**Path:** `/reports/owner`

Per-owner portfolio report builder used for owner statements, quarterly reviews, and retention conversations.

**Workflow:**
1. Search owners by name (debounced, 2-character minimum)
2. Select an owner to load their full portfolio with unit detail, tenant history, lease dates, and current rents
3. Review the summary header: total properties and units, occupied vs vacant, monthly rent roll, average rent per unit, and longest current tenancy
4. Expand any property to see bedrooms, bathrooms, square footage, current rent, and full tenant history (move-in / move-out dates, lease start / end, monthly rent)
5. Export the report as **PDF** or **Excel** — filenames are date-stamped for easy filing

---

## Admin

**Sidebar:** Admin group · **Landing:** `/admin` (cards for each area) · **Registry:** `lib/access/sections.ts`

| Area | Path | Default access |
|------|------|----------------|
| **User settings** | `/admin/user-settings` | Admins (an admin can never lose it) |
| **Company KPIs** | `/dashboard` | Admins · delegable |
| **Fee Management** | `/admin/fee-management` | Admins · delegable |
| **Partners** (referral program) | `/partners/admin` | Admins · delegable |
| **Leads** | `/admin/leads` | Admins only |
| **Hiring** | `/admin/hiring` | Admins · delegable |
| **Website** | `/admin/website` | Admins only |
| **Zoom Sync** | `/admin/zoom-sync` | Admins only |
| **Knowledge Capture** | `/knowledge-capture` | Matt, Penny, Craig only (fixed list) — see [Knowledge Capture](#knowledge-capture) |
| Paper Workflows · HABU Demo | `/admin/habu-paper` · `/admin/habu-demo` | Craig only |

### User Settings & Delegated Admin

**Path:** `/admin/user-settings` (replaces Staff permissions; `/admin/staff-permissions` redirects) (#83, #84, #130)

- **One registry** — every page area is a section in `lib/access/sections.ts` (menu item, page + API prefixes, default roles). The sidebar is built from it, User settings lists it, and the proxy enforces it: switched-off sections drop out of the sidebar and home tiles, pages redirect home with a notice, and their APIs return 403 (shared APIs stay open if the person has *any* owning section). `lib/access/__tests__/sections.test.ts` fails on unregistered pages.
- **People tab:** each person's **Role** picker (confirmed and audited in `staff_role_audit`; you can't change your own role or demote the last admin) plus a **Role default / On / Off** switch per section, with an optional reason and change history (`staff_section_access`, `staff_section_access_audit`).
- **Roles tab:** toggle each role's default sections, with an **All roles at a glance** grid, "edited" tags and "Reset to built-in" (`role_section_defaults`). Built-in defaults: Admin = everything; Property Manager / Manager / Staff (general) = every non-admin section; Maintenance, Field tech, Inspector, Front Desk, Finance and Read only get role-specific subsets (see `defaultRoles` in the registry).
- **Invoice & estimate abilities** tab: the former Staff permissions page, unchanged.
- **Guardrails:** Dashboard is always on; nobody can be locked out of User settings; only an active DB admin can save (re-checked server-side); optimistic versioning. If the access tables are unreachable, everyone gets role defaults (fails open).
- **Delegated admin areas (#130):** **Company KPIs, Fee Management, Hiring and Partners** are `delegable` — an admin can switch them on for one non-admin person (never via role defaults; shown as "Delegated admin area"). Their pages and APIs check the section live (`requireSection()` / `hasSection()` in `lib/require-role.ts`, 60s cache) instead of the admin role. Still admin-only for delegates: User settings, Leads, Website, Zoom Sync, Partners tax documents (1099/TIN export and W-9 files, tax-ID last-4), and KPI settings writes. First delegate: **Lisa Coffey** (Property Manager), added by migration `20261012_staff_lisa_coffey.sql`.

### Fee Management

**Path:** `/admin/fee-management` · **Section:** `fee_management` (delegable) · **Code:** `lib/fee-management/` · **Tables:** `fee_campaign_config`, `property_agreement`, `fee_campaign`

Read-only AppFolio v0 data (`/properties`, `/units`, `/owner_groups`, `/owners`), cached daily in `kpi_snapshots` (`fee_management_facts`, latest copy only) with a Refresh button. Five tabs:

| Tab | What it does |
|-----|--------------|
| **Owner Fee Opportunity** (#72, #73, #74, #77, #79) | One row per **owner set** (co-owned properties count once). Blended fee % weighted by occupied market rent; target from the editable **door-count schedule** (1 door 10% → 50+ doors 7%, portfolio review) with size-based **max raise steps** and an under-7% floor of at least 1 pt; **Opportunity grade 0–100** (default sort), **Next raise** (one step + raises to schedule), **Priority 0–100** (added $/yr, agreement-end urgency, fee gap), segments (Personal call / Letter / Renewal-timed), campaign editor and funnel, **Fatigue** column, owner **Contact** card first in the expanded row, search by name/email/phone, CSV export. |
| **Fee Index** (#70, #72) | Doors per whole-point fee range with share, occupied, est. fees /mo and /yr; potential revenue from raising the average and minimum-fee floors. Moved here from the KPI dashboard. |
| **Fee Schedule** (#75, #76, #77, #78, #79, #80) | Current vs Proposed values for HDPM's standard fees (lease-up, renewal, setup, maintenance markup, accounting, inspection, eviction coordination, early termination, custom rows) as $ flat, % of a month's rent or % of spend; trailing-12-month AppFolio volumes; cash-flow summary. **Market reference:** regional summary (Central Oregon / rest of Oregon / PNW), 37 sourced company fee schedules, and Oregon rules on tenant-paid fees (not legal advice). **Fee fatigue & churn:** per-owner fatigue index, expected fee-driven churn loss, net-after-churn, break-even doors, size-based churn sensitivity and a large-owner stress test. |
| **Agreements** (#112) | Every owner management agreement, one row per property: Renews (day + month), next expiration (projected from AppFolio's management start when no end date is entered), auto-renew / notice, last renewed, and an "Open ↗" link to the signed agreement in AppFolio (staff paste the link; only `https://highdesertpm.appfolio.com/` links are accepted). Filters for expiring within 30/60/90 days and missing links/dates. Click **Refresh** once after deploy. |
| **Proposed Structure** (#131) | Editable door bands (range, fee %, max step, review flag; validated for gaps/overlaps). Shows the fully-implemented impact per band and portfolio (owners above their band keep their rate), with headline cards for management fees, other fees, total fee revenue and gain after expected churn. **Save schedule** writes the door schedule Owner Fee Opportunity uses. |

### Hiring, Website & Leads

- **Hiring** (`/admin/hiring`, #122, #123): website job applications (résumé/video via short-lived links, **Email again**; unsent ones show "Not emailed"), job availability (open / closed / draft), and application email recipients + "resend since date". Served through an allowlisted proxy `app/api/admin/hiring/[...path]` → hdpm-web `/api/os/hiring` (`lib/hdpm-web-admin.ts`, `HDPM_OS_ADMIN_TOKEN`), sending the staff email as `x-hdpm-actor`.
- **Website** (`/admin/website`, #122): one-click shortcuts into www.highdesertpm.com/admin (posts, pages, jobs, market areas, team, testimonials, media, CRM, campaigns, automations).
- **Leads** (`/admin/leads`, #124): website CRM leads with filters (open / all / status, type, search), overdue follow-ups highlighted, and a detail panel to change status (valid pipeline moves only), owner and next follow-up, add notes and read history. Allowlisted proxy `app/api/admin/leads/[...path]` → hdpm-web `/api/os/leads`.

---

## Referral Partner Portal

**Paths:** `/partners` (referrer-facing, served at **partners.highdesertpm.com**) · `/partners/admin` (staff, sidebar Admin → **Partners**) · **Plan:** `docs/partners/00-referral-portal-plan.md`

A self-service portal for referral partners to send HDPM new-owner leads, plus a staff console to work the pipeline.

- **`/partners`** — partners refer an owner, track the status of their referrals, see their bounty earnings (Earned / Pending approval / Approved / Paid, read through RLS), and sign in through a **secure emailed magic-link** (no password).
- **`/partners/admin`** — staff manage referral partners, the lead pipeline, the fee policy, W-9 / referral-agreement tracking, bounties and payouts. Linked from the sidebar, home Admin tiles and `/admin` (#96); section key stays `referrals_admin`.

**Partner host (#101):** on `partners.highdesertpm.com` (`lib/referrals/partner-host.ts`, applied first in `proxy.ts`), `/` serves the partner dashboard, `/login`, `/leads…`, `/invite/…`, `/auth/…` rewrite to `/partners/…`, staff pages and `/partners/admin` redirect to `os.highdesertpm.com`, and staff APIs return 404. Invite links use `PARTNERS_BASE_URL` when set.

**Bounty ledger (#99, migration `20261005_referral_bounty_ledger.sql`):** the first time a lead reaches **agreement_signed**, a one-time bounty is earned only if it's a referral lead, the referrer is active, the lead isn't a duplicate, the referrer has active bounty terms, and **the fee policy allows that partner type** (every type is still off — the Oregon gate). `fixed` or `per_door` amounts; terms frozen in `referral_fee_agreement`; the append-only `referral_ledger` records `earned` → `approved` (a person) → `paid` (with a reference) or `voided` (with a reason); skipped bounties are recorded with their reason. Admin lead page **Bounty** card; "Bounties to approve" / "Bounties paid" tiles; emails to the referrer when earned and paid.

**Payouts & 1099s (#100):** `/partners/admin/payouts` lists approved, unpaid bounties with a 1099-readiness badge (warning only), downloads a **QuickBooks CSV** (no tax IDs), and **Mark paid** for a batch (`PAY-YYYYMMDD-xxxx`), with payment history by batch. `/partners/admin/payouts/1099` totals paid bounties per referrer per tax year (threshold $600 through 2025, $2,000 from 2026 — "confirm with your accountant") and exports an Excel worksheet with tax IDs masked unless explicitly included (each decrypt logged as `tin_decrypted`). The Referrers page adds a W-9 column with a 2-minute signed **View** link (`w9_viewed`) and **Verify** (`w9_verified`). Tax-document routes stay admin-only even for delegates.

**Fee-income probe (#104, #105):** admin-only `GET /api/partners/admin/spike/fee-income?month=YYYY-MM[&property=…]` tests which AppFolio reports return management-fee income per property (nothing stored, no owner names). Findings in `docs/partners/01-batch-6a-fee-income-spike.md`: **GO, provisionally** — `general_ledger` (GL 5010 "Mgmt: Management Fee") returns per-property fees, pending one owner-statement reconciliation.

**Email safety (#103):** every person-supplied value in the referral email templates is HTML-escaped, and subjects with names are stripped of line breaks.

**Oregon compliance:** paying referral compensation for real-estate activity is restricted to licensed persons. The fee policy enforces this — the compensation model available to a partner depends on their license status (e.g. credit vs. cash + 1099).

**Fonts:** the referrer portal's Plus Jakarta Sans and Inter are self-hosted (#146) — see [Builds](#builds-self-hosted-fonts).

---

## Haven (Leasing & Reception)

**Path:** `/haven`

The AI leasing and reception surface, backed by the Haven integration (conversation sync via `/api/haven/sync`).

- **Leasing pipeline** — inbound leasing conversations synced from Haven, with the stage each prospect sits at.
- **Needs-a-human flags** — conversations Haven has escalated for a person to pick up.
- **Tour scheduling** — self-guided and scheduled tour activity.
- **Reception / call metrics** — main-line call handling and response-time reporting (Haven response-time digest cron + the Zoom reception call report).

---

## Properties Map

**Path:** `/properties/map`

Managed properties plotted on a map: **green** = active under management, **yellow** = pending management-end (from the AppFolio Reports API management-end dates).

---

> **Admin-gated pages:** admin status comes from `staff.access_role = 'admin'`; `ADMIN_EMAILS` survives only as a bootstrap fallback. Which Admin pages a person sees is set in [Admin → User settings](#user-settings--delegated-admin).

---

## AI Chat (ORS 90)

**Sidebar:** Click **Knowledge Chat** in the left navigation

An AI assistant trained on Oregon Revised Statutes Chapter 90 (landlord-tenant law), HDPM policy documents, and Loom training videos.

**Capabilities:**
- Answer questions about Oregon landlord-tenant law with specific ORS section references
- Hybrid search: vector similarity (pgvector) + full-text search for optimal retrieval
- Upload PDFs/emails for legal analysis against ORS 90
- Inline [1][2][3] citations with clickable source sidebar
- Streaming responses via Server-Sent Events
- Team conversation history shared across all @highdesertpm.com users

**Search strategies (auto-selected by query intent):**

| Intent | Example | Strategy |
|--------|---------|----------|
| Phrase lookup | "where does it say 'reasonable wear and tear'" | Phrase search + vector fallback |
| Section lookup | "what does 90.300 say" | Substring (ILIKE) + vector |
| Keyword | "which section mentions late fees" | Full-text + vector (merged) |
| Semantic | "can I charge for carpet cleaning" | Vector primary + full-text supplement |

> The same RAG engine also answers in Slack via **Dez** (below) — the web chat and Dez share `lib/rag.ts` and the `knowledge_chunks` corpus.

---

## Dez — Slack Agent

**Dez** is HDPM's employee-facing agent: one Slack identity between the team, AppFolio, and HDPM's documented procedures. Internal-only — never messages tenants, owners, or vendors (that's Haven / the owner report). Every write is human-triggered. Dez runs **natively inside HDPM-OS** (it reuses the RAG engine, the agent spine, and the Slack app that already exist) — see `docs/dez/00-dez-spec.md` for the full build spec and `docs/dez/slack-app-manifest.yaml` for the Slack app config.

**Phase 1 (live): conversational Q&A in Slack.**
- **Endpoint:** `POST /api/agents/slack/events` — inbound Slack Events API. Free-text **DMs** (`message.im`) and **@Dez mentions** (`app_mention`) are answered from the knowledge base (`askRAG`), with `[1][2]` sources and a `🔧 dez · <scope>` breadcrumb. Signed with `SLACK_SIGNING_SECRET`; acks in <3s and answers in `after()` (RAG is slower than Slack's 3s window).
- **KPI answers:** operational questions like "what's our occupancy?" are answered from the latest `kpi_snapshots`. Financial KPIs (rent roll, fees, delinquency dollars) are gated to an allowlist via `DEZ_KPI_ADMINS`; everyone else gets the operational subset.
- **Loop guard:** never answers a bot/self message (`lib/agents/dez/event-guard.ts`) — the critical correctness property. Slack redelivery is de-duped via the retry header.
- **Router (v0):** channel-of-arrival → scope (`maintenance | leasing | accounting | general`) via `DEZ_CHANNEL_MAP`; DMs → `general` (`lib/agents/dez/router.ts`).
- **Rendering:** `lib/agents/dez/answer-blocks.ts` converts markdown→Slack mrkdwn (`##`→bold, `-`→•), caps the source list at 8 (`+N more`), threads channel mentions but posts top-level in DMs.
- **Interactivity** (existing, shared identity): button taps land at `/api/agents/slack/interact` (estimate-chaser, ops-brief, morning-card, rocks).

**Visibility.** Every Dez interaction and routine is logged to the **`#dez-activity`** Slack feed (`SLACK_DEZ_ACTIVITY_CHANNEL`, unset → no feed) and surfaced in the **"Dez activity" panel on `/agents`**, so the team can see what Dez has been asked and answered.

**Proactive Routines.** Scheduled jobs that read and post as Dez (the cron layer). First one live:
- **ORS 90 new-section watch** (`/api/sync/ors-watch`): the weekly knowledge sync only re-fetches a fixed list of ORS 90 section numbers, so a section the legislature *adds* is invisible until the list grows. This probes plausible not-yet-known numbers monthly and DMs Craig if a real new section appears (oregon.public.law serves soft-404s as HTTP 200, so detection keys on real article content, not status). `?sessionReview=1` (Apr/Aug crons, after Oregon sessions adjourn) also posts a "review the list" reminder.

**Not yet built (fast-follow / gated):** scoped live-data subagent tools and write verbs (Phase 2 — gated behind the restart plan's Loop-1 gate (moved from Oct 1 to Oct 15) + the Sep-4 write-path decision).

---

## Scheduled Jobs (Crons)

Configured in `vercel.json`. All times are UTC.

| Schedule (UTC) | Endpoint | Purpose |
|----------|----------|---------|
| **Every 15 min** | `/api/sync/work-orders?days=1` | AppFolio work-order mirror delta (+ vendor roster) |
| **Every 30 min** | `/api/maintenance/cron/appfolio-webhook-resolve` | Resolve webhook-logged WO events against the mirror |
| **Hourly** | `/api/sync/work-orders?days=7` | Work-order deep pass (webhook safety net) |
| **Hourly at :45** | `/api/sync/keys` | Key Manager ↔ AppFolio sync: tenants, owners, occupancy, flags |
| **15:30–23:30 hourly, Mon–Fri** | `/api/agents/cron/activities?kind=new` | Activity Reminders: Slack DM for newly-due AppFolio activities (8:30 AM–4:30 PM PT) |
| **08:10 daily** | `/api/timekeeping/cron` | Timekeeping: ensure each employee's pay-period sheets exist |
| **9:00 daily** | `/api/sync/appfolio` | Full AppFolio sync: properties, vacancies, comps |
| **9:15 daily** | `/api/sync/af-reports` | AppFolio Reports API pulls (mgmt end dates, …) |
| **9:30 daily** | `/api/inspections/candidates/sync` | Refresh inspection candidates (move-in-anchored cadence) |
| **10:00 daily** | `/api/brain/cron/evolve` | Company-brain nightly consolidation (Knowledge Nightly Review / dream cycle) |
| **10:30 daily** | `/api/brain/cron/snapshot` | Brain map nightly snapshot for `/brain` |
| **10:00 Sunday** | `/api/sync/knowledge` | Knowledge base refresh: ORS 90 + Notion SOPs + OneDrive docs |
| **11:00 Sunday** | `/api/sync/knowledge?target=onedrive` | OneDrive/SharePoint docs re-sync (eTag-incremental) |
| **12:00 1st of month** | `/api/sync/ors-watch` | Dez: probe for newly-added ORS 90 sections; DM Craig on a find |
| **13:00 Apr 5 & Aug 5** | `/api/sync/ors-watch?sessionReview=1` | Dez: post-Oregon-session "review the ORS 90 list" reminder |
| **11:00 daily** | `/api/sync/zoom-contacts` | AppFolio → Zoom Phone contact sync |
| **13:00 Mon–Fri** | `/api/maintenance/cron/tripwires` | Run the 12 tripwires; per-owner exception digests (6 AM PT) |
| **13:30 & 21:30 daily** | `/api/maintenance/cron/metrics` | `metrics_snapshot` capture (agent-layer KPIs + dashboard pipeline) |
| **13:45 Mon–Fri** | `/api/agents/cron/estimate-chaser` | Estimate Chaser: Outlook drafts + SMS queue + escalations (6:45 AM PT) |
| **13:45 daily** | `/api/haven/sync` | Haven.AI conversation sync |
| **14:00 daily** | `/api/kpi/cron` | Capture daily KPI snapshots for the trends page |
| **14:00 Mon–Fri** | `/api/agents/cron/activities` | Activity Reminders: 7 AM PT DM of everything due today + overdue count |
| **14:00 Mon–Fri** | `/api/eos/cron/scorecard-daily` | Daily scorecard refresh after the metrics capture (no Friday communications) |
| **14:00 Monday** | `/api/maintenance/cron/unbilled-report` | Verified-but-unbilled weekly report → Penny |
| **14:15 Mon–Fri** | `/api/eos/cron/escalation` | Escalation ladder → EOS issues; to-do roll/nudge (7:15 AM PT) |
| **14:15 Mon–Fri** | `/api/haven/cron/digest` | Haven response-time digest |
| **14:20 daily** | `/api/reception/sync` | Zoom main-line reception call report sync |
| **14:30 Monday** | `/api/eos/cron/meeting-prep` | L10 prep packet + facilitator DM (7:30 AM PT) |
| **15:00 daily** | `/api/sync/vacancies` | AppFolio vacancy cache refresh |
| **15:00 & 16:00 Mon–Fri** | `/api/maintenance/cron/followups` | Maintenance Follow-up Queue to Slack (runs only at 8 AM Pacific; skipped when the shared trial is off) |
| **15:00 Monday** | `/api/agents/cron/ops-brief?deep=1` | Monday deep Ops Brief (8 AM PT) |
| **16:00 Monday** | `/api/agents/cron/operator-canary` | AppFolio Form Filler weekly health check (prepare-mode run; DMs Craig on a real failure) |
| **20:00 Mon–Fri** | `/api/agents/cron/activities?kind=nudge` | Activity Reminders: 1 PM PT reminder for anything still due today |
| **22:00 Friday** | `/api/eos/cron/scorecard` | Scorecard auto-fill + owner nudges + Rock check cards (3 PM PT) |
| **00:00 Tue–Sat** | `/api/agents/cron/ops-brief` | Daily Ops Brief (~5 PM PT) |
| **10:00 Jan 1 annually** | `/api/sync/hud` | HUD Fair Market Rent data refresh |

Cron endpoints are authenticated via `CRON_SECRET` bearer token and exempted from Azure AD middleware (Vercel cron sends GET; every cron route's GET delegates to its authenticated POST). AppFolio also pushes updates in real time through `/api/webhooks/appfolio` and `/api/webhooks/appfolio-leads`. Every cron route is wrapped with `withCronRun` and listed in `lib/routines/registry.ts`, so each run lands in `routine_run` and on the [routine calendar](#agents-page-routine-calendar--activity-feed). Pacific-time notes assume daylight time; in winter UTC crons land an hour earlier.

---

## Environment Variables

### Required

| Variable | Service | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Database URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase | Client-side anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Server-side admin key |
| `AZURE_AD_CLIENT_ID` | Microsoft | Azure AD app client ID |
| `AZURE_AD_CLIENT_SECRET` | Microsoft | Azure AD app secret |
| `AZURE_AD_TENANT_ID` | Microsoft | Azure AD tenant |
| `NEXTAUTH_SECRET` | NextAuth | Session encryption key |
| `NEXTAUTH_URL` | NextAuth | App base URL (e.g. `https://os.highdesertpm.com`) |
| `APPFOLIO_CLIENT_ID` | AppFolio | v0 API client ID |
| `APPFOLIO_CLIENT_SECRET` | AppFolio | v0 API client secret |
| `APPFOLIO_DEVELOPER_ID` | AppFolio | Developer ID header value |
| `ANTHROPIC_API_KEY` | Anthropic | Claude AI for listings, invoice rewrites, chat (`CLAUDE_API_KEY` is accepted as a legacy fallback — code resolves `ANTHROPIC_API_KEY \|\| CLAUDE_API_KEY`) |
| `GOOGLE_PLACES_API_KEY` | Google | Server-side geocoding API key |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google | Client-side Maps JavaScript API key |

> **Auth.js v5 aliases:** the app runs Auth.js (NextAuth) v5, which also recognizes `AUTH_SECRET` (alias of `NEXTAUTH_SECRET`) and `AUTH_REDIRECT_PROXY_URL` (preview-deploy login proxy) alongside the documented `NEXTAUTH_SECRET` / `NEXTAUTH_URL`.

### Optional

| Variable | Service | Purpose |
|----------|---------|---------|
| `CRON_SECRET` | Vercel | Authenticates cron job requests |
| `TIMEKEEPING_DEFAULT_MANAGER` | Timekeeping | Exact `staff.person` key for first-visit enrollment; production defaults to Craig. Requires the auto-enroll migration. Existing employee settings remain unchanged |
| `TIMEKEEPING_EXCLUDED_STAFF` | Timekeeping | Comma-separated exact `staff.person` keys omitted from timekeeping setup and enrollment; other company access and retained history are unaffected |
| `RENTOMETER_API_KEY` | Rentometer | Rental comp market data |
| `RENTCAST_API_KEY` | RentCast | Alternative rental data source |
| `HUD_API_TOKEN` | HUD.gov | Fair Market Rent annual data |
| `OPENAI_API_KEY` | OpenAI | Embeddings for knowledge base + fallback AI |
| `RESEND_API_KEY` | Resend | Maintenance OS tripwire digest emails (skipped when absent) |
| `MAINT_DIGEST_RECIPIENTS` | Maintenance OS | Fallback JSON map of owner → email. Normally unnecessary — admins manage opt-ins in the app (Maintenance → Exceptions → Digest recipients, backed by `maint_digest_recipient`) |
| `MAINT_DIGEST_FROM` | Maintenance OS | From address for digests (default `HDMS Maintenance <maintenance@highdesertpm.com>`) |
| `MAINTENANCE_COPY_MODEL` | Anthropic | Model for **Improve with AI** (`/api/maintenance/improve-copy`; default `claude-sonnet-5`) |
| `KC_TRANSCRIBE_MODEL` | OpenAI | Knowledge Capture transcription model (default `whisper-1`) |
| `NEXT_PUBLIC_REALMX_ENABLED` | Inspections | `=1` shows the **Copy Realm-X request** in Send Notices once Realm-X Assistant is on HDPM's AppFolio plan; unset → letter-first only |

### Integrations

| Variable | Service | Purpose |
|----------|---------|---------|
| `HAVEN_API_KEY` | Haven | API key for the Haven leasing/reception integration |
| `HAVEN_BASE_URL` | Haven | Haven API base URL |
| `HAVEN_RECEPTION_NUMBER` | Haven | Reception line number for the call-report / reception metrics |
| `REFERRAL_ADMIN_EMAIL` | Referral portal | Staff address notified of new referral partner activity |
| `REFERRAL_EMAIL_FROM` | Referral portal | From address for referral invites + magic-link sign-in emails |
| `REFERRAL_FIELD_KEY` | Referral portal | Field key used when writing referral leads |
| `HDPM_WEB_BASE_URL` | Referral portal / hdpm-web | Public base URL used to build magic-link sign-in URLs; also the server-to-server base for the Hiring and Leads proxies (defaults to `https://www.highdesertpm.com`) |
| `HDPM_OS_ADMIN_TOKEN` | hdpm-web | Bearer token for hdpm-web's `/api/os/*` admin endpoints (Admin → Hiring, Leads); same value on both apps, separate from `HDPM_SERVICE_TOKEN` |
| `PARTNERS_BASE_URL` | Referral portal | Base URL for partner invite links (e.g. `https://partners.highdesertpm.com`); unset → the admin's own origin |
| `PARTNERS_HOST` | Referral portal | Host that serves only the referrer portal (default `partners.highdesertpm.com`) |
| `STAFF_ORIGIN` | Referral portal | Where staff paths on the partner host redirect (default `https://os.highdesertpm.com`) |
| `NOTION_API_KEY` | Notion | Notion SOP corpus sync into the knowledge base / company brain |
| `ADMIN_EMAILS` | HDPM-OS | Bootstrap / disaster-recovery admin allowlist only — admin status normally comes from `staff.access_role` |
| `APPFOLIO_REPORTS_CLIENT_ID` | AppFolio | Reports API client ID — distinct credential from the v0 API |
| `APPFOLIO_REPORTS_CLIENT_SECRET` | AppFolio | Reports API client secret |
| `APPFOLIO_HDMS_VENDOR_ID` | AppFolio | HDMS vendor id used to filter `af_bills` for invoice auto-matching |

### Agent-OS

| Variable | Service | Purpose |
|----------|---------|---------|
| `SLACK_BOT_TOKEN` | Slack | Bot token for agent cards/DMs and Dez replies (skipped when absent) |
| `SLACK_SIGNING_SECRET` | Slack | Verifies inbound Slack requests — `/api/agents/slack/interact` button taps and `/api/agents/slack/events` (Dez) |
| `SLACK_BOT_USER_ID` | Slack (Dez) | Dez's own bot user id (`U…`, from `auth.test`) — loop guard so Dez never answers its own messages |
| `SLACK_DEZ_ACTIVITY_CHANNEL` | Slack (Dez) | Optional `#dez-activity` channel id (`C…`) for the visibility feed (unset → no activity log) |
| `DEZ_CHANNEL_MAP` | Dez | Optional JSON `{channelId: scope}` mapping channels to `maintenance`/`leasing`/`accounting` for the routing breadcrumb |
| `DEZ_INSPECTION_NOTICES` | Dez | `=1` turns on the per-route inspection-notice Slack card (Send Notices / Route Builder / date changes) |
| `DEZ_INSPECTION_NOTICE_OWNER` | Dez | Staff name that receives the inspection-notice card (default `Brody`) |
| `DEZ_KPI_ADMINS` | Dez | Allowlist (comma-separated) for Dez's financial-KPI answers; others get only the operational subset (default `Craig,Matt,Penny`) |
| `HDPM_SERVICE_TOKEN` | Agent-OS | Service-caller auth for `/api/agents/*` (with `X-Agent-Actor` header) |
| `AGENT_EMAIL_FROM` | Resend | From address for agent emails (falls back to `MAINT_DIGEST_FROM`) |
| `AZURE_TENANT_ID` | Microsoft Graph | App-only mail tenant (distinct from `AZURE_AD_TENANT_ID`) |
| `AGENT_GRAPH_CLIENT_ID` / `AGENT_GRAPH_CLIENT_SECRET` | Microsoft Graph | "HDPM-OS Agent Mail" app — application `Mail.ReadWrite` (ApplicationAccessPolicy-scoped via the `agent-mail` group to cheryl@ + info@, plus craig@ + brody@ for the Loop 1 pilot) plus `Sites.Read.All` (already granted) which the knowledge-base OneDrive sync (`lib/onedrive-sync.ts`) uses to read the team SharePoint library |
| `AGENT_GRAPH_DRYRUN` | Microsoft Graph | `=1` skips draft creation (staged rollout); leave **unset** for the pilot so drafts actually create |
| `ESTIMATE_CHASER_OWNER` | Agent-OS | Staff name that owns the estimate-chaser Outlook drafts (production owner **Jayme**); their mailbox must be in the `agent-mail` ApplicationAccessPolicy group |
| `AGENT_PILOT_RECIPIENTS` | Agent-OS | Comma-separated staff names (e.g. `Craig,Brody`) the estimate chaser routes cards/drafts/escalations to instead of Cheryl. Empty/unset → default (Cheryl, real sends) |
| `AGENT_PILOT_SHADOW` | Agent-OS | `=1` records a Send tap as motion (approved proposal + `wo_event` tagged `shadow`) but suppresses the real vendor SMS |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | Zoom | Server-to-Server app ("HDPM Appfolio Sync") — contact sync; cannot send SMS |
| `ZOOM_USER_CLIENT_ID` / `ZOOM_USER_CLIENT_SECRET` | Zoom | User-managed app ("HDPM-OS SMS Sender") — per-user OAuth for SMS sending |
| `ZOOM_SMS_SENDER_NUMBER` | Zoom Phone | E.164 line texts send from (Cheryl's) |
| `ZOOM_SMS_SENDER_EMAIL` | Zoom Phone | Sender's Zoom login (default `cheryl@highdesertpm.com`); their OAuth token does the sending |
| `ZOOM_SMS_SENDER_USER_ID` | Zoom Phone | Legacy S2S fallback sender id (unused once the OAuth token exists) |
| `AGENT_ZOOM_SMS_DRYRUN` | Zoom Phone | `=1` skips SMS sending (staged rollout) |

---

## Database

**Platform:** Supabase (PostgreSQL with pgvector extension)

**Key tables:**

| Table | Purpose |
|-------|---------|
| `inspection_properties` | Physical property records with AppFolio IDs, coordinates, and unit counts |
| `inspections` | Inspection tasks with due dates, status, and unit names |
| `route_plans` | Inspection routes with dates, assignees, stop counts, and time estimates |
| `route_stops` | Individual stops within routes with ordering, status, and arrival times |
| `import_batches` | CSV/XLSX upload audit trail for inspection imports |
| `inspection_audit_log` | Immutable change tracking for inspection operations |
| `kpi_snapshots` | Daily-captured KPI values backing the dashboard sparklines and trends charts |
| `saved_listings` | Saved Craigslist listing drafts with generated HTML |
| `cached_vacancies` | Cached AppFolio vacancy data for instant page load |
| `hdms_invoices` | Maintenance invoices (JSONB line items, PDF storage, WO link, `payment_id` = paid) |
| `hdms_payments` | Trust-account payment ledger (ACH/check) with snapshotted labor/materials/appliance/other totals |
| `af_bills` | AppFolio HDMS-vendor bill snapshot, auto-matched to invoices by reference |
| `work_orders` | AppFolio work-order mirror **plus** Maintenance OS workflow columns (stage, HDPM owner, next-action date, P1–P4, verify/closure fields) |
| `wo_event` | Append-only work-order audit trail (trigger-enforced) — every stage change, note, exception, sync update |
| `vendor` / `vendor_assignment` | Vendor profiles (license, insurance, rates, demote flag) + acceptance/performance tracking |
| `approval` / `recommendation` / `turn` | Owner/PM approvals · tech field recommendations · turnover board data |
| `ai_triage_proposal` | Batch AI triage proposals awaiting human review (pending/applied/skipped) |
| `maint_digest_recipient` | Digest opt-ins (person → email + enabled), managed from the Exceptions view |
| `agent_proposal` | Every agent output, first — audit trail, approval queue, and autonomy-promotion training data |
| `agent_outbox` | Every outbound agent message (Slack / email / Outlook draft / SMS) with retry + delivery state |
| `agent_config` | The autonomy matrix as data: per (agent, action) level, ceiling, daily cap + the global kill switch |
| `staff` | Staff identity map (email, phone, Slack ID) — how taps and replies resolve to a human actor |
| `metrics_snapshot` | Daily agent-layer KPI capture (open exceptions, approval latency, staff actions/week, …) |
| `zoom_contact_map` | AppFolio → Zoom Phone contact mirror (vendor/owner/tenant, E.164 phone + email) |
| `zoom_user_token` | Per-user Zoom OAuth tokens for SMS sending (auto-rotating refresh) |
| `rental_comps` / `market_baselines` | Rental comps, baselines, and saved comp-analysis reports |
| `conversations` / `conversation_messages` | AI chat history and individual messages (with sources and attachments) |
| `knowledge_chunks` | pgvector knowledge base chunks for ORS 90 semantic search |
| `brain_chunk` / `brain_node` / `brain_ingest_log` | Company brain: cited memory chunks (pgvector), entity graph, ingest audit |
| `seat` / `rock` | EOS accountability chart seats + quarterly Rocks |
| `scorecard_metric` / `scorecard_entry` | The weekly scorecard: metric definitions + red/green entries |
| `issue` / `todo` | The IDS queue (open-`source_ref` dedupe) + 7-day to-do list (roll-once chain) |
| `meeting` / `meeting_item` / `decision` | L10 meetings (agenda, prep packet, minutes, rating), per-step outcomes, the decision log |
| `audit_event` | Append-only EOS audit trail — every scorecard/issue/todo/meeting/rock write |
| `service_token` | Per-service scoped API tokens for the agent layer |
| `staff_section_access` / `role_section_defaults` | Per-person section switches + admin-edited role defaults (User settings), each with an `_audit` table; role changes in `staff_role_audit` |
| `fee_campaign_config` / `fee_campaign` / `property_agreement` | Fee Management: schedule + weights + fee schedule config, per-owner campaign state, agreement dates and AppFolio agreement links |
| `supplier` / `parts_order` / `parts_order_event` | Parts orders on the chase board, with contact log |
| `routine_run` | One row per cron run (running / ok / halted / skipped / error) for the routine calendar |
| `brain_viz_doc_emb` | Cached per-document averaged embeddings for the brain map snapshot |
| `referral_fee_agreement` / `referral_ledger` | Frozen bounty terms + append-only earned → approved → paid / voided ledger |
| `kc_recording` / `kc_profile` / `kc_owner_link` | Knowledge Capture takes (audio or typed, transcript, original transcript, voices), living profiles, owner record links |

Added in the Sep 24 – Oct 8 window: `20260924_fee_management` · `20260925_staff_section_access` · `20260925b_role_section_defaults` · `20261001_parts_orders` · `20261002_routine_run` · `20261003_brain_viz` · `20261004_brain_viz_paged_knn` · `20261005_referral_bounty_ledger` · `20261006_invoice_charge_to` (`hdms_invoices.charge_to` + tenant fields) · `20261007_property_agreement_document` · `20261008_timekeeping_edit_past_days_while_clocked_in` · `20261009_route_builder_inspection_target_dates` · `20261010_release_stale_scheduled_candidates` · `20261011_inspection_notice_tracking` · `20261012_staff_lisa_coffey` · `20261013_tenant_charge_basis_at_posting` · `20261014_knowledge_capture` · `20261015_kc_owner_links` · `20261016_kc_voices` · `20261017_dump_run_price_book` · `20261018_harden_table_grants` (revokes browser-role access on server-only tables) · `20261019_dump_template_cleanup`.

**Migrations:** Located in `supabase/migrations/`. Run new migrations via the [Supabase SQL Editor](https://supabase.com/dashboard).

---

## Deployment

Deployed on **Vercel**. Pushing or merging to GitHub `main` automatically starts a production deployment through the GitHub integration (verified September 14, 2026). Wait for Vercel to report **Ready** before treating a push as live:

```bash
npm run build    # Verify build passes locally
git push origin main  # Starts the production deployment
vercel list hdpm-chatbot --environment production  # Check deployment status
```

**Production URL:** `os.highdesertpm.com` (Vercel project `hdpm-chatbot`, alias `hdpm-chatbot.vercel.app`) · referral partner portal on `partners.highdesertpm.com` (same project; needs the domain in Vercel, a DNS CNAME, the Supabase auth redirect URL and `PARTNERS_BASE_URL` — see #101)

**Branch strategy:**
- `main` — production source; pushes trigger Vercel production builds
- `feature/*` — feature branches, merged via `--no-ff`

### Builds (self-hosted fonts)

Builds make **no network calls for fonts** (#146). `next/font/google` used to download fonts from Google during `next build`, so a hiccup on Google's side failed production deploys. The referrer portal's **Plus Jakarta Sans** and **Inter** are now committed as variable Latin woff2 files (Fontsource, SIL OFL, licenses alongside) in `app/partners/(referrer)/fonts/` and loaded with `next/font/local`; CSS variables (`--font-brand-heading`, `--font-brand-body`) are unchanged. Geist, the main app font, was already local via its npm package. `lib/__tests__/no-remote-fonts.test.ts` fails if anything imports `next/font/google` again.
