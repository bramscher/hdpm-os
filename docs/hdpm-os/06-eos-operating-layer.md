# HDPM-OS — EOS-Inspired Operating Layer

> Status: exploration draft, 2026-08-03. Design for the company-cadence layer
> (scorecard, Rocks, Issues, To-Dos, meetings, accountability, decisions).
> Deliberately EOS-*inspired*, not a trademarked clone: we adopt the operating
> principles that fit a ~10-person company and wire them into machinery HDPM-OS
> already has (tripwires, `agent_proposal`, `kpi_snapshots`/`metrics_snapshot`,
> Slack cards, Ops Brief agent).

## 1. Why this layer earns its keep here

**FACT:** HDPM-OS already *measures* (daily `kpi_snapshots` since April; agent
`metrics_snapshot` baseline) and already *detects* (12 tripwires, exception
pools) and already *briefs* (Ops Brief agent, daily 5pm + Monday deep). What
is missing is the closed management loop: metrics → issues → discussion →
decision → owned to-do → follow-through → memory. The EOS layer is that loop,
built on the same proposal/audit spine as everything else — not a separate
app.

## 2. Data model (new Supabase tables, all with `org_id` + RLS per convention)

```
seat            (id, org_id, name, roles_json, reports_to_seat_id, staff_id?, gwc_notes)
rock            (id, org_id, title, owner_staff_id, quarter, due_on, status: on|off|done|dropped,
                 milestones_json, created_from_issue_id?, notes)
scorecard_metric(id, org_id, name, owner_staff_id, cadence: weekly|monthly, unit,
                 goal_op: gte|lte, goal_value, source: sql|manual|kpi_snapshot_key,
                 source_ref, active)
scorecard_entry (id, metric_id, week_start, value, on_track bool, source: auto|manual, entered_by)
issue           (id, org_id, title, detail, raised_by: staff|agent:<name>|tripwire:<n>,
                 source_ref (wo id, proposal id, thread link…), priority, status: open|discussed|solved|parked,
                 solved_decision_id?, created_at)
todo            (id, org_id, title, owner_staff_id, due_on (default +7d), source: meeting|issue|decision|agent,
                 source_id, status: open|done|missed|rolled, done_at)
meeting         (id, org_id, kind: L10|quarterly|annual|same_page, starts_at, seat_scope,
                 agenda_json, minutes_md, rating_1_10, facilitator_staff_id)
meeting_item    (id, meeting_id, kind: scorecard|rock_review|headline|todo_review|ids|conclude,
                 ref_table, ref_id, outcome_json, order)
decision        (id, org_id, title, statement_md, context_md, decided_by, decided_in_meeting_id?,
                 issue_id?, effective_on, supersedes_decision_id?, status: active|superseded,
                 created_at)
process         (id, org_id, name, owner_seat_id, steps_md (versioned), version, status,
                 source: notion_sync|native, followed_by_pct?)   -- process library
```

Reuse, don't duplicate:
- **Scorecard values** come from `kpi_snapshots` / `metrics_snapshot` where a
  `source_ref` key exists (auto rows); manual metrics get a Friday Slack card
  ("enter this week's number") to the metric owner.
- **To-Dos** are *not* a second task system: operational work items stay where
  they live (WO `next_action_date`, turn steps, chase queues). A `todo` row is
  a *commitment made in the management cadence* — smaller, personal, 7-day.
- **Issues** link to their evidence (`source_ref`), so IDS starts from data,
  not recollection.
- **Decisions** are first-class rows (the durable log the brain indexes), with
  `supersedes` chaining so policy history is queryable.

## 3. Accountability Chart

