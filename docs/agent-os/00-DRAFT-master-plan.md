# HDPM-OS Agent Team — Master Plan (revised 2026-07-18)

> **Superseded rollout (2026-08-20):** the architecture, autonomy ladder, ceilings,
> roster, and Supabase spine below remain canonical and are inherited unchanged.
> The **rollout** (Parts 4 and 6) is replaced by `10-restart-2026-08-20.md`.
> This document is preserved in full as the reference architecture.


> Status: Part 1 answered by Craig 2026-07-18 — see `01-questions-and-answers.md`
> for the full answers, role corrections, and action items. This revision folds
> those answers in. Next step: split into the numbered docs + session briefs
> listed in Part 6 (maintenance-os conventions: one brief per session, plan
> mode first).

**Thesis:** HDPM-OS already *detects* everything (12 tripwires, 205 live exceptions, vendor scoreboard, digests). What it lacks is *motion*: since July 1 there is exactly one human action in the audit trail. The agent layer's job is not more detection — it is converting exceptions into staff actions **in the channels staff already live in**, then earning autonomy step by step. Every design choice below is subordinated to that.

---

## Part 1 — Decisions (was: clarifying questions)

Answered in full in `01-questions-and-answers.md`. The one-line versions:

| # | Decision |
|---|---|
| Q1 | **Slack** (already in daily use) for desk staff; **Zoom Phone SMS** for the field. No Teams, no Twilio/10DLC. Cheryl's card gets an email mirror in Phase 1. |
| Q2 | Ceilings: internal ops **L4**; vendor comms **L3**; owner/tenant-facing **L2 hard wall forever**; AppFolio writes **L2**; invoices **L1/L2**; ledger writes **never**. |
| Q3 | **Cheryl first, maintenance focus.** Estimates are Cheryl's (Brody assists), not Jen's. Jen's ~6-week leave doesn't touch Phase 1. PMs stay in compliance/move-in-out/sales. |
| Q4 | Haven **has an API/webhook**; Haven itself is replaceable → thin adapter behind a generic call-source interface. Ashley is the daytime human-in-the-loop. |
| Q5 | **No fixed budget ceiling** — spend follows demonstrated hours-saved, with per-agent caps as circuit breakers. Write API reframed as a **three-way write-path decision** (Write API / anticipated AppFolio MCP / keep retyping); the ≥40 touches/week metric gets measured regardless. |
| Q6 | **No agent for Bryce** (CCB license holder, oversight only). Inspections agent → **Brody**. Roster additions: Matt Free (oversight transitioning out through ~Dec 2026), Ashley, Bianca; Alberto is *Lead* Tech. |
| Q7 | Product option kept open cheaply (org_id/RLS/config-as-data now; billing/onboarding/white-label/SOC2 deferred to post-case-study ~Q1 2027). Shape: **agent team as an AppFolio add-on**. |
| Q8 | The agent plan is **one input among several** at Sep 4. Aug 25 is a target, not a hard gate; Phase 1 metrics are briefing inputs. |
| Addendum 07-18 | Alberto is field-outbound all day and works through the **AppFolio vendor app as HDMS** (an HDPM-owned vendor entity) + text — Agent #4 reads the vendor app and texts only the gaps; the Vendor Chaser special-cases HDMS. Ashley covers Haven + leasing queries + **`info@highdesertpm.com`**, the primary email contact. **Email triage is critical** (all PMs + Cheryl) → new Email Triage Agent (#10); SMS becomes a two-way texting tool. All iPhone holders carry Zoom/Slack/AppFolio (Slack push = field backup). |

---

## Part 2 — Architecture

### Runtime options compared

| Option | What it is | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. In-app crons (status quo)** | Vercel crons + Next.js API routes + batch AI calls | Exists, proven (triage, tripwires, syncs; digests built but never enabled), zero new infra | Short-lived invocations only; no conversational loop; no inbound channel listeners; Vercel timeouts fight agent loops | Keep — for deterministic detection and batch jobs |
| **B. Agent service (Claude Agent SDK worker)** | One small always-on Node service (Railway/Fly/ECS) running Claude Agent SDK agents with typed tools over Supabase, AppFolio v0 (read), MS Graph, Zoom, Haven | Durable loops, inbound webhooks (Slack events, SMS replies), retries, testable tool contracts, same TypeScript/Supabase stack, productizable | One new deploy target to operate | **Recommended core** |
| **C. OpenClaw / Hermes-style standalone** | Self-hosted autonomous personal-agent runtime | Fast to demo, fun | Single-operator design, weak audit/permissions story, security posture you'd have to own, doesn't multi-tenant, doesn't become a product | No for company infra; fine as Craig's personal sandbox |
| **D. Scheduled cloud agents (Claude Code routines)** | Cron-triggered cloud Claude sessions | Great for weekly analysis chores (e.g., re-running the backlog analysis) | Not a product substrate; no inbound events; per-run context cold-start | Use for ops/analysis only |

