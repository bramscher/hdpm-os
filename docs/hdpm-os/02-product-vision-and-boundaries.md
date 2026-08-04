# HDPM-OS — Product Vision and System Boundaries

> Status: exploration draft, 2026-08-03 (branch `feature/hdpmos`). Companion to
> `01-current-repository-assessment.md`. Labels used throughout this folder:
> **FACT** (verified in code/primary source), **ASSUMPTION** (plausible,
> unverified), **RECOMMENDATION** (our proposal), **OPEN** (needs a decision —
> collected in `12-open-questions.md`).

## 1. What HDPM-OS is

HDPM-OS is the **company operating system** for High Desert Property
Management (~460 buildings / ~850 doors, ~10 staff): the place where work is
seen, decided, assigned, executed, verified, and remembered. It is not a
chatbot with features bolted on; it is a control plane over the systems the
company already runs on (AppFolio, Microsoft 365, Slack, Zoom Phone, the
website) plus the capabilities those systems don't provide:

- **CRM & pipelines** — owner acquisition and leasing funnels (LeadSimple
  replacement, built in).
- **Workflow engine** — checklists and stateful processes (onboarding,
  turns, renewals, delinquency, inspections, incidents).
- **EOS-style operating cadence** — scorecards, Rocks, Issues, To-Dos,
  L10-style meetings, accountability chart, decision log.
- **Agent layer** — a roster of scoped AI agents that propose, draft, and
  (with earned autonomy) act, always inside audit and approval rails.
- **Institutional memory** — durable knowledge (SOPs, decisions, lessons,
  relationship history) retrievable with citations by both humans and agents.

**FACT:** a large fraction of this already exists in this repository —
maintenance board + 12 tripwires, turnover board, invoicing/reconciliation,
inspections cadence + notices, KPI snapshots, the `agent_proposal` /
`agent_outbox` / `agent_config` spine, six shipped agent briefs (Morning
Action Card, Estimate Chaser, Vendor SMS Chaser, Ops Brief…), knowledge chat
over the Notion SOP corpus, and read integrations with AppFolio, MS Graph,
Zoom, Slack, and Haven. See `01-current-repository-assessment.md`. HDPM-OS is
an **evolution of this codebase**, not a green-field build.

## 2. What HDPM-OS is not

- Not an accounting system, ledger, or trust-accounting replacement.
- Not a property-management system of record — AppFolio keeps that role.
- Not an email/calendar/document platform — M365 keeps that role.
- Not an autonomous company. Every consequential external action has a
  human approval step; autonomy is earned per (agent, action-type) and
  permanently capped for owner/tenant-facing actions (agent-os Q2 ceilings).

## 3. Authority map — who owns which truth

The single most important architectural rule: **every data type has exactly
one system of record (SoR)**. Everything else holds copies, mirrors, indexes,
or summaries that cite back to the SoR.

| Data type | System of record | HDPM-OS role | Brain (memory layer) role |
|---|---|---|---|
| Properties, units | AppFolio | read mirror (`af_*` tables) | entity pages, history summaries |
| Owners, tenants, leases | AppFolio | read mirror | relationship history, preferences |
| Work orders, tenant ledgers | AppFolio | mirror + workflow overlay (`work_orders` mirror cols, `wo_event`) | lessons, incident summaries |
| Owner/property accounting, bills | AppFolio | read mirror (`af_bills`), reconciliation UI | never stored |
| Applicant screening data | AppFolio + screening vendor (Rentzap) | pipeline state only; **no screening data stored** | never stored |
| Email, calendar | Microsoft 365 | Graph reads, drafts written to Outlook | selected threads summarized w/ citation |
| Documents (leases, agreements) | M365 / AppFolio attachments | links only | summaries + links |
| Staff identity | M365 (Entra ID) | NextAuth session; `staff` table for ops metadata | org-chart entities |
| Internal chat | Slack | channel adapter (cards in/actions out) | selected decisions/commitments captured |
| Calls, voicemail, transcripts | Zoom Phone | call-report mirror, SMS adapter | selected interaction summaries |
| After-hours intake | Haven (replaceable) | adapter → WO proposals | none directly |
| **CRM: owner leads, leasing pipeline** | **HDPM-OS** | authoritative | summaries of won/lost reasons |
| **Workflow state, checklists, tasks** | **HDPM-OS** | authoritative | process outcomes, lessons |
| **EOS: Rocks, scorecard, Issues, To-Dos, meetings** | **HDPM-OS** | authoritative | meeting summaries, decision records |
| **Decisions & commitments** | **HDPM-OS** (row) | authoritative | the durable, searchable record w/ citation to the row |
| **Approvals & agent activity** | **HDPM-OS** (`agent_proposal`, `wo_event`) | authoritative audit trail | aggregated judgment patterns ("decision memory") |
| **SOPs & policies** | Notion today → HDPM-OS process library over time | authoritative (versioned) | indexed for retrieval w/ citations |
| Institutional knowledge (lessons, syntheses) | **Brain layer** | consumer | authoritative for *derived* knowledge only |

