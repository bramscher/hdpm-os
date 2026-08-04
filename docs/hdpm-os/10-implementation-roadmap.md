# HDPM-OS — Phased Implementation Roadmap

> Status: exploration draft, 2026-08-03. Phases are sequential gates, not a
> calendar; each inherits the maintenance-os conventions (one brief per
> session, plan mode first) and the agent-os adoption gates (a phase that
> staff don't use blocks the next). The agent-os rollout (Briefs A–F,
> Phases 0–4 there) continues in parallel — this roadmap adds the OS-level
> layers around it and must not stall it.

## Phase 0 — Foundation & hardening

- **Objective:** make the chassis safe and reproducible for everything after.
- **Scope:** Auth.js v5 + DB roles (retire `ADMIN_EMAILS`); centralize
  session guards; capture missing RAG-core migrations; secrets pass +
  per-service tokens; `audit_event` generalization design; middleware→proxy;
  repo rename `hdpm-os`; dead-code sweep (`/api/work-orders` legacy);
  CI check for secrets. Stand up the **Ringer dev workbench** (fenced,
  synthetic/repo data only) for our own build chores.
- **Dependencies:** none. **Risks:** auth migration regressions (mitigate:
  staging + the 8h-JWT window); scope creep (this is hardening, not
  features).
- **Acceptance:** all roles DB-backed; new-table RLS convention documented;
  `supabase db reset` reproduces the full schema; zero secrets in repo
  history scan.
- **Deliberately not built:** any new product surface.

## Phase 1 — Company brain proof of concept

- **Objective:** prove cited, gap-aware institutional memory on real (C2)
  content.
- **Scope:** `brain.*` schema (doc 04 §3); ingest decisions/meeting notes
  (seed: docs/, agent-os decisions, Notion SOPs already synced); `think`
  synthesis with citations + gap analysis in the knowledge chat; nightly
  consolidation cron (dedup/contradiction/salience — port soul-brain evolve
  pattern); MCP endpoint for agents; optional pinned-GBrain calibration
  appliance on public content.
- **Dependencies:** Phase 0 tokens/roles. **Risks:** retrieval quality
  (measure P@5 vs 0.68 baseline); noise ingestion (allowlist discipline).
- **Acceptance:** 10 golden questions answered with correct citations; gap
  analysis correctly reports 3 known-unknowns; Ops Brief cites the brain.
- **Not built:** graph querying, Slack/email wide capture, restricted-tier
  content.

## Phase 2 — EOS operating layer

- **Objective:** close the management loop (scorecard → issues → decisions →
  to-dos → memory).
- **Scope:** doc 06 tables; Scorecard/Issues/To-Dos/Meeting-runner screens;
  tripwire→issue escalation rung; Friday metric cards + Monday prep packet
  (Meeting Prep agent reusing Ops Brief pattern); decision log ingesting to
  brain; seed accountability chart.
- **Dependencies:** Phase 1 (prep packets cite the brain). **Risks:** cadence
  adoption — mitigate by making the first L10 trivially runnable and by the
  agent pre-filling everything; ASSUMPTION to validate: no formal L10 habit
  exists today.
- **Acceptance:** 4 consecutive weekly meetings run in-tool; ≥90% to-do
  completion visible; ≥5 issues IDS'd with decisions logged and retrievable
  with citations.
- **Not built:** quarterly/annual tooling beyond a parked-Rocks list; V/TO
  editor (a markdown doc suffices).

## Phase 3 — CRM & workflow engine

- **Objective:** LeadSimple-class pipelines + configurable operational
  workflows.
- **Scope:** doc 07 CRM tables; owner-acquisition pipeline (web intake →
  deal), then leasing (Haven/guest-card/email-triage capture); workflow
  engine + two templates (owner onboarding, lease renewal); stale-deal
  tripwire → morning cards; CRM Nudge agent at L1.
