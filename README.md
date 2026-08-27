# HDPM-OS

The operating system for **High Desert Property Management** (~835 doors across 467 properties, Central Oregon).

> **Mission: run HDPM like a system — every door, every dollar, and every decision visible, owned, and remembered.** Humans decide; agents watch, chase, brief, and file; the brain remembers. Full mission, system schematic, and agent org chart: [`docs/hdpm-os/13-mission-agents-and-schematic.md`](docs/hdpm-os/13-mission-agents-and-schematic.md).

Four layers on one Supabase spine, over the systems of record (AppFolio, M365, Slack, Zoom — never replaced):

1. **Maintenance OS** — live work-order board with an 8-stage lifecycle, one accountable owner + next-action date per WO, 12 crack-proofing tripwires, AI triage, vendor scoreboard, turnover board.
2. **EOS operating layer** (Company screens) — weekly scorecard, the Issues & To-Dos IDS queue fed by an escalation ladder, the meeting runner (solve requires an outcome), Rocks, and the accountability chart.
3. **Agent layer** — Morning Card, Estimate Chaser, Ops Brief, Escalation Ladder, Scorecard, Meeting Prep: proposal-first, audited, autonomy earned per action.
4. **Company brain** — pgvector memory over SOPs, decisions, and minutes; every answer cited.

Plus the tools: inspections + route builder, invoice generation + trust-payment reconciliation, rent comps, Craigslist ads, key manager, owner reports, and the KPI dashboard.

**Stack:** Next.js 16 / React 18 / TypeScript 5.7 / Supabase (PostgreSQL + pgvector) / Tailwind CSS 3.4 / Recharts 3 / Anthropic SDK / Vercel
**Auth:** Microsoft Azure AD (@highdesertpm.com only)
**Domain:** hdpmchat.highdesertpm.com
  
---

## Table of Contents

