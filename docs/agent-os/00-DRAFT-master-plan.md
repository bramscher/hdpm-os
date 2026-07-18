# HDPM-OS Agent Team — Master Plan (DRAFT for Craig, 2026-07-18)

> Status: DRAFT produced by a cloud planning agent seeded with full repo/live-system
> context. Craig has NOT yet answered Part 1. Once answered, this splits into the
> numbered docs + session briefs listed in Part 6 (maintenance-os conventions:
> one brief per session, plan mode first).

**Thesis:** HDPM-OS already *detects* everything (12 tripwires, 205 live exceptions, vendor scoreboard, digests). What it lacks is *motion*: since July 1 there is exactly one human action in the audit trail. The agent layer's job is not more detection — it is converting exceptions into staff actions **in the channels staff already live in**, then earning autonomy step by step. Every design choice below is subordinated to that.

---

## Part 1 — Clarifying questions for Craig (answer these first)

Each question ships with a working assumption so the plan is executable even before you answer. Where your answer differs, the plan flexes at a marked seam.

**Q1. Channel: Teams, not Slack — confirm?**
You're an M365 shop (Azure AD auth, Outlook, Graph integration already built for day-route events; Teams licensed today). Slack means a new tool, new logins, new admin surface — for a team that hasn't logged one action in the current tool, adding another tool is the anti-pattern. Teams Adaptive Cards give us actionable buttons (Approve / Set date / Reassign) that post straight to HDPM-OS APIs, and the Graph credentials largely exist.
*Assumption: Teams for desk staff (Cheryl, Jen, Penny, Bryce, Craig) + SMS for field techs (Alberto, Brody). Slack only if you personally want it as a second surface. In-app stays the deep-work surface, not the notification surface.*
- Q1a. Do Alberto/Brody actually read Teams on their phones, or is SMS the only channel that lands? (Zoom Phone SMS vs the paused Twilio/10DLC path — which do we resurrect?)

**Q2. Per-process autonomy ceilings.** For each of these, what's the *maximum* autonomy you'll ever allow, so we design the ladder to it: (a) setting next-action dates, (b) drafting vendor chase emails, (c) *sending* vendor chases, (d) drafting owner approval requests, (e) sending owner-facing anything, (f) assigning WOs to techs, (g) writing to AppFolio (post-Sep 4), (h) invoice creation, (i) tenant notices.
*Assumption: owner-facing and tenant-facing sends always keep a human approval tap; internal nudges and date-setting can eventually go autonomous.*

**Q3. Which pain first?** The data says estimate approvals (78 stuck, median >30 days — the biggest pool of stuck money) and past-due next actions (89). But data isn't the same as what the team feels. Whose week do you most want to change first: Cheryl's, Jen's, or yours?
*Assumption: Jen's estimate chase + Cheryl's daily action card, in parallel, because they share infrastructure.*

**Q4. Haven.AI reality.** Tripwires #1 and #9 are stubbed pending Haven API access. What does the contract actually give us — a REST API, webhooks, email digests of calls, or nothing programmatic? Who's the contact to ask? Is Haven staying, or is it on the table too?
*Assumption: no API until proven otherwise; intake agent phases in via whatever export Haven provides (even email parsing) and upgrades when/if an API appears.*

**Q5. Budget envelope.** Rough monthly ceiling for the agent layer all-in: model tokens (triage measured ~4¢/WO; a full agent team plausibly $100–400/mo at your volume), a small always-on worker ($20–50/mo), Teams bot registration (free), 10DLC (~$50 setup + low monthly), and the big one — the $850/mo AppFolio Write API. Is the write API a "yes if the pilot proves X" (define X now — proposed: agents generate ≥40 approved-but-manually-retyped AppFolio touches/week by Sep 4, measured via wo_event), or a hard no for 2026?

**Q6. Bryce.** He's on the team list but his workflows aren't in any doc. What does Bryce own? (Leasing? Inspections? Turns?) This determines whether the Leasing/Inspections agents below are his or split across Cheryl/Penny.

**Q7. Product ambition.** Is the sellable product a real goal with a timeline, or an option to keep open cheaply? This changes how much multi-tenant plumbing we do now (org_id + RLS from day 1 is cheap; billing, onboarding, white-label are not). And: sell *the whole OS* or *the agent team as an AppFolio add-on* (the second is the faster wedge — see Part 5)?
*Assumption: keep the option open cheaply now (org_id/RLS/config-as-data), decide seriously after the HDPM case study exists — realistically Q1 2027.*