Two corollaries:

1. **The brain is never a SoR for transactional data.** It stores durable
   knowledge and *pointers* (citations) into AppFolio/HDPM-OS/M365. If the
   brain and the SoR disagree, the SoR wins and the brain gets corrected.
2. **HDPM-OS never becomes a second ledger.** Money math stays in AppFolio;
   HDPM-OS builds work products around it (invoicing with markup, reconcile
   views) that always tie out against AppFolio data — the pattern already
   shipped in the invoices module.

## 4. Actor boundaries

| Actor | May do | May never do |
|---|---|---|
| **Human staff** | everything their role allows; all approvals | bypass audit (every action logs to `wo_event`/audit) |
| **Craig / management** | change autonomy levels, ceilings config, approve promotions | — |
| **AI agents** | read scoped context packets; create proposals; draft; act only at their earned autonomy level ≤ ceiling | send owner/tenant comms autonomously (hard wall ≥1 human tap, permanent); write to AppFolio ledgers (never); make employment/legal/financial decisions; exceed per-day action caps |
| **Execution layer (Ringer-style workers)** | execute bounded, pre-approved task packets; return artifacts for verification | reach production systems of record; hold long-lived credentials; self-approve |
| **Brain layer** | index, synthesize, cite, flag gaps/contradictions | originate actions; store excluded data classes (screening data, SSNs, ledger detail, legal-privileged) |

These restate and extend the **agent-os Q2 autonomy ceilings** (FACT —
decided by Craig 2026-07-18, encoded in `agent_config`): internal ops max L4;
vendor comms max L3; owner/tenant-facing hard-walled at L2 forever; AppFolio
writes max L2 (only completing an approved tap); ledger writes never.

## 5. Naming and repo direction

**FACT:** the product is already called HDPM-OS (CLAUDE.md, page titles); the
repo/folder is still `hdpm-chatbot`. **RECOMMENDATION:** keep the monorepo and
rename the GitHub repo to `hdpm-os` at a quiet moment (GitHub redirects old
remotes; Vercel needs the project re-pointed — low risk, do it in Phase 0).
The name mismatch is cosmetic; the structure (Next.js app + Supabase + cron
sensors + agent briefs) is the right chassis. See
`10-implementation-roadmap.md` Phase 0 and the restructure verdict in
`01-current-repository-assessment.md`.

## 6. Product principles (carried forward from shipped work)

1. **Sensors → proposals → human taps → earned autonomy.** The deterministic
   tier detects (tripwires, webhooks, crons); agents package decisions; humans
   act with one tap; autonomy is promoted only on evidence (<5% edit/reject
   over ≥4 weeks) and never past ceilings.
2. **Meet staff where they live** — Slack cards, Outlook drafts, SMS for the
   field; the web app is the deep-work surface, not the notification surface.
3. **Adoption before capability.** The Phase-1 gate (≥25 human actions/week
   through cards for 2 consecutive weeks) applies to every new surface,
   including CRM and EOS: if staff don't act through it, stop building on it.
4. **Every claim cites.** Brain answers carry citations to SoR rows/docs;
   agent proposals carry a "why" line; briefs never state numbers the API
   can't produce (e.g., the estimate-amounts constraint).
5. **org_id everywhere, product later.** Single-org build, multi-tenant seams
   (org_id, RLS, config-as-data) kept cheap per agent-os Q7.
