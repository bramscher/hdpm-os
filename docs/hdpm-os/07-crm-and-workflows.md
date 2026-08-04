# HDPM-OS — CRM and Workflow Engine (LeadSimple Replacement)

> Status: exploration draft, 2026-08-03. HDPM-OS is authoritative for CRM and
> workflow state (doc 02 §3). This doc defines the data model, the two
> pipelines (owner acquisition, leasing), the operational workflow catalog,
> and what is configurable vs hard-coded.

## 1. What already exists to build on (FACTS)

- **Lead events land today:** `lead_events` table (`20260407`), AppFolio
  leads webhook (`app/api/webhooks/appfolio-leads`, `lib/lead-webhook.ts`),
  Haven conversations + AF-lead matching (`haven_conversation`,
  `haven_af_lead_link`, `lib/haven-af-match.ts`), website intake
  (`app/api/intake/rental-analysis-request` from hdpm-web), guest-card KPIs
  (`app/api/kpi/guest-cards`), rent analyses (`rent_analyses` with intake
  columns `20260529`).
- **Workflow machinery exists for one domain:** the maintenance state machine
  + single write path + sync rules + tripwires + `next_action_date`
  (doc 01 §8). The general engine below is that pattern, made data-driven.
- **Channel + proposal spine exists:** follow-up nudges, drafts, and
  scheduling ride `agent_proposal`/`agent_outbox` — CRM gets agents "for
  free."

## 2. CRM data model

```
contact         (id, org_id, kind: person|company, name, emails[], phones[],
                 af_ref?, zoom_contact_ref?, source, tags[], created_at)
crm_role        (contact_id, role: owner|owner_prospect|tenant|applicant|
                 vendor|referrer|other, af_entity_ref?, active)
pipeline        (id, org_id, kind: owner_acquisition|leasing|custom, name, stages_json)
deal            (id, org_id, pipeline_id, title, contact_id, stage,
                 value_estimate?, unit_ref?/property_ref?, source_attribution
                 (utm/channel/referrer_contact_id), owner_staff_id,
                 next_action_date, next_action_note, status: open|won|lost,
                 lost_reason?, won_at?, created_at)
activity        (id, org_id, deal_id?/contact_id?, kind: note|call|email|sms|
                 meeting|form|status_change|task, direction?, subject, body_md,
                 source: manual|graph|zoom|haven|web|agent:<n>, source_ref, at, by)
```

Principles:
- **`next_action_date` is mandatory on every open deal** — the CRM inherits
  the tripwire philosophy: no lead sits in a state where nobody is obligated
  to act by a date. A "stale deal" tripwire (no activity + past
  next_action_date) feeds the morning cards and, when recurrent, the Issues
  list.
- **AppFolio remains SoR for the entities**; a `deal` links to AF
  owner/tenant/unit refs the moment they exist. Winning an owner deal
  *creates nothing in AppFolio automatically* — it opens the Owner Onboarding
  workflow whose steps include the human AppFolio setup (≤L2 writes if/when a
  write path exists).
- **Activity capture is passive-first:** Graph/Zoom/Haven events auto-attach
  by contact match (the `haven_af_match` pattern); manual notes are one box.
  Nothing here ingests to the brain except won/lost summaries and decisions
  (doc 04 §4).

## 3. Owner acquisition pipeline (default stages — config, not code)

`New lead → Contacted → Qualified → Appointment → Proposal sent → Agreement →
Onboarding → Won` (+ `Lost` from anywhere, reason required; `Nurture` parking
stage).

- **Capture:** hdpm-web forms (rental-analysis intake already live — it
  should *also* create a deal), phone (Zoom/reception report), referrals
  (referrer_contact_id — referral tracking = query), purchased lists
  (manual import).
- **Qualification:** checklist on the deal (units, location, condition,
  expectations); the rent-analysis tool is the natural lead magnet — a
  completed analysis attaches to the deal.
- **Follow-up:** a CRM Nudge agent (L1/L2) drafts follow-up emails/SMS into
  the proposal spine on `next_action_date`; owner-facing sends stay ≥1 tap
  forever (Q2 wall).
- **Appointment:** Graph calendar booking (delegated scope already in
  session); proposal + agreement tracked as activities with doc links (M365
  SoR for the documents themselves).
- **Won → Onboarding workflow** (§5). **Lost:** reason enum + free text;
  quarterly lost-reason rollup is a scorecard metric.

## 4. Leasing pipeline (default stages)

`Inquiry → Prequalified → Showing scheduled → Shown → Application →
Screening → Approved → Lease prep → Move-in scheduled → Moved in`
(+ `Lost/abandoned` with reason; auto-abandon after N days of silence —
config).

