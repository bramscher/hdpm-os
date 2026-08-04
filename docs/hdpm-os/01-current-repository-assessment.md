# HDPM-OS — Current Repository Assessment

> Status: exploration draft, 2026-08-03 (branch `feature/hdpmos`). All claims
> below are grounded in the codebase at commit `e240d67`; file paths are
> citations. Scale figures from a full scan on 2026-08-03.

## 0. Verdict up front

**The repository is a viable — in fact strong — foundation for HDPM-OS and
should not be restructured wholesale.** It is already a working operations
platform (~78,800 lines TS/TSX, 164 API routes, 55 migrations, 23 cron jobs)
with the three hardest primitives shipped and in production: an AppFolio
mirror with a disciplined sync-ownership model, an append-only audit trail
(`wo_event`), and an agent proposal/approval spine (`agent_proposal`,
`agent_outbox`, `agent_config`). What HDPM-OS adds (CRM, EOS layer, workflow
templates, brain, execution layer) are *new modules on the same chassis*, plus
a Phase-0 hardening pass for the debt listed in §9.

## 1. What the project does today

Package `hdpm-os` (`package.json:2`), repo folder still `hdpm-chatbot`.
Product surfaces (pages under `app/`):

| Surface | Path | Notes |
|---|---|---|
| Knowledge chat + canvas home | `app/page.tsx`, `components/canvas/*` | chat left, contextual canvas right (dashboard/sources/app views via `lib/canvas-routes.ts`) |
| Maintenance OS | `app/maintenance/*` | board + WO detail, exceptions, turnover view, work orders, invoices (form 1,426 lines; reconcile tab), inspections (dashboard 1,582 lines; candidates, import, routes) |
| Dashboards (admin) | `app/dashboard/page.tsx` (1,540), `dashboard/trends` (1,344) | KPI + financial gauges |
| Craigslist listing tool | `app/craigslist/`, `components/craigslist/CraigslistTool.tsx` (1,782 — largest file) | generate/save/post/renew vacancy ads |
| Comps / rent analysis | `app/comps/*` | Zillow/Rentcast/Rentometer/HUD-fed |
| Haven analytics | `app/haven/` | after-hours leasing AI conversations |
| Keys | `app/keys/*` | physical key inventory + AppFolio checkout report |
| Properties map | `app/properties/map/` | mgmt-status pins |
| Owner reports | `app/reports/owner/` | PDF/Excel |
| Agents console | `app/agents/` | proposals + autonomy config |
| Reception | `app/r/*` | Zoom main-line call report |
| Admin | `app/admin/zoom-sync/` | contact sync |

## 2. Frontend

Next.js **^16.1.4** App Router + React 18.3, TypeScript 5.7, Tailwind 3.4,
shadcn-style primitives (`components/ui/*` on radix/cva), lucide icons,
recharts. No global state library — local state + `CanvasContext`
(`components/canvas/types.ts`) + next-auth `SessionProvider`. Pattern: thin
server `page.tsx` → large `"use client"` dashboard component. Client-side
PDF/export stack (`jspdf`, `pdfjs-dist`, `xlsx`, `papaparse`, `jszip`).

## 3. Backend

- **164 API routes** under `app/api/` (full inventory in the sections below;
  clusters: `maintenance/*`, `kpi/*` (~25), `inspections/*`, `invoices/*`,
  `keys/*`, `agents/*`, `comps/*`, `sync/*`, `webhooks/*`, `chat`,
  `intake/*`).
- **100 lib modules**: integration clients (`lib/appfolio.ts` 1,769;
  `lib/appfolio-reports.ts`; `lib/zoom-phone.ts`; `lib/haven.ts`;
  `lib/knowledge-sync.ts`…), domain logic (`lib/invoices.ts`, `lib/keys.ts`,
  `lib/inspection-*.ts`…), the maintenance engine (`lib/maintenance/*`:
  `workflow.ts` state machine, `sync-rules.ts`, `tripwires.ts` + engine,
  `vendors.ts`, `route-publish.ts`…), and the agent layer (`lib/agents/*`:
  `proposals.ts`, `outbox.ts`, `config.ts`, `actor.ts`, `graph.ts`, channel
  adapters `channels/{slack,email,outlook-draft,sms-zoom,in-app}.ts`, runs
  `morning-card-run.ts`, `estimate-chaser-run.ts` (664), `ops-brief-run.ts`).