**Q8. Sep 4 decision framing.** The gate is build vs Jobber vs Realm-X. Does this agent plan *become* the "build" case at that meeting? If so, the Phase 1 metrics below are your decision inputs and Phase 1 should be readable by ~Aug 25.

---

## Part 2 — Architecture

### Runtime options compared

| Option | What it is | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. In-app crons (status quo)** | Vercel crons + Next.js API routes + batch AI calls | Exists, proven (triage, tripwires, digests), zero new infra | Short-lived invocations only; no conversational loop; no inbound channel listeners; Vercel timeouts fight agent loops | Keep — for deterministic detection and batch jobs |
| **B. Agent service (Claude Agent SDK worker)** | One small always-on Node service (Railway/Fly/ECS) running Claude Agent SDK agents with typed tools over Supabase, AppFolio v0 (read), MS Graph, Zoom, Haven | Durable loops, inbound webhooks (Teams bot, SMS replies), retries, testable tool contracts, same TypeScript/Supabase stack, productizable | One new deploy target to operate | **Recommended core** |
| **C. OpenClaw / Hermes-style standalone** | Self-hosted autonomous personal-agent runtime | Fast to demo, fun | Single-operator design, weak audit/permissions story, security posture you'd have to own, doesn't multi-tenant, doesn't become a product | No for company infra; fine as Craig's personal sandbox |
| **D. Scheduled cloud agents (Claude Code routines)** | Cron-triggered cloud Claude sessions | Great for weekly analysis chores (e.g., re-running the backlog analysis) | Not a product substrate; no inbound events; per-run context cold-start | Use for ops/analysis only |

**Recommendation — hybrid, two tiers:**
1. **Deterministic tier (exists):** tripwires, sync, webhooks stay as Vercel crons. They are the sensors.
2. **Agent tier (new):** one **`agent-service`** process hosting the agent roster (Part 3). It wakes on: Supabase changes (new exceptions, webhook-driven WO events), schedules (morning briefs), and inbound channel events (Teams card actions, SMS replies). It is the only thing that talks to staff.

### Supabase as the spine (shared state)

- **`agent_proposal`** — generalize the shipped `ai_triage_proposal` pattern: `(id, org_id, agent, subject_type, subject_id, action_type, payload, rationale, status: proposed|approved|edited|rejected|expired|auto_applied, decided_by, decided_at, channel_message_id)`. Every agent output is a row here first. This is simultaneously the audit trail, the approval queue, and the *training data for autonomy promotion*.
- **`agent_outbox`** — every outbound message (Teams card, SMS, email draft) queued, delivered, and linked back to its proposal. The sender-agnostic `/api/inspections/notify` contract from 2026-07-09 is the pattern; extend it to a general channel adapter interface (`teams | sms | outlook_draft | in_app`). This is also the multi-tenant seam.
- **`agent_config`** — the autonomy matrix as data: `(agent, action_type, autonomy_level, max_per_day, quiet_hours, owner_role)`. Changing autonomy is a row update, not a deploy. Includes a global kill switch.
- **`wo_event`** — unchanged as the ground-truth audit log. Agent actions log as `actor: agent:<name>`; human approvals log as the human. **The Sep 4 write-API case is literally a query over this table.**
- **`metrics_snapshot`** — daily KPI capture (Part 5). Ship in Phase 0 so the baseline predates the agents.

### Guardrails (non-negotiable, encoded in the service)

- **Autonomy ladder per (agent, action_type):** L0 observe/report → L1 draft (human sends) → L2 act-on-tap (button in Teams/SMS) → L3 act-then-notify → L4 silent autonomous. Everything starts at L1 or L2. Promotion rule: ≥4 weeks at current level with <5% edit/reject rate and zero incidents → propose promotion *to Craig*, never self-promote.
- **Hard walls regardless of level:** AppFolio stays read-only until the Sep 4 purchase; no ledger writes ever; owners see one summary line per job; techs never see or set prices; tenant- and owner-facing sends always ≥1 human tap until Craig explicitly lowers it per-action-type; per-agent daily action caps and per-month token budget caps; every message carries a "why" line and a one-tap "stop these" control (adoption respects annoyance).