**Recommendation — hybrid, two tiers:**
1. **Deterministic tier (exists):** tripwires, sync, webhooks stay as Vercel crons. They are the sensors.
2. **Agent tier (new):** one **`agent-service`** process hosting the agent roster (Part 3). It wakes on: Supabase changes (new exceptions, webhook-driven WO events), schedules (morning briefs), and inbound channel events (Slack interactive actions, Zoom SMS replies). It is the only thing that talks to staff.

### Channels (per Q1)

- **Slack** (Block Kit interactive messages) — the desk surface: Cheryl, Brody, Penny, Craig, Matt; PMs later. Already in daily use, so no new-tool adoption tax.
- **Zoom Phone SMS** — the field surface: Alberto (outbound on maintenance essentially all day). *Pending verification: inbound webhook support for structured replies.* Per the 07-18 addendum, the SMS adapter is also a **two-way texting tool**: send-on-tap tenant/vendor texts from Cheryl's cards, under the Q2 ceilings (vendor L3 max, tenant L2 wall).
- **AppFolio vendor app** — Alberto's primary work surface: he operates as **High Desert Maintenance Services (HDMS)**, an HDPM-owned vendor entity, and logs WO activity there (this is the `hdms_payments` connection). The agent layer treats the vendor app as a **read channel** (via the WO webhook/mirror), never a surface it posts to — SMS handles the outbound half of Alberto's loop. All iPhone holders also carry Zoom, Slack, and AppFolio, so Slack push is a viable backup for field staff, but Alberto's day runs on vendor app + text.
- **Email / Outlook via Graph** — three roles: (a) Cheryl lives in AppFolio + email today, so her morning card mirrors to email during Phase 1; (b) the Estimate Chaser writes ready-to-send drafts into her Outlook drafts folder; (c) **inbound email is a channel, not just an outbox** — `info@highdesertpm.com` is the company's primary email contact (Ashley monitors it) and feeds the Email Triage Agent (#10). The Teams→Slack switch doesn't touch Graph, **but (stress-test finding) the repo's only Graph integration today is delegated + interactive** — the NextAuth Azure AD sign-in requests calendar scope only (`lib/auth.ts`), no Mail scopes, no offline access, no app-only client. Headless mailbox access (drafts into Cheryl's folder, `info@` webhooks, any L3 send) requires **new Azure app registration work: application `Mail.ReadWrite` with admin consent, scoped via ApplicationAccessPolicy** (or a stored delegated refresh-token flow). This is a Phase 0 build item and a hard blocker for Brief D and Agent #10.
- **In-app** stays the deep-work surface, not the notification surface.

### Supabase as the spine (shared state)