- **23 Vercel crons** (`vercel.json`): WO sync every 15 min, daily AppFolio /
  vacancies / KPI / Haven / reception / zoom-contacts syncs, weekday
  tripwires + metrics, weekly knowledge sync + unbilled report, agent crons
  (morning-card + nudge, estimate-chaser, ops-brief daily + Monday deep).
- **`middleware.ts`**: next-auth `withAuth` over everything except
  self-guarded public prefixes (`/api/sync`, `/api/webhooks`, `/api/kpi/cron`,
  `/api/maintenance/cron`, `/api/agents`, `/api/intake` — CRON_SECRET /
  HDPM_SERVICE_TOKEN), plus admin-only paths (`/dashboard*`, `/admin*`,
  `/api/kpi*`, `/api/config*`, `/api/financials*`) requiring
  `token.isAdmin` (`middleware.ts:16-49`).

## 4. Data model (55 migrations, 2026-03 → 2026-07)

Core clusters (citations = migration files in `supabase/migrations/`):

- **Maintenance** (`20260702_maintenance_os.sql`): `work_orders` (AppFolio
  mirror columns + app-owned workflow columns), `wo_event` (append-only audit;
  actors `system:*`, `agent:*`, humans), `vendor`, `vendor_assignment`,
  `approval`, `recommendation`, `turn`; later `unit_turn` (`20260723`) with
  AF sync (`20260724/26`).
- **Agent spine** (`20260718/19/21/22`): `metrics_snapshot`, `agent_config`
  (autonomy matrix as data + kill switch), `agent_proposal`, `agent_outbox`,
  `staff`, escalation + SMS-chase extensions, `zoom_user_token` (`20260723`).
- **Inspections** (`20260319` + `20260402/0520/0627/0709`): `inspections`,
  `inspection_properties`, audit log, candidates, notices.
- **Money** (`20260715/22/28`): `hdms_payments`, `invoice_payments`,
  `af_bills`, `appfolio_webhook_log`, appliance-split columns.
- **Leasing/marketing**: `rent_analyses` (`20260316`), `cached_vacancies`,
  `saved_listings` (`20260401` + `20260724`), `lead_events` (`20260407`),
  `haven_conversation` + `haven_af_lead_link` (`20260727`).
- **Other**: `kpi_snapshots` (`20260407`), keys tables (`20260720/24`),
  `reception_call` (`20260728`), `property_mgmt_status` (`20260727`),
  `dashboard_config`, routes tables (`20260319`, `20260717`).
- **⚠ Missing from migrations:** the RAG core — `knowledge_chunks`,
  `conversations`, `conversation_messages`, the pgvector extension/index and
  `match_knowledge_chunks` / `search_knowledge_*` RPCs — is referenced
  throughout (`lib/rag.ts`, `lib/supabase.ts`) but has **no CREATE migration
  in-repo**. Schema-reproducibility gap; capture it in Phase 0.

## 5. Authentication

NextAuth **v4**, single Azure AD provider, delegated scopes
`openid profile email User.Read Calendars.ReadWrite` (`lib/auth.ts:8`).
JWT sessions, 8h. Sign-in hard-blocked to `@highdesertpm.com`
(`lib/auth.ts:20-27`). Admin = env allowlist `ADMIN_EMAILS`
(`lib/admin.ts`), stamped into JWT; no DB roles. Route-level defense:
`requireAdmin()` (`lib/require-admin.ts`), `requireStaffSession()` /
`requireStaffOrService()` (`lib/maintenance/api-auth.ts`); 162
`getServerSession` call sites. A second, **app-only** Graph credential
(`lib/agents/graph.ts`, `AGENT_GRAPH_CLIENT_ID`) is ApplicationAccessPolicy-
scoped to cheryl@ + info@ for agent mail drafts.

## 6. Integrations (all shipped, cited)

AppFolio v0 DB API (`lib/appfolio.ts`), AppFolio Reports v2
(`lib/appfolio-reports.ts`), AppFolio signed webhooks
(`app/api/webhooks/appfolio*`, `lib/webhook-verify.ts`); MS Graph delegated
(calendar; `lib/maintenance/route-calendar.ts`) + app-only (mail drafts);
Slack (channel adapter + interactive endpoint
`app/api/agents/slack/interact`); Zoom Phone S2S (contacts, call history →
`lib/reception.ts`) + per-user OAuth SMS (`lib/agents/channels/sms-zoom.ts`;
no Twilio anywhere); Haven (`lib/haven.ts`); Notion (`lib/knowledge-sync.ts`);
Resend (email); Zillow/Rentcast/Rentometer/HUD/Google (comps); Rentzap
(`app/api/generate-listing`); QuickBooks (manual snapshots only,
`lib/quickbooks.ts` — live QBO is a TODO). AI providers: OpenAI (embeddings)
+ Anthropic (`lib/rag.ts:16-35`).

