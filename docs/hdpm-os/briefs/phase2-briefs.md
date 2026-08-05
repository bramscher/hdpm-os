# HDPM-OS Phase 2 — EOS Operating Layer: Session Briefs

> Created 2026-08-04 on `feature/hdpmos`. Phase 2 objective (roadmap doc 10):
> close the management loop — scorecard → issues → decisions → to-dos →
> memory. Design source: `docs/hdpm-os/06-eos-operating-layer.md` +
> `briefs/audit-event-design.md`. Sequencing per doc 06 §10: Scorecard +
> Issues + To-Dos + meeting screen first; Rocks/quarterly and the chart are
> fast-follows. One brief per session, in order.
>
> Phase acceptance (doc 10): 4 consecutive weekly meetings run in-tool;
> ≥90% to-do completion tracked; decisions land in the brain with citations.
>
> **ASSUMPTION to validate with Craig (doc 06 §10):** HDPM runs no formal
> L10 today — the tooling must make the first meeting trivially runnable
> (`meeting.kind` is data; a lighter "huddle" variant uses the same tables).

## Brief 2A — EOS core schema + audit_event + provisional seeds  ⟵ SHIPPED 2026-08-04 (code-complete)

> **Execution notes:** migration `20260804_eos_core.sql` (11 tables incl.
> audit_event; people columns FK staff.person; open-issue dedupe via partial
> unique index on source_ref; issue.solved_decision_id via ALTER after
> decision). `lib/audit.ts` logAudit (best-effort, loud on failure),
> `lib/eos/types.ts`. Seed `scripts/eos/seed-eos.ts`: 8 provisional seats
> (Craig/Cheryl/Brody/Ashley/Bryce placed from recorded facts; Integrator/
> Finance/Leasing open) + 7 weekly metrics wired to live metrics_snapshot
> keys, goals PROVISIONAL. **Operator steps: (1) run the migration in the
> SQL editor, (2) `npx tsx --env-file=.env.local scripts/eos/seed-eos.ts`,
> (3) review seat occupancy + metric goals with Craig before the first
> meeting.** 2B is blocked on step 1.