- **`agent_proposal`** — generalize the shipped `ai_triage_proposal` pattern: `(id, org_id, agent, subject_type, subject_id, action_type, payload, rationale, status: proposed|approved|edited|rejected|expired|auto_applied, decided_by, decided_at, channel_message_id)`. Every agent output is a row here first. This is simultaneously the audit trail, the approval queue, and the *training data for autonomy promotion*.
- **`agent_outbox`** — every outbound message (Slack card, SMS, email, Outlook draft) queued, delivered, and linked back to its proposal. The sender-agnostic `/api/inspections/notify` contract from 2026-07-09 is the pattern; extend it to a general channel adapter interface (`slack | sms_zoom | outlook_draft | email | in_app`). This is also the multi-tenant seam.
- **Inbound action path (stress-test finding — Brief B/C scope):** card buttons cannot literally "post to existing APIs" — every `/api/maintenance` route requires an interactive NextAuth staff session, which Slack's servers don't have. Brief B adds: a **service-credential auth path** (or an agent-service-internal apply path) for approved actions, **Slack signing-secret verification** and Zoom webhook verification on inbound events, and an **identity map** (`slack_user_id` / phone → staff actor) so every tap is audited in `wo_event` as the human who tapped, preserving the "human approvals log as the human" guarantee.
- **`agent_config`** — the autonomy matrix as data: `(agent, action_type, autonomy_level, ceiling_level, max_per_day, quiet_hours, owner_role)`. Ceilings from Q2 are stored per action type, so promotion logic can never propose past them. Changing autonomy is a row update, not a deploy. Includes a global kill switch.
- **`wo_event`** — unchanged as the ground-truth audit log. Agent actions log as `actor: agent:<name>`; human approvals log as the human. **The Sep 4 write-path case is literally a query over this table.**
- **`metrics_snapshot`** — daily KPI capture (Part 5). Ship in Phase 0 so the baseline predates the agents. **Not net-new infrastructure (stress-test finding):** the repo already snapshots ~20 leasing/finance KPIs daily (`kpi_snapshots` table + `/api/kpi/cron`, running since April). Brief A **copies that proven pattern into a separate `metrics_snapshot` table** (same jsonb shape; separate because it's an agent-layer spine table that later holds agent-performance metrics and carries RLS per current migration convention), and **sources the days-to-lease baseline from the existing April-onward `kpi_snapshots` history** rather than starting capture fresh.

### Guardrails (non-negotiable, encoded in the service)

- **Autonomy ladder per (agent, action_type):** L0 observe/report → L1 draft (human sends) → L2 act-on-tap (button in Slack/SMS) → L3 act-then-notify → L4 silent autonomous. Everything starts at L1 or L2, **with exactly two sanctioned exceptions**: (a) self-addressed reporting to Craig/Matt (Ops Brief #7 sends itself, L3) and (b) emergency paging (#9's alert path, L3 from day one — a false page is cheaper than a missed flood). These two are seeded as such in `agent_config`; everything else starts L1/L2, no other exceptions. Promotion rule: ≥4 weeks at current level with <5% edit/reject rate and zero incidents → propose promotion *to Craig*, never self-promote — and never past the Q2 ceiling for that action type.
- **Ceilings (decided, Q2):** internal ops (dates, assignments) may reach L4; vendor comms may reach L3; owner- and tenant-facing sends are hard-walled at L2 permanently; AppFolio writes cap at L2 (a write only ever completes an approved tap); invoices cap at L1/L2 with Penny confirming.
- **Hard walls regardless of level:** AppFolio stays read-only until a write path is purchased/available (Sep 4); no ledger writes ever; owners see one summary line per job; techs never see or set prices; per-agent daily action caps and per-month token budget caps (the circuit breakers behind Q5's uncapped-but-value-gated budget); every message carries a "why" line and a one-tap "stop these" control (adoption respects annoyance).

---

## Part 3 — Agent roster (mapped to people)

Format: **Trigger → Data → Autonomy start → Human-in-the-loop → Adoption hook.**

Team facts per the Notion roles doc + Craig's corrections (see `01`): Cheryl owns all vendor work; Brody (Property Inspector) assists on vendor follow-up and co-manages unit turns with Cheryl and Alberto; Alberto is Maintenance Lead Tech; PMs (Jen, Bianca, Kennedy) handle compliance/move-in-out/sales only; Ashley fronts phones and monitors Haven; Matt Free holds (and is handing off) maintenance oversight; Bryce holds the CCB license, no operational workflows.

### Cheryl (Ops & Maintenance Coordinator) — the make-or-break user

**1. Morning Action Card ("Daily Seven")**
- Trigger: weekday 7:30am. Data: exceptions ranked by tripwire severity/age (the 89 past-due pool), triage proposals, today's routes.
- Channel: Slack Block Kit card **+ email mirror during Phase 1** (Cheryl lives in AppFolio + email today; measure which surface she acts from and drop the mirror when Slack wins).
- Autonomy: L2 — the card itself contains the actions: each row has **[Set date ▸ picker] [Reassign ▸] [Done] [Snooze 2d + reason]** buttons posting to existing APIs.
- HITL: she is the loop; the agent only ranks and packages.
- Adoption hook: **caps at 7 items.** Not 205 exceptions — seven. Finishing is achievable, and the card says "You cleared 7/7, backlog down 4% this week." Streaks beat dashboards. If untouched by 1pm, one (and only one) nudge.

**2. Intake Triage Agent** (upgrade of shipped batch triage)
- Trigger: AppFolio `work_orders` webhook (live) on new WO. Data: WO payload + unit/tenant history from the mirror + triage model.
- Autonomy: L2 — proposal posts to Slack as a card (priority, owner, next action, SLA date) with **[Apply] [Edit] [Skip]**; L3 target for clean-cut cases after promotion.
- HITL: Cheryl's tap; audited as her wo_event (pattern already shipped).
- Adoption hook: new WOs arrive *pre-thought-through* within minutes, in Slack, instead of as a queue she must go visit.

**3. Estimate Chaser Agent** (retargeted per Q3 — Cheryl owns, Brody assists; was misassigned to Jen in the draft)
- Trigger: TW11 pool (78 stuck, median >30d; status-age proxy per Session A — no dollar amounts available via API, so language never claims amounts).
- Data: WO mirror, vendor contacts, `appfolio_status` time-in-status clocks, chase history in `agent_outbox` (never double-chase inside 3 business days).
- Autonomy: **L1 — creates ready-to-send Outlook drafts in Cheryl's drafts folder via Graph** (vendor bid chases; owner approval requests). She reviews and hits send — in the email client she already lives in. Promotion path: L2 (send-on-tap from a Slack card) then L3 for **vendor** chases per the Q2 ceiling; owner-facing stays hard-walled at L2.
- HITL: every send is Cheryl's. Brody sees the chase queue for follow-up context on turns. Escalation: anything chased 3× or aged >45d rolls up to Craig's brief automatically.
- **Code prerequisite (stress-test finding):** the Q3 retarget exists only in this doc — shipped code still hardcodes the estimate pool to Jen: both TW11 sources set `owner: 'Jen'` (`lib/maintenance/tripwires.ts`), the digest cron routes by that owner, and the triage batch routes estimate statuses to Jen. **Reassign TW11 ownership (and audit the other hardcoded owners against the corrected roster) before digest opt-ins are enabled** — scoped into Brief A as a small chore, else Phase 0 emails the 78-WO pool to the person on leave.
- Adoption hook: the tedious part of the stuck-estimates problem is *pre-done* in her drafts folder. Zero new UI on day one. Weekly stat: "approval latency 34d → 29d since chasing started."

### Alberto (Maintenance Lead Tech) — field channel

**4. Route & Day-Close Agent** (revised 07-18: read the vendor app, don't duplicate it)
- Alberto works through the **AppFolio vendor app as HDMS** all day — so the agent's first job is to *read* what he already logs (via the WO webhook/mirror) rather than ask him to re-report it by text. SMS covers the outbound half and the gaps.
- Trigger: day-route publish (shipped 2026-07-17) → 6:45am **Zoom Phone SMS**: today's stops, gate codes, parts notes. 4:30pm: a **gap-fill day-close**, not a full re-report — the agent diffs the day's route against HDMS activity in the mirror and texts only what's missing: "WO #412 shows no hours — reply hours + materials. WO #418 still open — DONE or BLOCKED <why>?"
- Data: routes, WO detail, HDMS vendor-app activity from the mirror, prior time/materials patterns. *Pending verification (Phase 0): exactly what the vendor app captures — status, hours, materials, photos — and whether it all reaches the webhook/mirror; the less it captures, the more the SMS day-close carries.*
- Autonomy: L2 — SMS replies parse into time/materials entries and status updates *as proposals Cheryl confirms* (L3 after promotion: apply directly, notify Cheryl of anomalies only).
- HITL: Cheryl reviews parsed entries initially; techs never see prices (existing rule). Alberto is the *lead* tech overseeing vendor quality on turns, so the day-close also accepts turn-status notes.
- Adoption hook: nothing new to learn — he keeps working the vendor app he already uses, and the only texts he gets are short and specific. Time/materials data finally gets complete, which feeds Penny's agent.
- *(Brody is not on this SMS flow — he's in AppFolio + Slack and his agent surface is #6 and the shared vendor/turn views.)*

### Penny (Sr Finance)

**5. Invoice & Reconciliation Agent**
- Trigger: WO reaches completed/closeable with time+materials present; nightly bills sweep *(the sweep and its data store are prerequisites — see below)*.
- Data: invoice generation + markup engine (shipped), `hdms_payments` (shipped), and a **bills mirror that does not exist yet** (stress-test finding: no bills table, no bills sync cron — the closest artifact is the webhook inspection log, explicitly a staging table). The v0 `/bills` read path is proven elsewhere in the codebase, so it's buildable, but **a "bills mirror + nightly sync" brief is a named prerequisite for this agent**, not existing data. Constraint honored: **bills carry no WO link**, so the agent proposes vendor+amount+date-window matches with a confidence score — reconciliation is inherently propose-then-confirm.
- Autonomy: L1/L2 — drafts invoices and proposed matches; **[Confirm] [Not a match]** in the Reconcile tab or a Slack card. Match confirmations train the matcher.
- HITL: Penny confirms every match and every invoice initially (and permanently per the Q2 ceiling).
- Adoption hook: her Reconcile tab goes from a search problem to a yes/no problem. Weekly stat: unbilled-completed-work dollars going to zero.

### Brody (Property Inspector)

**6. Inspections Cadence Agent** (owner resolved by Q6 — Brody's, not Bryce's)
- Trigger: move-in-anchored 6-month cadence engine + notice queue (both shipped; migration 20260709).
- Autonomy: L2 — proposes the month's inspection list + tenant notices to Brody in Slack; tenant notices keep the Q2 hard wall (human tap dispatches via the existing manual bridge; upgrades to the anticipated AppFolio MCP when real).
- HITL: Brody taps to dispatch; inspection non-compliance notices flow onward to the PM lane (Kennedy prepares them today).
- Adoption hook: the monthly inspection scramble becomes a 10-minute review.

### Craig (owner) + Matt (Executive PM, oversight in handoff)

**7. Ops Brief Agent**
- Trigger: daily 5pm (short) + Monday 8am (deep). Data: metrics_snapshot deltas, escalations from all agents, vendor scoreboard movement (Firkus watch), **stuck-estimate counts and ages plus unbilled-completed-work dollars** (stress-test correction: estimate *dollar* totals are not queryable — Session A established no estimate amounts exist in any reachable API, the same constraint Agent #3 honors; dollar figures appear only if the manual web report is exported), *agent performance itself* (proposals made / accepted / edited — you supervise the team through this).
- Recipients: Craig; **offer it to Matt Free** — he holds high-level maintenance oversight and is transitioning out through ~Dec 2026, and this brief is part of what absorbs that handoff.
- Autonomy: L0/L3 — it's reporting; sending itself is autonomous.
- Adoption hook: replaces the never-enabled digest with something that *ends in decisions*: each brief has at most 3 "needs Craig" items with buttons.

**8. Vendor Chaser Agent** (Cheryl owns, Craig sees)
- Trigger: vendor scoreboard thresholds — accepted-but-unworked age (the Firkus pattern: accepts fast, sits on 46+ WOs), scheduled-date-passed (40 WOs).
- Autonomy: L1 email drafts now → L2 send-on-tap → L3 send-then-notify (the Q2 ceiling for vendor comms). SMS chasing via Zoom Phone if a vendor is text-first — no 10DLC dependency.
- **HDMS special case:** High Desert Maintenance Services appears in the vendor data but is HDPM-owned (it's Alberto). It is excluded from external chase templates — an "HDMS chase" is an SMS nudge to Alberto or an escalation line in Cheryl's card, never a vendor-relations email, and HDMS is scored separately on the vendor scoreboard.
- HITL: Cheryl approves tone/timing initially; monthly vendor report to Craig with "keep/pressure/replace" flags.
- Adoption hook: nobody at HDPM enjoys chasing Firkus; this is the chore everyone gladly delegates first.

### Ashley (Front Desk — phones, Haven, leasing queries, and the `info@` inbox)

**9. Intake Agent (Haven)** (unblocked by Q4 — API/webhook exists)
- Trigger: Haven call events via API/webhook, behind a **generic "after-hours call source" adapter** — Haven is on the table for replacement, so it's the first implementation, not the foundation. Data: call transcript/summary → structured WO proposal → feeds Agent #2; un-stubs tripwires #1 and #9.
- HITL: **Ashley** — she already continuously monitors Haven's dashboards; daytime call-derived proposals route to her for confirmation, reducing the watch-the-dashboard burden rather than routing around her.
- Autonomy: L2 — emergency-classified calls page Cheryl/on-call immediately (that alert path is L3 from day one; false-positive pages are cheaper than a missed flood).

**10. Email Triage Agent** (added per the 07-18 addendum — "email triage is critical for all PMs and Cheryl")
- Trigger: Graph webhooks on **`info@highdesertpm.com`** (the primary company email contact, monitored by Ashley) and on Cheryl's maintenance lane first; PM inboxes (Jen, Bianca, Kennedy) as the fast-follow.
- Data: sender matched against the tenant/owner/vendor mirror, thread history, WO mirror, vacancy/listing data for leasing queries.
- Action: classify (maintenance request / leasing query / owner / vendor / payment / junk) → route to the right person's Slack card with a **drafted reply attached** → maintenance-request emails become structured WO proposals feeding Agent #2.
- Autonomy: L1/L2 — routing proposals and reply drafts only; tenant/owner-facing replies inherit the Q2 hard wall (a human always taps send). Junk-filing can earn L3/L4.
- HITL: Ashley for `info@`, Cheryl for the maintenance lane, each PM for their own inbox.
- Adoption hook: the `info@` front door stops depending on one person's attention; every email arrives pre-classified with a reply already written. Weekly stat: median time-to-first-response on `info@`.

### PM lane (Jen, Bianca, Kennedy) — future

No *dedicated* agent in Phases 1–2 (per Q3: PMs do compliance, move-in/move-out, sales only — none of the maintenance pools), but the PMs are early beneficiaries of the Email Triage Agent (#10) on their own inboxes. The natural post-Phase-2 candidate is a **Compliance & Move-Cycle Agent** (notice prep, renewals, insurance-compliance chasing, move-in/move-out checklists), scoped with Jen after her return from leave. Kennedy is the tech-savvy early adopter to pilot it.

Deferred to post-Sep 4 by the existing Wave 2 gate: dispatch queue, magic links, tenant notification automation, AppFolio write-backs.

---

## Part 4 — Phased rollout (trust sequencing)

**Phase 0 — "Ship what's built + baseline" (now → ~Aug 1).** No agents yet.
- Craig's own checklist: digest opt-ins + any pending migrations. *The prerequisite from 07-wave1-redirect still stands: nothing matters until Wave 1 is actually adopted.* **Digest carve-out (stress-test finding):** don't enable the email digest for anyone slated to get a Phase 1 agent surface (Cheryl, Craig) — their agents replace it; enabling both double-messages them. And do not enable Jen's digest until the TW11 ownership fix lands (Brief A), or the stuck-estimate pool mails to someone on leave.
- Build: `metrics_snapshot` daily cron and freeze the baseline (205 exceptions; 89/78/37 split; approval latency ~30d median; ~0 staff actions/week). **The baseline must predate the agents or the case study is worthless.**
- Build: `agent_proposal` generalization, `agent_outbox` + channel adapter (**Slack first**, email second), Slack app + bot registration, `agent-service` skeleton on Railway/Fly.
- Verify: Zoom Phone SMS inbound webhooks (blocks #4); what the AppFolio vendor app captures for HDMS and whether it reaches the webhook/mirror (shapes #4's read-vs-ask split); Haven API docs/credentials (blocks #9); Graph webhook access to the `info@` shared mailbox (blocks #10); AppFolio MCP specs/pricing/timeline + Realm-X native-automation inventory (feeds Sep 4).
- Build (Azure): **app-only Graph mail access** — application `Mail.ReadWrite` with admin consent, ApplicationAccessPolicy-scoped to Cheryl's mailbox + `info@` (the repo's current Graph auth is delegated calendar-only and cannot serve a headless agent). **Hard blocker for Brief D and #10.**
- Code chore (in Brief A): reassign TW11 exception ownership Jen → Cheryl in `lib/maintenance/tripwires.ts` + audit other hardcoded owners against the corrected roster.
- A 30-minute team session where *the team picks* which agent goes first from the roster (people don't resist tools they chose).

**Phase 1 — Propose-then-apply (Aug; Aug 25 readability is a target, not a gate — Q8).**
- Launch (all centered on Cheryl per Q3): Morning Action Card (#1), Estimate Chaser at L1 into Cheryl's drafts (#3), Craig's Ops Brief (#7, offered to Matt). One agent per session-brief. Jen's leave does not affect this phase.
- **Success gate to enter Phase 2: ≥25 human actions/week flowing through cards/drafts for 2 consecutive weeks** (vs. ~0 baseline), and Cheryl says "keep it" out loud. If the gate fails, stop and fix adoption — more capability is explicitly not the answer.

**Phase 2 — Act-on-tap + field channel (Sep–Oct).**
- **First item: Email Triage (#10) on `info@` + Cheryl's maintenance lane** — flagged critical in the 07-18 addendum; it is the named candidate to pull *into* Phase 1 if the team picks it at the Phase 0 session or Phase 1 lands early. PM inboxes follow once the classify/route loop proves out.
- Then: Intake Triage on webhooks (#2), Alberto's SMS day-close via Zoom Phone (#4 — no 10DLC long-pole), two-way SMS from Cheryl's cards, Penny's reconciliation proposals (#5), Vendor Chaser at L1→L2 (#8), Brody's inspections cadence (#6).
- **Sep 4 decision, with the agent data as one input among several (Q8):** wo_event counts of "approved in HDPM-OS but had to be re-typed into AppFolio" quantify the retyping pain. The write-path question is now three-way (Q5): **Write API ($850/mo) vs. the anticipated AppFolio MCP vs. keep retyping** — decided on MCP specs/timeline gathered in Phase 0. If retyped touches ≥~40/week and the MCP isn't imminent/suitable for unattended service use, the Write API pays for itself in retyping labor alone.

**Phase 3 — Write-backs + gated features (Oct+, if any write path lands).**
- Approved proposals write to AppFolio (status, assignment, notes) via whichever path won — approval taps now finish the job in the system of record. Wave 2 gate opens per the Sep 4 outcome: dispatch queue, magic links, tenant notifications, scope-change flow. Haven/intake integration lands once API credentials are in hand (Q4).

**Phase 4 — Earned autonomy (rolling).**
- Per-(agent, action_type) promotions by the <5% override rule, always proposed to Craig, never self-granted, never past the Q2 ceilings. End-state: internal nudges/date-setting L3–L4; vendor comms L2–L3; owner/tenant comms permanently ≥1 tap.
- PM-lane agent scoped with Jen post-leave; piloted with Kennedy.

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
| Days-to-lease / turn time | days-to-lease: already captured since April (`kpi_snapshots`) — freeze from history; turn time: capture now | improve post-Wave-2 |

The before/after on this table *is* the sales deck. It also governs spend: per Q5 the budget is value-gated, so this table is what "worth it" means at the monthly review.

**Multi-tenant seams (do now, cheap — confirmed by Q7):** `org_id` + Supabase RLS on all new tables; per-tenant AppFolio credentials in a vault (the client already parameterizes instance domains); channel adapters behind one interface (**Slack shipped first for HDPM; Teams adapter later for M365 shops; SMS universal** — the channel question is tenant config, and HDPM's own Slack-not-Teams answer proves the seam works); autonomy matrix as tenant data; agent prompts/policies as versioned config, not hardcode. **Defer:** billing, self-serve onboarding, white-label, SOC2 — until a design partner exists.

**Pricing hypothesis (to validate, not assert):** per-door SaaS, three tiers — Watch (detection + briefs, ~$0.75/door/mo), Assist (propose-then-apply agent team, ~$1.50/door/mo), Autopilot (write-backs + earned autonomy, ~$2.50/door/mo + pass-through of the AppFolio write path). Door-count note (corrected 07-18): HDPM is **460 buildings / ~850 units (doors)** — per-door math uses 850, which is also why the Write API is $850/mo at AppFolio's $1/unit/mo. Anchors: an agent layer that *uses* the write pipe credibly prices above it; at 850 doors, Assist ≈ $1,275/mo vs. >20 modeled hours/week saved (≈$2k+/mo at loaded coordinator cost) — a ~1.6–2× value multiple at HDPM's own scale (stronger for labor-tighter shops; validate with design partners). Competitive frame: Property Meld/Jobber-class tooling (workflow, no agency) vs. this (agency over the workflow).

**Go-to-market (shape confirmed by Q7 — the agent team as an AppFolio add-on, not the whole OS):** (1) HDPM case study with the KPI table — "460 buildings / 850 doors, ~10 staff, exceptions down X%, approval latency down Y days, zero new logins required"; (2) AppFolio ecosystem: Stack marketplace listing + being early on the anticipated official AppFolio MCP (Craig reports it's releasing soon — when it's real, integration cost collapses and being first matters; get specs before Sep 4); (3) NARPM chapters and the 200–2,000-door independent PM segment (big enough to drown in coordination, too small for enterprise tooling); (4) design-partner motion: 2–3 friendly PMs Craig knows, free pilot for their data + logo. Named risk: AppFolio ships competing Realm-X agents — mitigation is the cross-system layer (Zoom, Haven-or-successor, M365, techs-via-SMS) AppFolio won't build, plus multi-PMS ambition (Buildium/Rentvine adapters) as the long-run moat. Corollary (Q5 action item): inventory what Realm-X automates natively and subtract it from our agent scope.

---

## Part 6 — How this executes back in the repo

This folder (`docs/agent-os/`) mirrors maintenance-os conventions: `00` this plan, `01-questions-and-answers` (done), then `02-architecture`, `03-agent-roster`, `04-rollout-waves`, `05-metrics-and-product` as the build docs. Then one brief per Claude Code session, plan mode first, in order:

- **Brief A** — metrics_snapshot + baseline freeze + TW11 owner fix *(SHIPPED 2026-07-18/19; migration `20260718_metrics_snapshot.sql` pending Craig's SQL-editor run → done; baseline freeze via `?freezeBaseline=1` after deploy)*
- **Brief B** — agent_proposal / agent_outbox / agent_config / staff migrations + channel adapters + service-auth + webhook signature verification *(SHIPPED 2026-07-19; migrations `20260719_*.sql` to run in SQL editor; conventions in `02-brief-b-conventions.md`; Craig fills staff contact fields + sets `HDPM_SERVICE_TOKEN` if unset)*
- **Brief C** — Slack app + bot + Morning Action Card (with email mirror) *(unblocked by Q1; consumes Brief B's auth path)*
- **Brief D** — Estimate Chaser (Graph drafts into Cheryl's folder) *(SHIPPED 2026-07-19; Azure app-only Mail.ReadWrite registration done — "HDPM-OS Agent Mail", ApplicationAccessPolicy-scoped to cheryl@ + info@; migration `20260721_estimate_chaser_escalate.sql` to run in SQL editor; `AGENT_GRAPH_DRYRUN=1` available for a staged first run; interim 3×/45d escalation = Slack DM to Craig until Brief E absorbs it)*
- **Brief D.5** — Vendor chase by text *(SHIPPED 2026-07-20: SMS-first vendor chases via Zoom Phone — L2 send-on-tap from Cheryl's Slack "Text chase queue" card, sent from her Zoom line; `sms_zoom` adapter live; migration `20260722_vendor_chase_sms.sql`; env `ZOOM_SMS_SENDER_USER_ID`/`ZOOM_SMS_SENDER_NUMBER` + SMS write scope on the existing S2S Zoom app; `/api/agents/sms-test` probe settles the tenant's S2S-send support before enabling. **Probe verdict 2026-07-20: S2S cannot send SMS** (Zoom 7639 — user endpoint needs a sender-owned token; account-level variant is ISV-only) → **D.5b**: per-user OAuth via user-managed app "HDPM-OS SMS Sender" (`ZOOM_USER_CLIENT_ID/SECRET`), Cheryl authorizes once at `/api/agents/zoom-oauth/start`, tokens in `zoom_user_token` (migration `20260723`), sendSms prefers her token. Also: `/api/agents/vendor-contact-audit` diagnostic for the vendor-email extraction gap — Craig confirms ~99% of vendors have emails in AppFolio, but `extractEmail()` misses them; fix lands once the audit names the real field)*
- **Brief E** — Ops Brief agent (Craig + Matt) *(SHIPPED 2026-07-20: weekday 5 PM PT short brief + Monday 8 AM PT deep brief, Slack DM to Craig (interactive) + Matt (read-only); absorbs estimate_chaser escalations as ≤3 "needs Craig" items with [Acknowledge] buttons; metrics deltas vs yesterday/last week/baseline via the new metrics_snapshot history reader; counts/ages only, never dollars; no migration — ops_brief/send_brief row was seeded in Brief B)*
- **Brief D.6** — Delegation as data *(QUEUED — design sketched 2026-07-20: `staff.out_until` + `staff.delegate_person` columns, one resolver used wherever agent surfaces route to a person; Slack cards portable trivially, Outlook drafts need the delegate's mailbox added to the Graph ApplicationAccessPolicy group, SMS falls back to email drafts unless the delegate has done their own one-time Zoom authorize; small /agents toggle. Build before the first real vacation; also covers the Craig→Matt brief handoff.)*
- **Brief F** — Email Triage agent: `info@` + Cheryl's maintenance lane *(first Phase 2 brief; pull-forward candidate)*
- Remaining Phase 2 briefs (Intake Triage, Zoom SMS day-close + two-way texting, reconciliation, vendor chaser, inspections) gated on the Phase 1 adoption gate and the Sep 4 write-path outcome.

**The one-sentence version:** ship the plumbing that already exists, freeze the baseline, put seven actionable items a day in front of Cheryl in Slack (mirrored to the email she already lives in) and pre-written chase drafts in her Outlook folder, measure whether humans finally act, and bring those numbers — plus the AppFolio MCP's real specs — to Sep 4 as one strong input among several.