- **Capture:** Haven conversations, guest cards (AF webhook), listing-site
  inquiries via `info@` email triage (agent #10 lane), walk-ins/calls
  (reception report).
- **Prequalification:** scripted criteria checklist (published criteria only
  — the Rentzap screening itself stays external; **no screening data is
  stored**, only status: submitted/approved/denied-without-detail, per
  doc 08).
- **Showings:** self-tour (Haven codebox) or calendar booking; no-show
  auto-follow-up draft.
- **Application/screening:** deep-link to Rentzap (`rentzap.com/apply/<id>` —
  resolution already built in `app/api/generate-listing`); webhook/manual
  status flip.
- **Approval→Lease prep→Move-in:** these stages *mirror* AppFolio actions the
  PMs perform there; the deal tracks state + `next_action_date`, and the
  Move-in workflow instance (§5) carries the checklist (utilities, deposits,
  keys handoff → keys module, inspection scheduling → inspections module).
- Fair-housing note: stage changes record *who/when*, prequalification uses
  only the published-criteria checklist, and agents never draft
  accept/reject reasoning — humans decide, the CRM records (doc 08 §7).

## 5. Workflow engine (generalizing the maintenance pattern)

```
workflow_template (id, org_id, key, name, version, process_id?  -- links SOP (doc 06 §7)
                   trigger: manual|deal_won|deal_stage|event_key|schedule,
                   steps_json)   -- ordered steps: [{key, title, role_or_seat, due_offset_days,
                                  --   kind: task|approval|agent_draft|webhook|checklist[],
                                  --   blocking: bool, evidence_required?: bool}]
workflow_instance (id, org_id, template_id, template_version, subject_type/ref
                   (deal|unit|property|staff|vendor|wo), status, opened_at, closed_at)
workflow_step     (id, instance_id, key, assignee_staff_id, due_on, status:
                   pending|done|skipped|blocked, done_by, done_at, evidence_ref?, notes)
```

- Steps become **tasks on the assignee's morning card**; overdue blocking
  steps trip the stale-workflow tripwire → Issues escalation (doc 06 §5).
- `agent_draft` steps enqueue a proposal (e.g., "draft the owner welcome
  email"); `approval` steps require a named role's tap; `evidence_required`
  steps demand a link/file (the founder-chief-of-staff "evidence" idea).
- Instances pin `template_version`, so process changes don't rewrite
  history; template ↔ `process` linkage makes SOP compliance measurable.

## 6. Workflow catalog (initial templates)

| Template | Trigger | Notes |
|---|---|---|
| Owner onboarding | owner deal won | agreement docs, AF setup checklist, banking (human-only), welcome comms (≥1 tap), property onboarding spawn per property |
| Property onboarding | from owner onboarding / manual | photos, condition/inspection, keys intake (keys module), utilities, listing prep, mgmt-status flip (`property_mgmt_status`) |
| Move-in | leasing deal → lease prep | deposits confirmed (human), utilities, keys handoff, move-in inspection schedule (inspections module), welcome packet |
| Lease renewal | schedule: T-90d from `lease_expirations` KPI feed | comps check (comps module), owner consult (≥1 tap draft), offer, signed, AF update (human/≤L2) |
| Delinquency | AF delinquency data via Reports API | day-based ladder: reminder draft → notice prep (PM lane; ORS 90 corpus cited) → escalation; **all tenant-facing sends ≥1 tap, notices human-served** |
| Maintenance escalation | tripwire recurrence | formalizes today's escalation DMs into steps |
| Complaint | manual/email-triage | acknowledge, investigate, resolve, log lesson to brain |
| Inspection cycle | existing cadence engine | wrap the shipped candidates/notices flow as instances |
| Vendor onboarding | manual | W-9/insurance/license links **to AppFolio SoR** (per existing decision: not stored in Supabase), rate sheet, trial jobs |
| Employee onboarding / offboarding | manual (HR-lite) | accounts (M365/Slack/Zoom/AppFolio checklists), *no HR records stored* — checklist state only; offboarding = access-revocation checklist w/ evidence |
| Incident management | manual/agent-filed | severity, timeline, comms log, post-mortem → brain |
| Compliance reminders | schedule | license/insurance expiries (vendor table has expiry fields), city registrations |
| Process audit | quarterly schedule | dispatches a read-only execution-layer run (doc 05) comparing SOP vs. checklist reality → Issues |

## 7. Configurable vs hard-coded

**Config (data):** pipeline stages, workflow templates/steps/offsets/roles,
lost reasons, nudge cadences, auto-abandon windows, tripwire thresholds,
autonomy levels (already data). Editing UI can wait — seed via migration +
JSON edit screen; a full workflow builder is a later product feature.
**Hard-coded (invariants):** approval classes and ceilings, evidence rules,
audit logging, the ban on storing screening/HR/ledger data, tenant/owner
send walls, template versioning semantics. Guardrails are never tenant
config.

## 8. UI

- **Pipelines:** kanban per pipeline + "my deals needing action today" list
  (feeds morning cards); deal drawer = timeline (activities), checklist,
  next-action editor.
- **Workflows:** instance view (steps, owners, due dates, evidence);
  "my steps" merged into the same daily card. One task surface, not three.
- Reuse the board/kanban idioms already shipped in maintenance views.

## 9. Sequencing

Phase 3 (after EOS layer): owner-acquisition pipeline first (it's greenfield
revenue and has the fewest integration dependencies — web intake + rent
analyses + Graph/Zoom capture already exist), then leasing (wire Haven +
guest cards + email triage), then the workflow engine with **two** templates
(owner onboarding, lease renewal) before the catalog. Ship agents on CRM
only after the human loop is adopted (Phase-1-gate philosophy).
