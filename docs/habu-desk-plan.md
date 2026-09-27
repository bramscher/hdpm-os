---
ontology: true
type: plan
domain: hdpm-os
status: draft
tags: [habu, paper-workflow, desk, folders, pdf, scan-back, appfolio]
relatedTo: [docs/HABU-paper-workflow-demo.md, docs/habu-workflow-review.md, docs/habu-vacancy-pilot.md, lib/habu-paper/model.ts]
summary: Plan for "The Desk" — a per-person view of circulating colored folders, with a tracked life cycle for paper forms (prefill, print, scan back, file to AppFolio).
---

# The Desk — plan (2026-09-27)

## Problem

Colored folders (jackets) circulate the office. Each person keeps them in a tiered desk holder or an in-basket and should work them in order. Forms inside are PDFs that are partly filled, printed, hand-written on as they move, then scanned back to the tenant, owner or property record in AppFolio. Today nothing tracks where a folder is, what's inside it, or whether its paperwork reached AppFolio. Process Street and similar tools were considered and judged too heavy.

## Idea

Mirror the physical desk instead of introducing a workflow tool. The folder stays the unit of work; the app knows where each folder is, what is next, and where each document stands.

- **Folder (jacket)** = one case (vacancy, new tenant setup, owner onboarding, …). Color and type match the physical folder. Front (fields), back (notes, work orders), routing slip ("How this sheet moves", assigned to *people* with a role fallback), folder contents (documents).
- **Desk** = one screen per person with trays: **In** (my move, oldest/most urgent on top), **Waiting on** (I hold it, blocked, with follow-up date), **Passed on** (where my folders went). Plus an office-wide "where is every folder" view.
- **Document life cycle**: Prefill in app → Print (QR + ID stamped in the corner, e.g. `VT-104 · Move-out inspection · v2`) → On paper (hand-written, circulating) → Scanned back (QR identifies folder and document) → Filed in AppFolio (guided first; automatic if the API allows uploads). A folder is complete only when every step is signed off and every required document is filed.
- **Handoffs**: "Pass to…" on the Desk (later: scan the folder QR with a phone). The folder moves to the next person's In tray; optional Slack DM (reuse the Activities DM infrastructure).

## What already exists (reuse)

`lib/habu-paper/model.ts` and `review.ts`: vacancy (gold) and setup (green) templates, the `needs[]` routing graph, handoff rules (`releaseIssues`, `releaseAssignment`), waiting/follow-up, work orders, history, priority/overdue inbox ordering — all unit tested. `lib/habu-paper/form-drafts.ts`: 15 transcribed forms. `app/admin/habu-paper` route modal ("How this sheet moves"). All of it is client-state demo only: no persistence, no PDF filling, no scan-back, no AppFolio filing, roles rather than people.

## Stages

| Stage | Scope |
|---|---|
| 0. Demo | `/desk-demo` — clickable Desk following one gold vacancy folder end to end; sample data, nothing saved. For team buy-in. |
| 1. Real folders | Supabase folders/steps/handoffs/history; people-based routing (role fallback); gold + green; Slack DM on arrival; reuse model.ts rules server-side. |
| 2. Forms | pdf-lib prefill of the real PDFs + QR stamp + print; per-document status. |
| 3. Scan back & file | Upload/scan-to-email ingest with QR matching and human confirm; guided AppFolio filing (standard file name + record link + mark filed); automate if AppFolio write scope allows (open question, see docs/maintenance-os/03-build-waves.md §Blocking Unknown). |
| 4. More | Additional folder colors/types, time-on-desk stats, bottleneck view. |

## Open questions (for Craig)

1. Folder colors → meaning (gold = vacancy, green = new tenant setup; what else circulates?).
2. Office scanner model and whether it can scan to email or a network folder (decides scan-back ingest).
3. Which documents are *required* to be filed in AppFolio per folder type, and to which record (tenant / owner / property).