Migration `20260804_eos_core.sql`: the doc 06 §2 tables (`seat`, `rock`,
`scorecard_metric`, `scorecard_entry`, `issue`, `todo`, `meeting`,
`meeting_item`, `decision`, `process`) **adapted to the real staff PK**
(`staff.person` TEXT, not a uuid) + `audit_event` exactly per the design
note (append-only, no update policy). RLS per convention. `lib/audit.ts`
(`logAudit` — best-effort, never blocks the caller), `lib/eos/types.ts`.
Seed script `scripts/eos/seed-eos.ts` (idempotent): provisional seats from
known facts (Craig/Cheryl/Brody/Bryce/Ashley; occupancy + goals flagged
PROVISIONAL for Craig's edit) and scorecard metrics wired to live
`metrics_snapshot` keys. Operator step: SQL run, then the seed script.

## Brief 2B — Scorecard: auto-fill, Friday cards, screen  ⟵ SHIPPED 2026-08-04

> Shipped: lib/eos/scorecard.ts (pure week math/goal eval, tested) +
> scorecard-run.ts (auto-fill from metrics_snapshot — manual entries never
> clobbered; Slack nudge to owners of manual metrics missing this week's
> number; off-track-2-weeks → issue via the source_ref dedupe index; every
> write audits). Cron /api/eos/cron/scorecard (Fri 22:00 UTC ≈ 3 PM PT,
> after the 13:30 metrics snapshot) + PUBLIC_PREFIXES + vercel.json —
> activates on merge to main. Screen /company/scorecard (Company nav item):
> 8-week grid, red/green, sparkline, manual-entry cell, [→ Issue] via
> POST /api/eos/issues (also 2C's create surface). First live week filled
> (2026-08-03: 7/7 metrics, 3 green / 4 red — several reds are provisional-
> goal artifacts; goal review with Craig is the open step-3 item).

Weekly auto-entry cron (Friday): `source_ref`-mapped metrics pull the week's
value from `metrics_snapshot`/`kpi_snapshots` into `scorecard_entry`
(`source: auto`, on_track vs goal_op/value); manual metrics send the owner a
Friday Slack card (outbox pattern) that writes `source: manual`. Company →
Scorecard screen: weekly grid, red/green, owner, sparkline, [Drop to
Issues]. Off-track 2 consecutive weeks auto-files an `issue` (dedup by
source_ref). Every write audits.

## Brief 2C — Issues & To-Dos: IDS queue + escalation ladder  ⟵ SHIPPED 2026-08-04

> **Execution notes:** lib/eos/escalation.ts (pure, tested) + escalation-run.ts;
> cron /api/eos/cron/escalation (weekdays 14:15 UTC — after tripwires 13:00
> and chaser 13:45; /api/eos/cron prefix already public). Thresholds were
> **measured, not guessed** — the spec as written would have filed 140 issues
> day one: "recurring 3×" became *episodes* (flag→clear→flag; the daily
> tripwire cron makes distinct-days ≡ persistence), aged threshold 21d,
> tripwire #11 excluded from the tripwire rung (the estimate chaser owns
> that pool; its escalations arrive via rung 2), and each rung caps at 10
> files/run worst-first with deferred counts reported (no silent caps).
> To-do chain: roll copy's source_id = original id; issue ref todo:<rootId>;
> the single nudge fires at roll time (none on the second miss — the issue
> is the visibility). PATCH /api/eos/issues/[id] (solve human-only +
> confirm), POST/PATCH /api/eos/todos. Screen /company/issues (+ Company
> sub-nav via app/company/layout.tsx). Live-verified: roll→missed→issue
> with audits, drip past dedupe, re-run no-ops; test rows cleaned up.
> No migration — the 2A schema covers everything. **Operator step: visual
> pass on /company/issues after merge (localhost SSO is prod-only).**

Company → Issues & To-Dos screen (priority-ordered IDS queue, evidence
side-panel from source_ref; 7-day to-do list). Escalation rungs (doc 06 §5):
aged/recurring tripwire exceptions and agent escalations auto-file issues;
missed to-do rolls once then files an issue; in-app "+ Issue" button.
To-do Slack nudge (one nudge, per adoption rules). Dedupe by open
source_ref. Agents file/draft only — no auto-solve (doc 06 §9).

## Brief 2D — Meetings: runner screen + prep agent + decision→brain  ⟵ SHIPPED 2026-08-04

> **Execution notes:** lib/eos/meeting.ts (pure: L10/huddle agendas,
> prep-packet markdown, solve-outcome validation, brain source keys —
> tested) + meeting-prep-run.ts. Cron /api/eos/cron/meeting-prep (Monday
> 14:30 UTC ≈ 7:30 AM PT): ensures this week's L10 row, writes
> meeting.prep_packet_md (scorecard deltas from the last *completed* week,
> aged issues, to-do done rate, bounded think() context — best-effort),
> proposal + audit, DMs the facilitator (default Craig) a link. IDS solve
> is now gated: PATCH status=solved rejected; POST /api/eos/issues/[id]/solve
> requires a decision and/or to-dos (SolveOutcomeForm shared by Issues
> board + runner), sets solved_decision_id, writes a meeting_item when
> solved in-meeting, ingests the decision (kind fact, source_key
> decision:<id> — idempotent). Conclude (POST /meetings/[id]/conclude)
> fans checked to-dos out as Slack cards and ingests minutes via
> chunkMarkdown (source_key meeting:<id>#i, kind summary). Screens:
> /company/meetings (this-week card + archive) and /company/meetings/[id]
> (stepper + per-step timer, scorecard/todo-review/IDS/conclude steps;
> rock_review is a 2E placeholder; archive view once concluded).
> Live-verified: prep dry-run + real run (packet/proposal/audit; DM path
> skipped via no-slack facilitator, test rows cleaned). No migration.
> **Operator steps: visual pass on /company/meetings after merge; first
> real packet lands next Monday.**

Company → Meetings: run-the-meeting mode (standing agenda stepper + timer,
doc 06 §4) + archive. IDS solve forces a structured outcome (decision row
and/or to-dos — no outcome, no "solved"). Conclude screen fans confirmed
to-dos out as Slack cards. Decision rows + minutes ingest to the brain
(`ingestChunk`, kind 'fact', source_key `decision:<id>`). **Meeting Prep
agent** (reuses Ops Brief pattern): Monday packet — scorecard deltas, aged
issues, related history via `think()` with citations — linked in Slack.

## Brief 2E — Accountability chart + Rocks (fast-follow)

Company → Org: read-only seat chart (roles, metrics, Rocks, and the agents
attached to each seat — agents under seats, never as seats). Rocks quarter
board + Friday one-tap on/off self-report. Quarterly meeting kind + prep
can trail into Phase 2.5 if needed.