---

## Part 3 — Agent roster (mapped to people)

Format: **Trigger → Data → Autonomy start → Human-in-the-loop → Adoption hook.**

### Cheryl (coordinator) — the make-or-break user

**1. Morning Action Card ("Daily Seven")**
- Trigger: weekday 7:30am. Data: exceptions ranked by tripwire severity/age (the 89 past-due pool), triage proposals, today's routes.
- Autonomy: L2 — the card itself contains the actions: each row has **[Set date ▸ picker] [Reassign ▸] [Done] [Snooze 2d + reason]** buttons posting to existing APIs.
- HITL: she is the loop; the agent only ranks and packages.
- Adoption hook: **caps at 7 items.** Not 205 exceptions — seven. Finishing is achievable, and the card says "You cleared 7/7, backlog down 4% this week." Streaks beat dashboards. If untouched by 1pm, one (and only one) nudge.

**2. Intake Triage Agent** (upgrade of shipped batch triage)
- Trigger: AppFolio `work_orders` webhook (live) on new WO. Data: WO payload + unit/tenant history from the mirror + triage model.
- Autonomy: L2 — proposal posts to Teams as a card (priority, owner, next action, SLA date) with **[Apply] [Edit] [Skip]**; L3 target for clean-cut cases after promotion.
- HITL: Cheryl's tap; audited as her wo_event (pattern already shipped).
- Adoption hook: new WOs arrive *pre-thought-through* within minutes, in Teams, instead of as a queue she must go visit.

### Jen (estimates/approvals) — biggest stuck-money pool

**3. Estimate Chaser Agent**
- Trigger: TW11 pool (78 stuck, median >30d; status-age proxy per Session A — no dollar amounts available via API, so language never claims amounts).
- Data: WO mirror, vendor contacts, `appfolio_status` time-in-status clocks, chase history in `agent_outbox` (never double-chase inside 3 business days).
- Autonomy: **L1 — creates ready-to-send Outlook drafts in Jen's drafts folder via Graph** (vendor bid chases; owner approval requests). She reviews and hits send. Promotion path: L2 (send-on-tap from a Teams card) for vendor chases only; owner-facing stays L1/L2 forever per Q2 assumption.
- HITL: every send is hers. Escalation: anything chased 3× or aged >45d rolls up to Craig's brief automatically.
- Adoption hook: she opens Outlook (which she already does) and the tedious part of her job is *pre-done*. Zero new UI on day one. Weekly stat: "approval latency 34d → 29d since chasing started."

### Alberto & Brody (field techs)

**4. Route & Day-Close Agent**
- Trigger: day-route publish (shipped 2026-07-17) → 6:45am SMS: today's stops, gate codes, parts notes. 4:30pm SMS: "Reply per job: DONE / BLOCKED <why> / hours + materials."
- Data: routes, WO detail, prior time/materials patterns.
- Autonomy: L2 — structured replies parse into time/materials entries and status updates *as proposals Cheryl confirms* (L3 after promotion: apply directly, notify Cheryl of anomalies only).
- HITL: Cheryl reviews parsed entries initially; techs never see prices (existing rule).
- Adoption hook: techs do everything by text reply — no app, no login, ever. This also finally populates time/materials data, which feeds Penny's agent.

### Penny (billing)

**5. Invoice & Reconciliation Agent**
- Trigger: WO reaches completed/closeable with time+materials present; nightly bills sweep.
- Data: invoice generation + markup engine (shipped), `hdms_payments`, bills mirror. Constraint honored: **bills carry no WO link**, so the agent proposes vendor+amount+date-window matches with a confidence score — reconciliation is inherently propose-then-confirm.
- Autonomy: L1/L2 — drafts invoices and proposed matches; **[Confirm] [Not a match]** in the Reconcile tab or a Teams card. Match confirmations train the matcher.
- HITL: Penny confirms every match and every invoice initially.
- Adoption hook: her Reconcile tab goes from a search problem to a yes/no problem. Weekly stat: unbilled-completed-work dollars going to zero.

### Bryce (pending Q6) + inspections

**6. Inspections Cadence Agent**
- Trigger: move-in-anchored 6-month cadence engine + notice queue (both shipped; migration 20260709).
- Autonomy: L2 — proposes the month's inspection list + tenant notices; human tap dispatches via the existing manual Realm-X bridge (upgrades to the anticipated AppFolio MCP when real).
- Adoption hook: the monthly inspection scramble becomes a 10-minute review.

