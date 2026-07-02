# HDPM Operations Dashboard

Internal operations platform for **High Desert Property Management** (~835 doors across 467 properties, Central Oregon). Automates inspections, invoice generation, rent comp analysis, Craigslist ad creation, and surfaces a live KPI dashboard covering portfolio health.

**Stack:** Next.js 16 / React 18 / TypeScript 5.7 / Supabase (PostgreSQL + pgvector) / Tailwind CSS 3.4 / Recharts 3 / Anthropic SDK / Vercel
**Auth:** Microsoft Azure AD (@highdesertpm.com only)
**Domain:** hdpmchat.highdesertpm.com

---

## Table of Contents

- [Getting Started](#getting-started)
- [Home (Quick Actions)](#home-quick-actions)
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
- Line items with Type (Labor/Materials/Other), Qty, Price, Extended (auto-calculated)
- Default labor rate $95/hr with after-hours/emergency toggle (1.5x = $142.50/hr)
- Claude AI rewrites work descriptions into professional invoice language
- Auto-extracts materials and line items from descriptions
- PDF export with HDMS branding (Qty/Price/Extended columns, subtotals, totals)
- Auto-save with 2-second debounce
- Internal notes pre-populated with full work order reference data
- Status tracking: Draft > Submitted > Paid

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

| Schedule | Endpoint | Purpose |
|----------|----------|---------|
| **8 AM daily (UTC)** | `/api/sync/work-orders` | Sync AppFolio work orders |
| **9 AM daily (UTC)** | `/api/sync/appfolio` | Full AppFolio sync: properties, vacancies, comps |
| **9:30 AM daily (UTC)** | `/api/inspections/candidates/sync` | Refresh inspection candidates from AppFolio (move-in-anchored cadence) |
| **2 PM daily (UTC)** | `/api/kpi/cron` | Capture daily KPI snapshots for the trends page |
| **Jan 1 annually** | `/api/sync/hud` | HUD Fair Market Rent data refresh |

Cron endpoints are authenticated via `CRON_SECRET` bearer token and exempted from Azure AD middleware. AppFolio also pushes updates in real time through `/api/webhooks/appfolio` and `/api/webhooks/appfolio-leads`.

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
| `MAINT_DIGEST_RECIPIENTS` | Maintenance OS | JSON map of owner → email, e.g. `{"Cheryl":"cheryl@highdesertpm.com","Alberto":"...","Penny":"...","Jen":"..."}` |
| `MAINT_DIGEST_FROM` | Maintenance OS | From address for digests (default `HDMS Maintenance <maintenance@highdesertpm.com>`) |

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
| `invoices` / `invoice_line_items` | Maintenance invoices and their line items with totals and status |
| `work_orders` | Synced AppFolio work orders with priorities and action history |
| `comps` / `comp_analyses` | Rental comps, baselines, and saved comp-analysis reports |
| `conversations` / `conversation_messages` | AI chat history and individual messages (with sources and attachments) |
| `knowledge_chunks` | pgvector knowledge base chunks for ORS 90 semantic search |

**Migrations:** Located in `supabase/migrations/`. Run new migrations via the [Supabase SQL Editor](https://supabase.com/dashboard).

---

## Deployment

Deployed on **Vercel** with automatic deploys from the `main` branch.

```bash
npm run build    # Verify build passes locally
git push         # Triggers Vercel deploy
```

**Production URL:** `hdpmchat.highdesertpm.com`

**Branch strategy:**
- `main` — production, auto-deploys to Vercel
- `feat/*` — feature branches, merged via PR