## 7. AI & agent features

- **RAG knowledge chat**: hybrid retrieval (pgvector + fulltext/phrase/
  substring RPCs + colloquial→ORS-90 query expansion, `lib/rag.ts`), cited
  sources, streaming, persisted team-visible conversations.
- **Agent OS**: autonomy matrix in data (`agent_config`, global kill switch,
  `lib/agents/config.ts`); every agent output is an `agent_proposal` first;
  human decisions via `/api/agents/proposals/[id]/decide` logged with human
  actor; outbound via `agent_outbox` channel adapters. Live agents:
  Morning Action Card, Estimate Chaser (Outlook drafts + escalation),
  Vendor SMS Chaser, Ops Brief (daily + Monday deep). AI triage
  (`lib/maintenance/ai-triage.ts` + batch), invoice AI helpers.
- **No MCP client/server in-app** today.

## 8. Existing workflow/task concepts (the proto-workflow-engine)

- 8-stage WO state machine with explicit allowed transitions and a single
  write path (`lib/maintenance/workflow.ts:21-50`, `workflow-db.ts`).
- **Sync-ownership rules**: mirror sync may never touch workflow columns;
  only 2 sanctioned system stage-moves (`lib/maintenance/sync-rules.ts`).
- 12 tripwires enforcing "someone obligated to act by a date"
  (`lib/maintenance/tripwires.ts`), keyed off `next_action_date`.
- Turnover board over `unit_turn`; route planning/publish to Outlook;
  `approval` table (owner/PM estimate decisions); vendor scoreboard.
- These are the patterns the general workflow engine (doc 07) generalizes.

## 9. Technical debt & security concerns (Phase-0 hardening list)

1. **RLS is not the boundary.** Most tables have no RLS; where enabled it's
   service-role-only policies. The app reads/writes via
   `getSupabaseAdmin()` (service-role key) almost everywhere
   (`lib/supabase.ts`) — so **authorization lives entirely in app code**, and
   any missed check is exposure. Acceptable single-org today; must change
   before multi-role CRM/EOS data lands (see doc 08).
2. **Admin = env string** (`ADMIN_EMAILS`); no DB roles, changes require
   redeploy, no audit of role grants.
3. **Domain check duplicated** in `lib/auth.ts`, `app/api/chat/route.ts:8-14`,
   `lib/maintenance/api-auth.ts`; some `getServerSession()` calls omit
   `authOptions`.
4. **RAG core schema not in migrations** (§4) — reproducibility risk.
5. **Version skew**: Next 16 + next-auth v4 (maintenance mode) + React 18 +
   `eslint-config-next` 14.2; middleware uses the deprecated convention
   (build warns "middleware → proxy"). An auth-stack upgrade (Auth.js v5)
   is a named Phase-0 item.
6. **Monster components** (1,400–1,800 lines) concentrate logic untested.
   ~24 Vitest files exist but coverage is thin outside `lib/maintenance` and
   `lib/agents`.
7. **QuickBooks numbers are manual snapshots** with a payroll caveat
   (`lib/quickbooks.ts`) — owner-facing NOI can mislead if unconfigured.
8. **`.env.local` present in working tree** (gitignored — verify — but
   secrets hygiene deserves a pass; rotate anything ever committed).
9. Legacy `/api/work-orders` beside `/api/maintenance/work-orders`; dropped-
   column migrations indicate churn — a small dead-code sweep is due.

## 10. Keep / replace / rename

- **Keep (foundation)**: Supabase schema + migration discipline, sync-rules
  pattern, `wo_event` audit, agent spine + channel adapters, tripwire engine,
  RAG pipeline, all integration clients, the canvas/chat shell, cron sensor
  tier.
- **Refactor in place**: auth stack (Auth.js v5 + DB roles), RLS adoption for
  new+sensitive tables, split monster components as they're next touched
  (not a big-bang rewrite), centralize session/domain guards.
- **Replace/retire**: manual QuickBooks seeding (live QBO or drop the
  gauges), any Craigslist/marketing code that goes unused after CRM ships.
  (Correction 2026-08-03: `/api/work-orders` initially looked legacy but is
  the invoice dashboard's WO search API — kept.)
- **Rename**: repo → `hdpm-os` (cosmetic; GitHub redirects; re-point Vercel).
  Folder structure already fits the direction (`app/` surfaces + `lib/`
  domains + `docs/<initiative>/`); no restructure needed.