- [Getting Started](#getting-started)
- [Home (Quick Actions)](#home-quick-actions)
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
- [Agent-OS (the Agent Team)](#agent-os-the-agent-team)
- [Company — the EOS Layer](#company--the-eos-layer)
- [Company Brain](#company-brain)
- [KPI Dashboard](#kpi-dashboard)
  - [KPI Cards](#kpi-cards)
  - [KPI Trends](#kpi-trends)
  - [Daily KPI Snapshots](#daily-kpi-snapshots)
- [Inspections](#inspections)
  - [Inspection Queue](#inspection-queue)
  - [CSV / XLSX Import](#csv--xlsx-import)
  - [Geocoding](#geocoding)
  - [Route Builder](#route-builder)
- [Craigslist Ad Creator](#craigslist-ad-creator)
- [Invoice Generator](#invoice-generator)
- [Rent Comps](#rent-comps)
  - [Comps Dashboard](#comps-dashboard)
  - [Comps Analysis Wizard](#comps-analysis-wizard)
- [Key Manager](#key-manager)
- [Owner Reports](#owner-reports)
- [AI Chat (ORS 90)](#ai-chat-ors-90)
- [Scheduled Jobs (Crons)](#scheduled-jobs-crons)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Deployment](#deployment)

---

## Getting Started

```bash
npm install
cp .env.example .env.local   # Fill in all required env vars
npm run dev                   # http://localhost:3000
```

Login requires a `@highdesertpm.com` Microsoft account. All pages and API endpoints are protected behind Azure AD authentication.

---

## Home (Quick Actions)

**Path:** `/`

Landing page with a time-aware greeting, live portfolio stats, and one-click entries into every tool.

- **Live stats strip:** total inspections, overdue count, inspections this week, active routes, dispatched stops, vacant units
- **Quick-action cards:** Inspections, Route Builder, Invoice Generator, Rent Comps, Craigslist Ad Creator, KPI Dashboard
- **System status bar:** connection indicators for AppFolio and Rentometer

---

## Maintenance OS (Live Board)

**Path:** `/maintenance/board` · **Sidebar:** Maintenance (wrench icon) · **Spec:** `docs/maintenance-os/`

The maintenance command center: every work order moves through an 8-stage lifecycle (`NEW → TRIAGED → SCHEDULED → IN PROGRESS → WAITING ON → VERIFY → BILL → CLOSED`) with one accountable **HDPM owner** and a **next-action date** at all times. **AppFolio stays the system of record** — status, scheduling, and vendor assignment are edited *there* (every card has an "Open in AppFolio ↗" link); the board mirrors AppFolio within 15 minutes and adds the accountability layer AppFolio can't track: owners, dates, priorities, the closure gate, and 12 automated tripwires.

Seven tabs plus the Triage Review — each deep-linkable via `?view=`.

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

---

## Agent-OS (the Agent Team)

**Sidebar:** Click **Agents** · **Docs:** `docs/agent-os/00-DRAFT-master-plan.md` (the plan) + `docs/agent-os/02-brief-b-conventions.md` (the contract) · **Team guide:** Notion → "SOP: Maintenance Agents"

The agent layer converts the Maintenance OS's *detection* (tripwires, exceptions) into *staff motion* in the channels people already use — Slack, Outlook, and Zoom SMS. Every agent output is an `agent_proposal` row first (audit trail + approval queue), every outbound message goes through `agent_outbox` (channel adapters: `slack`, `email`, `outlook_draft`, `sms_zoom`, `in_app` — all five live), and autonomy is data, not code: `agent_config` holds one row per (agent, action) on the **L0 observe → L1 draft → L2 act-on-tap → L3 act-then-notify → L4 silent** ladder, with per-action ceilings (owner/tenant-facing hard-walled at L2 forever) and a global kill switch (`agent='*', action_type='*', enabled=false`).

**Status (2026-08-04):** full roster, schedules, and the agent org chart live in [`docs/hdpm-os/13-mission-agents-and-schematic.md`](docs/hdpm-os/13-mission-agents-and-schematic.md).

| Agent | What it does | Autonomy | Status |
|-------|--------------|----------|--------|
| **Morning Action Card** | Weekday 6:30 AM PT: Cheryl's 7 most important exceptions as a Slack card with Done / Snooze / Set-date / Reassign buttons; Brody + Matt read-only copies + email mirror; one 1 PM nudge | L2 | ✅ Live |
| **Estimate Chaser — email** | Weekday 6:45 AM PT: TW11 stuck estimates become ready-to-send Outlook drafts in the owner's Drafts folder (vendor bid chases + owner-approval asks; never a dollar amount; 3-business-day cooldown; subject numbers the round — "Bid follow-up (2nd request)"; round 3 carries a firm hand-datable close). Production owner **Jayme** (`ESTIMATE_CHASER_OWNER`) | L1 | ✅ Live |
| **Estimate Chaser — SMS** | Vendor chases go SMS-first when a phone is known: Slack "Text chase queue" card, taps send from the sender's Zoom line via their own OAuth token | L2 | 🟡 Built; runs in shadow during the pilot (a tap records motion, no text leaves) |
| **Estimate Chaser — escalations** | Stuck >45 days → Slack DM to the maintenance leads + (via the ladder) an EOS issue. "Chased 3×" escalation now applies **only to vendor chases that have an assigned vendor** — owner-approval asks (bid in hand) and un-assigned Estimate-Requested WOs keep following through to the owner's Drafts instead of parking | L3 | ✅ Live |
| **Ops Brief** | Daily ~5 PM PT + Monday deep brief: metrics + deltas, agent activity, open escalations with [Acknowledge] taps, brain context — Brody interactive, Matt + Craig read-only | L3 | ✅ Live |
| **Escalation Ladder** | Weekday 7:15 AM PT: aged/recurring tripwires, chaser escalations, and twice-missed to-dos auto-file EOS issues (deduped, capped 10/rung/run) so nothing evaporates from a DM | files only | ✅ Live |
| **Scorecard** | Friday 3 PM PT: auto-fills the weekly scorecard, nudges manual-metric owners, files issues at 2 weeks off-track, sends the one-tap Friday Rock check | L2 | ✅ Live |
| **Meeting Prep** | Monday 7:30 AM PT: builds the L10 prep packet (scorecard deltas, aged issues, cited brain context) and DMs the facilitator | L1 | ✅ Live |
| Email Triage, Intake, Day-Close SMS, Reconciliation, Vendor Chaser, Inspections | See the master plan roster | — | Backlog |

**Key routes:** `/agents` (dashboard: config matrix, proposals, outbox) · `/api/agents/cron/morning-card` + `/api/agents/cron/estimate-chaser` (crons; the latter takes `?dryRun=1` and pilot flags `?pilotSeed=N&seedChannel=sms|email`) · `/api/agents/slack/interact` (button taps; Slack-signature auth) · `/api/agents/dispatch` (manual outbox drain) · `/api/agents/sms-test` (Zoom SMS probe) · `/api/agents/vendor-contact-audit` (AppFolio contact-field diagnostics) · `/api/agents/zoom-oauth/start` (one-time SMS sender authorization)

### Loop 1 — estimate chase (live, owner: Jayme — 2026-08-27)

Per [`docs/agent-os/10-restart-2026-08-20.md`](docs/agent-os/10-restart-2026-08-20.md), the estimate chase is the one loop being proven. It ran as a Craig + Brody shadow pilot (2026-08-25), then handed to assistant **Jayme** as the production owner. Every weekday the chaser drafts stuck-estimate follow-ups into Jayme's Outlook Drafts; she reviews and sends each — the send *is* the completed action, nothing to re-type into AppFolio.

**What the backlog actually is (dug in 2026-08-27):** it's a **decision backlog, not a vendor-capacity one**. Of the genuinely-stuck estimate WOs, most have a **bid already in hand** and are waiting a median ~19 days (some 100+) on an approval *decision* — the vendor did its job. Only a minority are actually waiting on a vendor bid. So the chaser follows both: vendor-bid chases *and* owner-approval nudges, and no longer parks the owner-approval / un-assigned ones in the Ops Brief after 3 tries (see the escalations row above).

Delivery is env-driven (`ESTIMATE_CHASER_OWNER` sets the owner; the pilot `AGENT_PILOT_RECIPIENTS` / `AGENT_PILOT_SHADOW` flags still exist for reroute/shadow). The Outlook draft path requires the app-only Graph `ApplicationAccessPolicy` (`agent-mail` group) to include the owner's mailbox, and `AGENT_GRAPH_DRYRUN` unset. `?pilotSeed=N&seedChannel=sms|email` (via `scripts/pilot-fire.sh`) is a **test tool only** — it re-drafts the same oldest WOs and inflates chase rounds, so it is not used against the live owner.

**Adoption gate (restart §8):** ≥15 estimate-chase sends/week for 2 consecutive weeks (baseline ~0) and the owner says "keep it," else stop by 2026-10-01. Metrics captured daily in `metrics_snapshot`; baseline frozen pre-agents.

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

## Company Brain

**Docs:** `docs/hdpm-os/04-gbrain-company-brain.md` · **Tables:** `brain_chunk`, `brain_node`, `brain_ingest_log` (pgvector)

Institutional memory with citations. Content flows in from the Notion SOP corpus (weekly sync), EOS decisions (`decision:<id>`, ingested at solve time), and meeting minutes (`meeting:<id>#n`, ingested at conclude) — all idempotent on `source_key`. A nightly consolidation cron ("dream cycle") summarizes, reconciles contradictions, and decays stale salience. Retrieval is hybrid (vector + full-text); `think()` produces cited syntheses and powers the Knowledge Chat, the Ops Brief's memory context, and the Monday meeting-prep packet. Humans correct the record via `human_correction` chunks that supersede the old fact.

---

## KPI Dashboard

**Path:** `/dashboard`

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
- Inspections require **7 days minimum lead time** before the scheduled date (Oregon tenant notice law). Tenant notices themselves are handled manually, outside the app.
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
- Claude AI rewrites work descriptions into professional invoice language
- Auto-extracts materials and line items from descriptions
- PDF export with HDMS branding (Qty/Price/Extended columns, subtotals, totals)
- Auto-save with 2-second debounce
- Internal notes pre-populated with full work order reference data
- Status tracking: Draft → Generated → Attached (Void to cancel); "paid" is separate — an invoice is paid once it's linked to a payment in the Reconcile tab
- **Markup report** — select invoices on the Invoices tab → "Report from selection" for an internal cost/markup/charged breakdown (materials vs appliances), with CSV export and print

### Payment Reconciliation (Reconcile tab)

AppFolio pays HDMS out of the Client Trust Account as lump ACHs covering many invoices. The Reconcile tab is the ledger that ties those payments back to individual invoices:

- **Capture ACH payment** — record a trust-account payment (date, amount, payee, reference) as an "open" payment, with or without invoices attached yet
- **New reconciliation** — select the invoices a payment covered and attach them. Attaching sets `payment_id` on each invoice (that link *is* the paid state) and snapshots the payment's totals: labor / materials / appliances / other / invoice total. Snapshots are recomputed only on attach/detach so the ledger stays stable as an audit record even if an invoice is edited later
- **Reconcile Payment modal** — shows the selection split as five cards (Labor / Materials / Appliances / Other / Total) plus a **tie-out check**: the buckets must reconstruct the invoice totals to the cent, or an amber warning shows the exact variance before you record. Variance vs the payment amount (short/over/balanced) is shown live
- **AppFolio billing view** — HDMS-vendor bills synced from AppFolio (`af_bills`), auto-matched to invoices by reference (~91%); work the unmatched/mismatched remainder by hand
- Payments are fully reversible: deleting a payment (or detaching invoices) reverts the invoices to unpaid and re-snapshots

One-time backfill after schema changes: `npx tsx scripts/recompute-payment-snapshots.ts` re-splits every payment's snapshot from its linked invoices' line items (idempotent).

---

## Rent Comps

**Path:** `/comps`

Rental market analysis combining three data sources:

- **AppFolio** — current portfolio rental rates and vacancy data
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

## AI Chat (ORS 90)

**Sidebar:** Click **ORS 90 Chat** in the left navigation

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

---

## Scheduled Jobs (Crons)

Configured in `vercel.json`. All times are UTC.

| Schedule (UTC) | Endpoint | Purpose |
|----------|----------|---------|
| **Every 15 min** | `/api/sync/work-orders?days=1` | AppFolio work-order mirror delta (+ vendor roster) |
| **Every 30 min** | `/api/maintenance/cron/appfolio-webhook-resolve` | Resolve webhook-logged WO events against the mirror |
| **Hourly** | `/api/sync/work-orders?days=7` | Work-order deep pass (webhook safety net) |
| **Hourly at :45** | `/api/sync/keys` | Key Manager ↔ AppFolio sync: tenants, owners, occupancy, flags |
| **9:00 daily** | `/api/sync/appfolio` | Full AppFolio sync: properties, vacancies, comps |
| **9:15 daily** | `/api/sync/af-reports` | AppFolio Reports API pulls (mgmt end dates, …) |
| **9:30 daily** | `/api/inspections/candidates/sync` | Refresh inspection candidates (move-in-anchored cadence) |
| **10:00 daily** | `/api/brain/cron/evolve` | Company-brain nightly consolidation (dream cycle) |
| **10:00 Sunday** | `/api/sync/knowledge` | Notion SOP corpus → knowledge base refresh |
| **11:00 daily** | `/api/sync/zoom-contacts` | AppFolio → Zoom Phone contact sync |
| **13:00 Mon–Fri** | `/api/maintenance/cron/tripwires` | Run the 12 tripwires; per-owner exception digests (6 AM PT) |
| **13:30 Mon–Fri** | `/api/agents/cron/morning-card` | Cheryl's Morning Action Card → Slack + email mirror (6:30 AM PT) |
| **13:30 daily** | `/api/maintenance/cron/metrics` | Daily `metrics_snapshot` capture (agent-layer KPIs) |
| **13:45 Mon–Fri** | `/api/agents/cron/estimate-chaser` | Estimate Chaser: Outlook drafts + SMS queue + escalations (6:45 AM PT) |
| **13:45 daily** | `/api/haven/sync` | Haven.AI conversation sync |
| **14:00 daily** | `/api/kpi/cron` | Capture daily KPI snapshots for the trends page |
| **14:00 Monday** | `/api/maintenance/cron/unbilled-report` | Verified-but-unbilled weekly report → Penny |
| **14:15 Mon–Fri** | `/api/eos/cron/escalation` | Escalation ladder → EOS issues; to-do roll/nudge (7:15 AM PT) |
| **14:15 Mon–Fri** | `/api/haven/cron/digest` | Haven response-time digest |
| **14:20 daily** | `/api/reception/sync` | Zoom main-line reception call report sync |
| **14:30 Monday** | `/api/eos/cron/meeting-prep` | L10 prep packet + facilitator DM (7:30 AM PT) |
| **15:00 daily** | `/api/sync/vacancies` | AppFolio vacancy cache refresh |
| **15:00 Monday** | `/api/agents/cron/ops-brief?deep=1` | Monday deep Ops Brief (8 AM PT) |
| **20:00 Mon–Fri** | `/api/agents/cron/morning-card?nudge=1` | One (and only one) 1 PM PT nudge if the card is untouched |
| **22:00 Friday** | `/api/eos/cron/scorecard` | Scorecard auto-fill + owner nudges + Rock check cards (3 PM PT) |
| **00:00 Tue–Sat** | `/api/agents/cron/ops-brief` | Daily Ops Brief (~5 PM PT) |
| **Jan 1 annually** | `/api/sync/hud` | HUD Fair Market Rent data refresh |

Cron endpoints are authenticated via `CRON_SECRET` bearer token and exempted from Azure AD middleware (Vercel cron sends GET; every cron route's GET delegates to its authenticated POST). AppFolio also pushes updates in real time through `/api/webhooks/appfolio` and `/api/webhooks/appfolio-leads`.

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
| `NEXTAUTH_URL` | NextAuth | App base URL (e.g. `https://hdpmchat.highdesertpm.com`) |
| `APPFOLIO_CLIENT_ID` | AppFolio | v0 API client ID |
| `APPFOLIO_CLIENT_SECRET` | AppFolio | v0 API client secret |
| `APPFOLIO_DEVELOPER_ID` | AppFolio | Developer ID header value |
| `CLAUDE_API_KEY` | Anthropic | Claude AI for listings, invoice rewrites, chat |
| `GOOGLE_PLACES_API_KEY` | Google | Server-side geocoding API key |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google | Client-side Maps JavaScript API key |

### Optional

| Variable | Service | Purpose |
|----------|---------|---------|
| `CRON_SECRET` | Vercel | Authenticates cron job requests |
| `RENTOMETER_API_KEY` | Rentometer | Rental comp market data |
| `RENTCAST_API_KEY` | RentCast | Alternative rental data source |
| `HUD_API_TOKEN` | HUD.gov | Fair Market Rent annual data |
| `OPENAI_API_KEY` | OpenAI | Embeddings for knowledge base + fallback AI |
| `RESEND_API_KEY` | Resend | Maintenance OS tripwire digest emails (skipped when absent) |
| `MAINT_DIGEST_RECIPIENTS` | Maintenance OS | Fallback JSON map of owner → email. Normally unnecessary — admins manage opt-ins in the app (Maintenance → Exceptions → Digest recipients, backed by `maint_digest_recipient`) |
| `MAINT_DIGEST_FROM` | Maintenance OS | From address for digests (default `HDMS Maintenance <maintenance@highdesertpm.com>`) |

### Agent-OS

| Variable | Service | Purpose |
|----------|---------|---------|
| `SLACK_BOT_TOKEN` | Slack | Bot token for agent cards/DMs (skipped when absent) |
| `SLACK_SIGNING_SECRET` | Slack | Verifies `/api/agents/slack/interact` button taps |
| `HDPM_SERVICE_TOKEN` | Agent-OS | Service-caller auth for `/api/agents/*` (with `X-Agent-Actor` header) |
| `AGENT_EMAIL_FROM` | Resend | From address for agent emails (falls back to `MAINT_DIGEST_FROM`) |
| `AZURE_TENANT_ID` | Microsoft Graph | App-only mail tenant (distinct from `AZURE_AD_TENANT_ID`) |
| `AGENT_GRAPH_CLIENT_ID` / `AGENT_GRAPH_CLIENT_SECRET` | Microsoft Graph | "HDPM-OS Agent Mail" app — application `Mail.ReadWrite` (ApplicationAccessPolicy-scoped via the `agent-mail` group to cheryl@ + info@, plus craig@ + brody@ for the Loop 1 pilot) plus `Sites.Read.All` (already granted) which the knowledge-base OneDrive sync (`lib/onedrive-sync.ts`) uses to read the team SharePoint library |
| `AGENT_GRAPH_DRYRUN` | Microsoft Graph | `=1` skips draft creation (staged rollout); leave **unset** for the pilot so drafts actually create |
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

**Migrations:** Located in `supabase/migrations/`. Run new migrations via the [Supabase SQL Editor](https://supabase.com/dashboard).

---

## Deployment

Deployed on **Vercel**. Production ships via a **manual `vercel --prod`** from the CLI — merging to `main` does **not** auto-deploy. Push `main` first so the build source matches, then deploy:

```bash
npm run build    # Verify build passes locally
git push         # Update origin/main (does NOT ship)
vercel --prod    # Manual production deploy (the actual ship step)
```

**Production URL:** `hdpmchat.highdesertpm.com` (Vercel alias `hdpm-chatbot.vercel.app`)

**Branch strategy:**
- `main` — production source; ships only via `vercel --prod`
- `feature/*` — feature branches, merged via `--no-ff`