Seats, not people: `seat` rows form the chart (Visionary, Integrator,
Maintenance Coordinator, Front Desk, Finance, PM lane, Inspection, Field
Lead…), each with 3–5 roles and an occupant (`staff_id`, nullable = open
seat). **FACT:** the roster and role facts already exist (Notion "HDPM Roles
and Responsibilities" doc, mirrored into `docs/agent-os/01`); seed from that.
UI: an org-chart view (reference: FounderOS-DEMO `PersonaOrgChart`) with each
seat showing its roles, its metrics, its Rocks, and — a deliberate extension —
**the agents attached to that seat** (Cheryl's seat lists Morning Card,
Estimate Chaser…). Agents appear *under* seats, never as seats.

## 4. Weekly cadence (the L10-style meeting)

Standing agenda, timed, run from a single meeting screen:

1. **Segue** (5m) — personal/professional good news. Manual.
2. **Scorecard** (5m) — auto-rendered from `scorecard_entry`; off-track
   numbers get one-tap **[Drop to Issues]**.
3. **Rock review** (5m) — each Rock on/off track; off-track → **[Drop to Issues]**.
4. **Headlines** (5m) — customer/employee headlines; agent-surfaced headlines
   appear pre-listed (e.g. "Firkus cleared 12 WOs this week").
5. **To-Do review** (5m) — last week's `todo` rows, done/not-done; the done
   rate is itself a scorecard metric (target ≥90%).
6. **IDS** (60m) — the Issues list, priority-ordered. Solving an issue forces
   a structured outcome: a `decision` row, one or more `todo` rows, or a Rock
   proposal. No outcome, no "solved."
7. **Conclude** (5m) — recap to-dos, cascade messages, rate the meeting.

**Agent participation (bounded):**
- *Before:* a **Meeting Prep agent** assembles the packet — scorecard deltas,
  Rock status, aged issues, related history from the brain ("we discussed
  Firkus 3 weeks ago; decision #42 said…") — as a doc attached to the meeting
  row. This is the "GBrain prepares meeting context" flow: retrieval + cited
  synthesis, read-only.
- *During:* optional transcription (Zoom) → the agent drafts minutes and
  extracts candidate to-dos/decisions **as proposals** the facilitator
  confirms on the Conclude screen. Nothing enters the record un-tapped.
- *After:* confirmed to-dos fan out as Slack cards to owners; the decision row
  + minutes are ingested into the brain with citations; approved follow-up
  work that is mechanical (e.g. "re-run the vendor cost comparison") can be
  dispatched to the execution layer (see `05-ringer-agent-execution.md`).

## 5. How operational events become Issues (the escalation ladder)

The detection tier already exists; add one rung:

| Signal | Today | EOS layer addition |
|---|---|---|
| Tripwire exception | board + morning card | if aged > threshold or recurring 3×, auto-file an `issue` (raised_by `tripwire:<n>`, evidence attached) |
| Agent escalation (chase 3×/45d, emergency) | Slack DM to Craig / Ops Brief | also files an `issue` so it can't evaporate from a DM |
| Missed `todo` | — | rolls once; twice-missed auto-files an issue on the owner's seat |
| Off-track scorecard metric 2 wks | — | auto-files an issue |
| Staff ad-hoc | — | `/issue` Slack shortcut + in-app button; agents pre-fill evidence |

Auto-filed issues are deduplicated against open ones (same source_ref) so the
list stays honest. Escalation of overdue commitments: to-do missed → owner
nudged (one nudge, per adoption rules) → missed again → issue on the list →
discussed with the human in the room, not punished by a bot. **The system
escalates visibility, never applies pressure autonomously.**

## 6. Quarterly & annual

- **Rocks:** 3–7 per company + 1–3 per seat, set in a quarterly meeting from
  the parked-issues list + vision doc; milestones optional; weekly on/off
  self-report is one tap from the owner's Friday card.
- **Quarterly meeting kind** with its own agenda (prior-quarter review, V/TO
  refresh, Rock setting); the prep agent drafts the prior-quarter review from
  scorecard history + Rock outcomes + decision log — with citations.
- **V/TO:** a versioned markdown doc in the process library (core values,
  focus, 10-year target, marketing strategy, 3-year picture, 1-year plan) —
  edited by humans, indexed by the brain, cited by agents when drafting
  anything strategy-adjacent.

## 7. Process library (SOPs)

**FACT:** SOPs live in Notion today and are already synced/chunked for the
knowledge chat (42 pages / 326 chunks, weekly cron). Phase 1: keep Notion as
the *editing* surface; the `process` table mirrors each SOP with version
hashes so workflows can pin "this checklist implements SOP v7". Later
(optional): native editing in HDPM-OS if Notion friction shows up. Every
workflow template (see `07-crm-and-workflows.md`) references a `process` row —
that's how "followed by all" becomes measurable (checklist completion rate per
process).

## 8. UI

One new nav section, **Company** (deep-work surface), four screens:
1. **Scorecard** — weekly grid, owner avatars, sparklines, red/green,
   [Drop to Issues].
2. **Rocks** — quarter board by seat, on/off badges.
3. **Issues & To-Dos** — the IDS queue + 7-day list, evidence side-panel.
4. **Meetings** — run-the-meeting mode (agenda stepper + timer) and archive
   (minutes, decisions, rating trend).
Plus the **Accountability Chart** under Company → Org.
The *notification* surface stays Slack: Friday metric-entry cards, Monday
meeting-prep packet link, to-do nudges — per the "meet staff where they live"
principle. Weekly meeting attendance must not require learning the app first;
the meeting screen is the facilitator's tool.

## 9. Approval boundaries in this layer

- Agents may **file** issues, **draft** minutes/decisions/to-dos, **prepare**
  packets: all L1/L2 (proposal + tap).
- Agents never mark an issue solved, never create a decision row unilaterally,
  never rate people. Scorecard auto-entries are marked `source: auto` and are
  overridable; disputed numbers become issues, not silent edits.
- Employment-adjacent content (seat changes, GWC notes, performance) is
  human-only: agents don't draft it, the brain stores only what a human
  explicitly publishes to the record. (See `08-security-and-permissions.md`.)

## 10. Build notes & sequencing

Phase 2 of the roadmap (after brain PoC): ship **Scorecard + Issues + To-Dos +
the weekly meeting screen** first — that's the minimum loop that changes
Monday mornings. Rocks and quarterly tooling are a fast-follow; the
accountability chart can start as a seeded read-only page. Estimated schema:
~9 tables, all conventional CRUD + one meeting-runner screen; the only novel
engineering is the prep-packet agent, which reuses the Ops Brief pattern.
**ASSUMPTION to validate with Craig:** HDPM does not currently run formal
L10s — the tool should make the first one easy to run, not assume an existing
habit. If a lighter "weekly huddle" variant fits better, the same tables
serve it (meeting.kind is data).