- **Dependencies:** Phase 0 roles (C3 gates), agent-os email triage (#10)
  for leasing capture; Phase 2 optional but synergistic (lost-reason
  scorecard).
- **Risks:** double-entry vs AppFolio (mitigate: link-don't-copy, win →
  onboarding checklist); pipeline abandonment (gate: ≥20 deals actively
  worked in month 1).
- **Acceptance:** every new owner lead flows web→deal→won/lost with
  attribution; renewal template drives ≥1 real renewal cycle end-to-end.
- **Not built:** workflow builder UI (templates seed via migration); the
  full 13-template catalog; marketing automation.

## Phase 4 — Agent execution layer (Ringer-pattern runner)

- **Objective:** bounded, verified, costed agent work under approval.
- **Scope:** `work_run` table + orchestrator dispatch + context-packet
  builder (brain-fed, redaction rules); one flagship read-only case
  (quarterly SOP-drift audit → Issues); Runs tab in Agents console (cost,
  pass rates); failure→issue escalation.
- **Dependencies:** Phases 1–2 (brain packets, Issues sink). **Risks:**
  verification theater for prose work — mitigate per doc 05 §3.3 (structural
  checks + adversarial review + human acceptance, honest `verified` labels).
- **Acceptance:** 3 run types completing with executed checks, per-run cost
  visible, zero side-effect capability demonstrated (no credentials on
  runner).
- **Not built:** side-effectful runs (permanently, at this layer);
  Ringer-as-a-service.

## Phase 5 — Source-system deepening

- **Objective:** widen ingestion + close the write loop where approved.
- **Scope:** Slack capture shortcut (📌 → brain proposal); Graph mail filing
  → CRM activities beyond cheryl@/info@ (one policy-scoped mailbox at a
  time); Zoom summaries → CRM; AppFolio write path per the Sep-4 decision
  (≤L2, completing approved taps); delinquency/renewal data feeds from
  Reports API.
- **Dependencies:** Sep-4 outcome; Phase 3 CRM. **Risks:** mailbox privacy
  (per-mailbox consent + scoping); write-path cost ($850/mo) vs measured
  retyping (wo_event query per agent-os).
- **Acceptance:** approved taps that used to require retyping now complete in
  AppFolio (if path purchased); brain captures ≥10 human-pinned Slack
  decisions/month.
- **Not built:** inbox-wide indexing, auto-filed communications without
  human confirmation.

## Phase 6 — Department agents (widening the roster)

- **Objective:** per-seat agents beyond maintenance, riding proven rails.
- **Scope:** PM-lane Compliance & Move-Cycle agent (scoped with Jen
  post-leave, piloted with Kennedy — per agent-os); CRM follow-up promotion
  to L2; leasing intake agent; meeting-prep everywhere; earned-autonomy
  promotions per the <5%/4-week rule.
- **Dependencies:** Phase 3 workflows; adoption gates passed per seat.
- **Risks:** roster sprawl — every agent must map to a seat's real chore and
  carry an adoption hook. **Acceptance:** each new agent hits ≥25 human
  actions/week through its surface within 4 weeks or gets pulled.
- **Not built:** tenant/owner-facing autonomy (permanent wall).

## Phase 7 — Advanced automation & analytics

- **Objective:** compounding intelligence and the product seam.
- **Scope:** decision-memory-informed proposals (brain judgment patterns);
  cross-system synthesis views (unit/owner 360 pages fed by graph edges);
  scorecard forecasting; per-door cost/economics analytics; multi-tenant
  hardening if the agent-team product path (agent-os Part 5) activates —
  noting the Ringer license would require our internal runner (already the
  plan).
- **Dependencies:** everything prior + real usage data. **Risks:** building
  analytics nobody reads — every view must be pulled by a named consumer.
- **Not built until a design partner exists:** billing, onboarding,
  white-label, SOC2 (per agent-os Q7).

## Sequencing note

Phases 1–2 are deliberately before CRM: memory + management cadence make
every later layer smarter and are the cheapest wins on the shipped chassis.
If business pressure demands CRM first (owner-lead flow is revenue), Phase 3
can swap ahead of Phase 2 with only the lost-reason-scorecard synergy
deferred — Phase 1 should stay first regardless.
