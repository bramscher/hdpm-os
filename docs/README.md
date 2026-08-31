# HDPM-OS — Documentation Index

> **Canonical current plan:** [`agent-os/10-restart-2026-08-20.md`](agent-os/10-restart-2026-08-20.md).
> Everything else is **reference** or **historical** unless marked CANONICAL below. Read
> [`../CLAUDE.md`](../CLAUDE.md) first — it names the active priorities.

The `docs/` tree accreted across several strategy pushes. This index says what each family is, whether
it reflects the live app, and whether it's safe to edit — so a doc's age or confident voice isn't
mistaken for current truth.

## Status legend

- **CANONICAL** — current source of truth for a live feature or the active plan. Keep it accurate.
- **REFERENCE** — still-useful background (architecture, conventions, external patterns, API blueprints). Durable; edit only to correct.
- **HISTORICAL** — a point-in-time record (build briefs, evals, investigation notes, dated explorations). **Do not edit** — it documents a moment.
- **SUPERSEDED** — obsolete or describes work that was never built. Kept for the idea, not the state.

## Start here (reading order)

1. [`../CLAUDE.md`](../CLAUDE.md) — priorities and house rules
2. [`agent-os/10-restart-2026-08-20.md`](agent-os/10-restart-2026-08-20.md) — the governing plan (motion, Loop 1, the gate)
3. [`agent-os/00-DRAFT-master-plan.md`](agent-os/00-DRAFT-master-plan.md) — architecture, autonomy ladder, roster (its *rollout* is superseded by #2)
4. The per-feature spec for whatever you're working on (see the map below)

## Doc families

| Family / doc | Status | What it is |
|---|---|---|
| **agent-os/** | **CANONICAL** | The agent layer's current plan + conventions. |
| — `10-restart-2026-08-20.md` | CANONICAL | Governing plan — supersedes the master-plan rollout. |
| — `00-DRAFT-master-plan.md` | REFERENCE | Architecture/ladder/roster still valid; rollout superseded (has a banner). |
| — `11-writepath-spike.md`, `12-hybrid-write-layer.md` | REFERENCE | Forward-looking write-path design; **not built** (Sep-4 decision). |
| — `01-questions-and-answers.md`, `02-brief-b-conventions.md` | REFERENCE | Q&A input + the still-current agent conventions. |
| **dez/** | **CANONICAL** | `00-dez-spec.md` (v0.3) — the live Dez Slack agent. |
| **partners/** | **CANONICAL** | The live referral partner portal (`/partners`); active build log. |
| **maintenance-os/** | **REFERENCE** (live spec) | Behavioral contract for the shipped Maintenance OS board. `02-functional-spec.md` governs tripwires. |
| — `07-wave1-redirect.md` | HISTORICAL | Prior priorities doc (superseded). |
| **hdpm-os/** | **REFERENCE** | 2026-08-03 architecture exploration; background, not current state. |
| — `06-eos-operating-layer.md` | REFERENCE (shipped spec) | Behavioral spec for the live Company/EOS layer. |
| — `13-mission-agents-and-schematic.md` | REFERENCE | Roster/schematic the README links as source of truth. |
| — `briefs/*`, `audit-event-design.md` | HISTORICAL | Point-in-time build briefs (phases shipped). Do not edit. |
| **soul-brain/** | **SUPERSEDED** | Aspirational company-soul design; **not built**. Live memory is `lib/brain/*`. |
| — `konmashi-reference/*` | REFERENCE (external) | Proven Kompass/Konmashi patterns; read-only. |
| **demo-site/** | **HISTORICAL** | 7/22 concept demo; there is no `/demo` route. |
| **Loose `docs/*.md`** | | |
| — `inspection-creation-sop.md` | CANONICAL (SOP) | Live inspections SOP. |
| — `inspection-notice-dispatch.md`, `inspection-notices-appfolio.md`, `realm-x-automation.md` | REFERENCE | Tenant-notice dispatch runbooks. |
| — `appfolio-image-api-reference.md`, `appfolio-property-photos-api-call.md` | REFERENCE | AppFolio API blueprints. |
| — `AZURE_AD_SETUP.md` | REFERENCE | Auth setup guide. |
| — `HDPM-Dashboard-KPI-Spec.md` | HISTORICAL / partly-stale | Old KPI spec (old repo name; assumes unbuilt QuickBooks). Partly realized as `/dashboard`. |
| — `CONTEXT_ISSUES.md`, `INVESTIGATION_FINDINGS.md`, `eval/brain-golden.md` | HISTORICAL | Dated debugging / eval notes. Do not edit. |

## Which doc governs which surface

| Surface / feature | Governing doc |
|---|---|
| Maintenance board (`/maintenance/board`) | `maintenance-os/02-functional-spec.md` |
| Company / EOS layer (`/company/*`) | `hdpm-os/06-eos-operating-layer.md` |
| Dez Slack agent (`/api/agents/slack/events`) | `dez/00-dez-spec.md` |
| Referral partner portal (`/partners`) | `partners/00-referral-portal-plan.md` |
| Agent autonomy / write path | `agent-os/10-restart` + `11-writepath-spike` |
| Inspections | `inspection-creation-sop.md` + `inspection-notice-dispatch.md` |

## Active build tracks vs. frozen

- **Live code, actively maintained:** `agent-os` (Loop 1 estimate chase), `dez`, `partners`, plus the shipped `maintenance-os` and EOS (`hdpm-os/06`) surfaces.
- **Design-only / not built:** `soul-brain`, `demo-site`, `agent-os/11` & `12` (write path — pending the Sep-4 decision).
- Note: `dez` and `partners` are newer tracks that run alongside the restart plan's Loop-1 focus; they have live code and are canonical for their features.

*Keep this index current when adding a doc family or shipping/retiring a feature.*