### Craig (owner)

**7. Ops Brief Agent**
- Trigger: daily 5pm (short) + Monday 8am (deep). Data: metrics_snapshot deltas, escalations from all agents, vendor scoreboard movement (Firkus watch), stuck-money totals, *agent performance itself* (proposals made / accepted / edited — you supervise the team through this).
- Autonomy: L0/L3 — it's reporting; sending itself is autonomous.
- Adoption hook: replaces the never-enabled digest with something that *ends in decisions*: each brief has at most 3 "needs Craig" items with buttons.

**8. Vendor Chaser Agent** (shared: Cheryl owns, Craig sees)
- Trigger: vendor scoreboard thresholds — accepted-but-unworked age (the Firkus pattern: accepts fast, sits on 46+ WOs), scheduled-date-passed (40 WOs).
- Autonomy: L1 email drafts now → L2 direct email → SMS only after 10DLC (resurrect the paused Twilio decision; Q1a).
- HITL: Cheryl approves tone/timing initially; monthly vendor report to Craig with "keep/pressure/replace" flags.
- Adoption hook: nobody at HDPM enjoys chasing Firkus; this is the chore everyone gladly delegates first.

**9. After-Hours Intake Agent** (gated on Q4/Haven)
- Trigger: Haven call events (API/webhook/email-parse — whatever exists). Data: call transcript/summary → structured WO proposal → feeds Agent #2; un-stubs tripwires #1 and #9.
- Autonomy: L2 — emergency-classified calls page Cheryl/on-call immediately (that alert path is L3 from day one; false-positive pages are cheaper than a missed flood).

Deferred to post-Sep 4 by the existing Wave 2 gate: dispatch queue, magic links, tenant notification automation, AppFolio write-backs.

---

## Part 4 — Phased rollout (trust sequencing)

**Phase 0 — "Ship what's built + baseline" (now → ~Aug 1).** No agents yet.
- Craig's own checklist: digest opt-ins + any pending migrations. *The prerequisite from 07-wave1-redirect still stands: nothing matters until Wave 1 is actually adopted.*
- Build: `metrics_snapshot` daily cron and freeze the baseline (205 exceptions; 89/78/37 split; approval latency ~30d median; ~0 staff actions/week). **The baseline must predate the agents or the case study is worthless.**
- Build: `agent_proposal` generalization, `agent_outbox` + channel adapter (Teams first), Teams app registration + bot, `agent-service` skeleton on Railway/Fly.
- Craig answers Part 1; a 30-minute team session where *the team picks* which agent goes first from the roster (people don't resist tools they chose).

**Phase 1 — Propose-then-apply (Aug, readable by ~Aug 25 for Sep 4).**
- Launch: Cheryl's Morning Action Card (#1), Jen's Estimate Chaser at L1 (#3), Craig's Ops Brief (#7). One agent per session-brief.
- **Success gate to enter Phase 2: ≥25 human actions/week flowing through cards/drafts for 2 consecutive weeks** (vs. ~0 baseline), and Cheryl/Jen each say "keep it" out loud. If the gate fails, stop and fix adoption — more capability is explicitly not the answer.

**Phase 2 — Act-on-tap + field channel (Sep–Oct).**
- Intake Triage on webhooks (#2), tech SMS day-close (#4), Penny's reconciliation proposals (#5), Vendor Chaser at L1→L2 (#8). Start 10DLC registration immediately (the long pole — weeks).
- **Sep 4 decision, armed with data:** wo_event counts of "approved in HDPM-OS but had to be re-typed into AppFolio." If ≥~40 touches/week, the $850/mo Write API pays for itself in retyping labor alone → buy. Phase 1 adoption numbers *are* the "build" case in build-vs-Jobber-vs-Realm-X.

**Phase 3 — Write-backs + gated features (Oct+, if Write API purchased).**
- Approved proposals write to AppFolio (status, assignment, notes) — approval taps now finish the job in the system of record. Wave 2 gate opens per the Sep 4 outcome: dispatch queue, magic links, tenant notifications, scope-change flow. Haven integration lands whenever Q4 resolves.

**Phase 4 — Earned autonomy (rolling).**
- Per-(agent, action_type) promotions by the <5% override rule, always proposed to Craig, never self-granted. End-state: internal nudges/date-setting L3–L4; vendor comms L2–L3; owner/tenant comms permanently ≥1 tap.

---

## Part 5 — Productization path

**Instrument from day 1 (all in `metrics_snapshot`):**

| KPI | Baseline (freeze in Phase 0) | Target after 90 agent-days |
|---|---|---|
| Open exceptions | 205 | < 60 |
| Staff actions/week (audit trail) | ~0–1 | > 50 |
| Estimate-approval latency (median) | >30 days | < 10 days |
| Median days-to-schedule (assign→scheduled) | from Session A clocks | < 5 days |
| Agent proposal acceptance rate | — | > 80% (with <5% edits at promoted levels) |
| Time-to-first-action on new WO | hours–days | < 30 min (webhook triage) |
| Hours saved/week (modeled: accepted proposals × task-minutes) | 0 | > 20 hrs/wk |
| Days-to-lease / turn time | capture now | improve post-Wave-2 |

The before/after on this table *is* the sales deck.

**Multi-tenant seams (do now, cheap):** `org_id` + Supabase RLS on all new tables; per-tenant AppFolio credentials in a vault (the client already parameterizes instance domains); channel adapters behind one interface (Teams for M365 shops, Slack adapter later, SMS universal — the channel question becomes tenant config, resolving the Slack debate permanently); autonomy matrix as tenant data; agent prompts/policies as versioned config, not hardcode. **Defer:** billing, self-serve onboarding, white-label, SOC2 — until a design partner exists.

**Pricing hypothesis (to validate, not assert):** per-door SaaS, three tiers — Watch (detection + briefs, ~$0.75/door/mo), Assist (propose-then-apply agent team, ~$1.50/door/mo), Autopilot (write-backs + earned autonomy, ~$2.50/door/mo + pass-through of AppFolio Write API). Anchors: AppFolio prices the write pipe at $1/unit/mo, so an agent layer that *uses* it credibly prices above it; at 460 doors, Assist ≈ $690/mo vs. >20 modeled hours/week saved (≈$2k+/mo at loaded coordinator cost) — a 3–4× value multiple. Competitive frame: Property Meld/Jobber-class tooling (workflow, no agency) vs. this (agency over the workflow).

**Go-to-market:** (1) HDPM case study with the KPI table — "460 doors, 7 staff, exceptions down X%, approval latency down Y days, zero new logins required"; (2) AppFolio ecosystem: Stack marketplace listing + being early on the anticipated official AppFolio MCP (when Realm-X/MCP is real, integration cost collapses — being first matters); (3) NARPM chapters and the 200–2,000-door independent PM segment (big enough to drown in coordination, too small for enterprise tooling); (4) design-partner motion: 2–3 friendly PMs Craig knows, free pilot for their data + logo. Named risk: AppFolio ships competing Realm-X agents — mitigation is the cross-system layer (Zoom, Haven, M365, techs-via-SMS) AppFolio won't build, plus multi-PMS ambition (Buildium/Rentvine adapters) as the long-run moat.

---

## Part 6 — How this executes back in the repo

This folder (`docs/agent-os/`) mirrors maintenance-os conventions: `00-README` (ground rules incl. the autonomy ladder + hard walls), `01-questions-and-answers` (Part 1, filled in by Craig), `02-architecture`, `03-agent-roster`, `04-rollout-waves`, `05-metrics-and-product`. Then one brief per Claude Code session, plan mode first, in order:

- **Brief A** — metrics_snapshot + baseline freeze *(safe to run now)*
- **Brief B** — agent_proposal / agent_outbox / agent_config migrations + channel adapter *(safe to run now)*
- **Brief C** — Teams bot + Morning Action Card *(blocked on Q1)*
- **Brief D** — Estimate Chaser (Graph drafts) *(blocked on Q2)*
- **Brief E** — Ops Brief agent
- Phase 2 briefs gated on the Phase 1 adoption gate and Sep 4.

**The one-sentence version:** ship the plumbing that already exists, freeze the baseline, put seven actionable items a day in front of Cheryl and pre-written drafts in front of Jen inside tools they already use, measure whether humans finally act, and let those numbers make the Sep 4 decision and write the sales deck.
