# DEZ — Build Specification v0.3

**What:** HDPM's employee-facing agent. One Slack identity between the team, AppFolio, and HDPM's documented procedures.
**Not:** tenant-facing (that's Haven), owner-facing (that's the owner report), or autonomous (every write is human-triggered).
**Status:** spec. Dez **runs natively inside HDPM-OS** (this repo, `feature/dez`). Most of the plumbing already exists — this is a **consolidation of built-but-scattered agent surface behind one legible conversational face**, plus a small amount of net-new Slack plumbing. It is not a greenfield build.
**Date:** August 30, 2026

> **What changed from v0.2 (Aug 29).** v0.2 was drafted *outside* the codebase and made two assumptions that turned out wrong once we mapped HDPM-OS:
> 1. **Runtime.** v0.2 = Claude Tag in a separate `hdpm-crew` repo. v0.3 = **native in HDPM-OS**: a new Slack Events endpoint fuses the RAG chat engine and the agent spine that already exist here into one Slack-native colleague. (Runtime decision locked by Craig, 2026-08-30.)
> 2. **Greenfield vs. consolidation.** v0.2 treated the tool/data layer as to-be-built. In fact the autonomy spine, a *bidirectional* Slack app, the RAG/Knowledge-Chat engine, the KPI layer, Cracks Radar, and the plain-language 3-tier autonomy UI **already exist and are live or built**. §4 (Consolidation map) is new and is the heart of this rev.
> Also new in v0.3: §5 Slack topology, §6 Subagent visibility, a **full-colleague** identity with `dez@highdesertpm.com` + an AppFolio seat (§7), a four-option write-path table (§8), and the Alven experience scorecard (Appendix A). v0.2 §7 (Review engine) is carried forward intact as §11.

---

## 1. Principles (settled — do not re-litigate)

1. **One Slack identity.** Employees never pick an agent; channels (and DM intent) do the routing. The multi-agent structure is real but lives in the backend — staff see one `@Dez`.
2. **Dez talks to employees only.** He never messages a tenant, owner, or vendor. Dez is **Alven's interaction design pointed inward** — we adopt the legibility, the identity, the one-thread-per-topic, the approve-the-plan; the recipient is always an HDPM employee.
3. **Reads are free, writes are verbs.** Dez can read anything he's scoped to. He can write only through a named, logged, human-triggered verb. There is no "Dez has the API."
4. **Cards end in a link (v0) or a button (v1). Never in "go figure it out."**
5. **Every correction becomes skill-file text.** If someone fixes Dez twice for the same thing, the fix wasn't captured. (This is the "learns" behavior, made tangible — see §7 View memory.)
6. **Proactive = Routines.** Scheduled jobs that read AppFolio and post cards. Dez-in-channel is reactive; the Routine layer is where proactivity lives.
7. **Reuse the HDPM-OS spine.** Dez does not re-derive autonomy, proposals, outbox, Slack transport, RAG, or KPI. It *calls into* what exists. New code is limited to the conversational front, the router, the visibility surfaces, and (later) verbs.

## 2. Architecture (native in HDPM-OS)

```
   SLACK (one identity: Dez)                         ┌─────────────────────────────┐
   DMs (1:1, all 9 staff)  ── free text ───────────► │  Slack Events API endpoint  │  ← NET-NEW
   #maintenance #all-hdpm  ── @Dez mention ────────► │  (message.im, app_mention)  │
   #dez-wishlist            (intake)                 │  verifySlackSignature +     │
        ▲                                            │  resolveStaffBySlackId      │
        │ answers · cards · breadcrumbs              └──────────────┬──────────────┘
        │                                                          ▼
   ┌────┴───────────────────────────┐            ┌────────────────────────────────┐
   │  Slack interactivity receiver  │◄── taps ───│  DEZ ROUTER  (channel→subagent) │  ← NET-NEW (thin)
   │  /api/agents/slack/interact    │            │  maintenance · leasing · acct   │
   │  (EXISTS: ec/ob/mc/rock verbs) │            └───────┬────────────┬───────────┘
   └────────────────────────────────┘                    │            │
                                                          ▼            ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  TOOL / DATA LAYER (EXISTS)                                                     │
   │  RAG / Knowledge Chat  → lib/rag.ts, knowledge_chunks (ors_90/notion_sop/       │
   │                          onedrive_doc) + brain           [= sop-answers skill]  │
   │  KPI layer             → kpi_snapshots (18 KPIs), /api/kpi/*   [= kpi-brief]    │
   │  Cracks Radar          → lib/cracks.ts                                          │
   │  AppFolio read (Plus)  → lib/appfolio.ts (GET-only today)                       │
   │  AppFolio WRITE        → swappable verb layer, Sep-4 decision (§8)              │
   └──────────────────────────────────────────────────────────────────────────────┘
                                     │
   ┌─────────────────────────────────▼──────────────────────────────────────────────┐
   │  AUTONOMY SPINE (EXISTS)                                                          │
   │  agent_config (matrix + ('*','*') kill switch) · agent_proposal · agent_outbox   │
   │  · staff · wo_event · tiers.ts (Supervised/Assisted/Autonomous) · channel seam   │
   └──────────────────────────────────────────────────────────────────────────────┘

   SCHEDULED LAYER (Routines — the existing cron layer, re-homed under Dez):
   · Daily stale-WO hygiene card → #maintenance      (subsumes the disabled Morning Card)
   · Ops brief / KPI card → per channel               (ops-brief-run.ts, live)
   · Cracks Radar Monday packet                        (lib/cracks.ts, live)
   · Weekly question/wishlist digest → Craig
```

**Runtime:** native HDPM-OS (Next.js API routes + Vercel crons). The one genuinely net-new piece is the **inbound Slack Events endpoint** (free-text DMs and `@Dez` mentions); today Slack only calls back on button taps. Everything else — DM sends, Block Kit buttons, signed inbound, staff resolution, the RAG answer engine — is reused.
**Repo:** this repo, `feature/dez`. Dez's CLAUDE.md / agent-prompt / skill / context files live in a subdir here; they configure the router and subagents that run against the existing spine. (The v0.2 `hdpm-crew` separate-repo plan is retired.)

## 3. Channel map & subagent scoping

| Channel | Subagent | Reads | Primary users |
|---|---|---|---|
| DM (1:1) | router → best-fit | everything the asker is scoped to | all 9 |
| #maintenance | maintenance | work orders, vendors, units, SOP-INSP-*, SOP-MO-001 | Cheryl, Jamie, Brody, Alberto |
| #all-hdpm | router → best-fit | general SOP / portfolio Q&A | everyone |
| #leasing-frontdesk *(create)* | leasing | listings, applications, showings, guest cards, tenant records | Kennedy, Ashley, Jen, Matt |
| #accounting *(create)* | accounting | ledgers (read-only), fee schedule, SOP-MO-001 §deposit, owner records | Penny |
| #dez-wishlist *(create)* | main | — (intake only) | everyone |
| #dez-activity *(create)* | — (visibility feed) | — | everyone (read) |
| #dez-audit *(create)* | — (append-only write log) | — | Craig + owners |
| #dez-digest *(create)* | — (Routine output) | — | Craig, GM when hired |

Trust boundary: no family-office or Craig-personal content anywhere in this stack. Any personal-crew agent is a separate concern with separate memory.

## 4. Consolidation map (subsume · reuse · keep-out)

Dez is a consolidation. Every "exists" claim below was verified against the codebase on 2026-08-30.

### Subsume — fold under the one Dez identity
| Today | Becomes | Notes |
|---|---|---|
| **Knowledge Chat** (`lib/rag.ts`, `/api/chat/stream`, `knowledge_chunks`) | Dez **`sop-answers`** skill | Same engine (`claude-sonnet-5`, hybrid vector+FTS), now reachable in Slack, not only the web `/` ChatWindow. |
| **Morning Action Card** (`lib/agents/morning-card*.ts`) — built but **not scheduled** in `vercel.json` (dead) | Dez daily stale-WO hygiene **Routine** → #maintenance | Dead weight; re-home rather than delete. |
| **Scattered brief DMs** (ops-brief, EOS scorecard/escalation/meeting-prep) | Dez **Routines** posting under one identity | The cron layer *is* the Routine layer. |
| **Cracks Radar Monday packet** (`lib/cracks.ts`) | Dez visibility **Routine** | Already derives "work nobody is touching, and whose it is." |

### Reuse — load-bearing, do NOT replace (Dez calls into these)
| Capability | Where | Status |
|---|---|---|
| Autonomy spine: `agent_config` (matrix + `('*','*')` kill switch), `agent_proposal`, `agent_outbox`, `staff`, `wo_event` | `supabase/migrations/20260719_*`, `lib/agents/config.ts` | live |
| Plain-language 3-tier autonomy (Supervised/Assisted/Autonomous → L1/L2/ceiling) — **already Dez-named** | `lib/agents/tiers.ts`, `components/agents/AutonomyMatrix.tsx` (`feature/dez-autonomy`) | built; merge pending |
| **Bidirectional** Slack app: bot token, `chat.postMessage`/`update`, DM sends, Block Kit buttons, **signed** interactivity receiver, staff-id resolution | `lib/agents/channels/slack.ts`, `app/api/agents/slack/interact/route.ts`, `lib/webhook-verify.ts`, `lib/agents/staff.ts` | live |
| Channel-adapter seam (slack / outlook-draft / sms-zoom / email / in-app) | `lib/agents/channels/` | live |
| RAG corpus + sync | `knowledge_chunks`, `lib/knowledge-sync.ts`, `lib/onedrive-sync.ts` | live |
| KPI layer | `kpi_snapshots` (18 KPIs), `/api/kpi/*`, `/dashboard`, `/dashboard/trends` | live (not yet wired to chat) |
| Estimate-chaser (live Jayme pilot) — the working verb+card+proposal prototype | `lib/agents/estimate-chaser*.ts`, `lib/agents/pilot.ts` | live |
| Maintenance board + WO workflow, AppFolio sync, EOS layer | `lib/maintenance/*`, `lib/eos/*`, `/api/sync/*` | live |
| Agent supervision surface | `app/agents/page.tsx` | live |

### Keep out of Dez
- The estimate-chaser's outbound **vendor** SMS/email is the one external-facing surface. Dez is internal-only (Principle 2); that outbound-vendor capability stays with the chaser/human, not Dez.
- Anything owner/tenant-facing (Haven, owner report) — out of scope (§13).

## 5. Slack topology (1:1 DMs + team channels)

Slack today is **cold**: a `#maintenance` channel and an all-HDPM channel exist but are unused. So "go where they already are" only half-applies — the channels exist, the *habit* doesn't. Dez is the anchor tenant that makes Slack worth opening.

- **DM-primary.** Every one of the 9 staff can DM Dez 1:1 — the zero-friction, private entry point. Free-text in a DM hits the Events endpoint → router picks the best-fit subagent → answers with that scope loaded. This is how each person "meets" Dez without any behavior change beyond opening a DM.
- **Activate the cold channels.** Dez joins `#maintenance` and `#all-hdpm` and becomes the reason they get opened: hygiene cards land there, and `@Dez` in-channel is answered in a thread. Channel-of-arrival routes the subagent (a question in `#maintenance` loads the maintenance scope).
- **Create the missing lanes** as they earn use: `#leasing-frontdesk`, `#accounting`.
- **Meta channels:** `#dez-wishlist` (any "wish:" intake), `#dez-activity` (visibility feed, §6), `#dez-audit` (append-only write log, §8), `#dez-digest` (weekly to Craig).
- **One item per thread.** Proactive messages open a thread; the subagent owning that item handles replies there with its context loaded. Staff experience "the conversation about the Wilson unit," not "bot #3."
- **Quiet by default.** One nudge maximum; every message carries a one-tap "stop these" and a "why" line (per the restart plan's interaction model, `10-restart` §5).

## 6. Subagent visibility (make the agentic surface legible)

When Dez routes to or spins up a subagent, humans should *see* it — the point is that the team grasps the extent of the agentic surface, not that it hides. Three surfaces, belt-and-suspenders:

1. **In-thread breadcrumb.** Each reply carries a one-line attribution footer:
   `🔧 routed to maintenance subagent · WO #4471 · 3rd chase · [stop these]`. Attribution rides in the message, not the sender (one `@Dez`).
2. **Inline "THEN, MY PLAN" before Approve** (Alven's signature). When a card proposes action, it shows Dez's numbered plan above a one-tap **Approve**, so the reasoning is legible before the human commits. Uses the existing `agent_proposal` + Block Kit button plumbing.
3. **A public activity feed + a live dashboard view.** `#dez-activity` streams every subagent spin-up and verb execution (actor, subagent, entity, timestamp) as it happens; `/agents` (the existing supervision page) gains a live "Dez now" view over `agent_proposal`/`agent_outbox`. `#dez-audit` remains the append-only *write* log (a stricter subset — every executed write verb).

## 7. Dez identity (full colleague)

Dez is a colleague, not a faceless bot — the Alven "agent-as-colleague" pattern, pointed inward.

- **Own Slack identity:** name, avatar, one `@Dez`.
- **`dez@highdesertpm.com`** — its own mailbox (zero-risk to create; home for identity and the memory surface). Note: internal identity — Dez still drafts *from staff mailboxes* for any staff-review email; the `dez@` address is not used to message tenants/owners/vendors.
- **Own AppFolio PM seat** — the move that makes the autonomy selector *real*: a Slack tap can complete work *in AppFolio*, attributed to the "Dez" user in AppFolio's own audit trail (exactly the "motion" the restart plan measures). This is the **full-colleague** upgrade and the **lead write-path candidate** (§8). Introduced least-privilege, spiked on a benign reversible action first; **scaled only after the AppFolio ToS answer.**
- **Plain-language 3-tier autonomy card** (Supervised/Assisted/Autonomous) with "how you see me / how you control me" copy, over the existing `tiers.ts` / `AutonomyMatrix.tsx`. Owner/tenant actions grey out Autonomous — the permanent L2 wall, visible.
- **View memory / "Saved a note."** A visible, editable memory surface over the existing brain (`lib/brain/*`), plus inline capture in threads ("Saved a note: [PM: Joe] send the scoped report every Tuesday 7:30 AM…"). This is Principle 5 made tangible — corrections become durable skill-file/memory text.

## 8. Write-verb registry & the write path

Every verb is a file in `skills/verbs/` defining: name, AppFolio fields touched, who may trigger it (Slack user allowlist), required card context shown before the button, and the log line format. All verb executions log to append-only `#dez-audit` (actor, verb, entity, timestamp) and write `wo_event` with actor `agent:dez`. **Hard exclusions, permanent:** anything touching trust accounting, owner distributions, ledger postings, lease terms, or tenant charges. Those stay human-in-AppFolio indefinitely.

**Write mechanism is a swappable layer** under the same `proposal → approve → execute → wo_event` loop. Four candidates, decided **Sep 4** (see `docs/agent-os/10-restart` §7 and `11-writepath-spike.md`):

| Option | Cost | Reach | Risk |
|---|---|---|---|
| **Dez-as-operator** (its own AppFolio seat, RPA) — **lead candidate, being spiked** | ~1 PM seat | superset — anything a PM can do in the web app (incl. web-only: custom inspection dates, Keys Detail, ACH import) | **AppFolio ToS gray area** — settle with rep before scaling |
| Write API (AppFolio Max) | ~$850/mo | only entities Max opens (WOs "in writing" TBD) | sanctioned, stable |
| AppFolio MCP (anticipated) | TBD | TBD | sanctioned if it ships |
| Keep retyping | staff hours | everything, manually | none, but no motion |

The runtime (native) is independent of this choice, so **no write decision blocks Phase 1**. The Alven trial (Appendix A) is partly to learn *how Alven itself writes into AppFolio*, to inform this pick.

## 9. Skill inventory (each skill wraps real code)

| Skill | Wraps / source | Phase |
|---|---|---|
| `sop-answers` | Knowledge Chat: `lib/rag.ts` + `knowledge_chunks` (ORS 90 / Notion SOPs / OneDrive docs) + brain | 1 |
| `kpi-brief` | `kpi_snapshots` (18 KPIs) + `/api/kpi/*` — **new wire-up: KPI into the chat answer path** | 1.5 |
| `wo-triage` | Jamie's spreadsheet + narrated reasoning; existing `lib/maintenance/triage*` | 1.5 |
| `deposit-clock` | SOP-MO-001 timeline (ORS 90.300) | 3 |
| `review-engine` | §11 (triggers, templates, compliance rules) | 3 |
| one per walk-through | each employee narrates one repeated task | ongoing |

## 10. Phases (re-sequenced against what's built)

### Phase 0 — mostly done
Spine, bidirectional Slack app, RAG corpus, tiers all exist. Remaining: merge `feature/dez-autonomy`; confirm the cold channels; move Brody's SOP-INSP-001/002/003 from personal OneDrive into the shared Procedures folder (picked up by `onedrive-sync`).

**Phase 0 parallel tracks (no dependency on Phase 1):**
- **Dez identity + operator spike.** Create `dez@highdesertpm.com`; add a **least-privilege** AppFolio seat; run the ~1hr reversible PoC (Slack → Dez → internal note on a benign/test WO → verify → delete). Gate scaling on the Sep-4 ToS answer.
- **Alven trial** (Appendix A) — walled-off free month as a design reference.

### Phase 1 — Dez v0: read-only Q&A (the launch)
Build the **Slack Events endpoint + router**; point it at RAG + KPI + Cracks. Reactive only; answers from SOPs, portfolio context, and AppFolio reads; deep-links into AppFolio for anything actionable. This is pure consolidation + a conversational face — **it adds no write/motion debt, so it is not blocked by the Oct-1 Loop-1 gate.**
- Jamie + Cheryl private pilot, 1 week → fix failures → standup demo → all-hands.
- Wishlist convention live ("wish:" prefix, any channel).
- **Done when:** each of the 9 has asked ≥1 real question and gotten a competent answer; wishlist has entries.

### Phase 1.5 — Proactive cards (Routines, still read-only)
Re-home the disabled Morning Card as the daily stale-WO hygiene card → #maintenance; ops-brief/KPI card per channel with "before Dez" baselines; Cracks Monday packet; weekly wishlist/failure digest → Craig.
- **Done when:** cards run 2 weeks unattended and Cheryl/Jamie act on them without prompting.

### Phase 2 — Dez v1: first write verb  *(gated: Oct-1 Loop-1 gate AND Sep-4 write-path/ToS decision)*
- Verb 1: `workorder.close` / `workorder.keep-open` (from the hygiene card's buttons), executed via the chosen write mechanism.
- Backlog sweep: the ~200 stale orders, batched through the same verb.
- **Done when:** stale count reaches 0 and stays <10 for a month.

### Phase 3 — Verb expansion (each verb earns entry individually)
`workorder.assign`, `workorder.note`, `review-request.approve` (§11), `deposit-clock.acknowledge` (Day 14/20/26 from SOP-MO-001 — fills the "nobody owns the clock" gap), `inspection.schedule`. Delinquency verbs deliberately absent pending the Haven roadmap call.

### Gate reconciliation (important)
Dez is **not** a competing workstream — it is the productization of the restart plan's "one persona, one `@name`" interaction model (`10-restart` §5). Phase 1 respects "one loop at a time" (it's read-only, no motion debt). The write phase inherits the same Oct-1 Loop-1 gate that governs the estimate chase, so Dez cannot reintroduce the sprawl `10-restart` warned against.

## 11. Review engine (Konmashi Layer 2 — HDPM instance)

*(Carried forward from v0.2 §7, intact.)*

**Goal:** sustained Google review velocity (target 3–4+/month, steady — volume, recency, and sustained influx are three separate ranking signals) without violating Google's Rating Manipulation policy, which HDPM's own sales pitch depends on being clean.

### The structural rule
**The incentive attaches to the survey. The Google ask is separate, unconditioned, and universal.** A drawing entry for a Google review is an incentive for a review — out of Google policy regardless of sponsor, sentiment, or intent. Paying for private feedback is fine everywhere.

### Flow
1. **Triggers (two):** AppFolio move-in completed; work order closed (Haven's post-repair follow-up is the natural carrier for the second).
2. **Routine** detects trigger → posts card to #leasing-frontdesk: tenant, unit, event, proposed template → PM taps **`review-request.approve`**.
3. **Send executes from the system of record** (AppFolio email template or Haven SMS) — Dez surfaces and approves, never messages tenants. Two-part content:
   - **Move-in survey** (short, "how was your move-in?"): completion = one entry in the monthly $250 drawing. Sponsor logo welcome — it's a survey prize, not a review payment.
   - **Google review ask**: same message or thank-you page, unconditioned, no drawing mention, sent to *everyone* — no filtering by survey sentiment (filtering = review gating, also banned).
4. **Monthly drawing Routine:** pick winner from survey completions, post to #leasing-frontdesk for fulfillment, log.
5. **Graduation:** after ~1 month, if PM approval rate is ~100%, flip the verb to auto-send with a 2-hour opt-out card instead of an approve card.

### Compliance rules (write into the SOP; staff must not improvise)
- No incentive of any kind tied to leaving a Google review.
- No sentiment filtering, no "review us if you're happy" routing.
- No staff review quotas or leaderboards; never ask a tenant to name an employee (both banned by Google as of April 2026).
- Every review gets a human-voiced response, positive or negative — no templated/AI-obvious replies.
- Drawing: brief official rules, free alternate entry method, Oregon counsel one-pass on the sweepstakes template.

### Instrument from day one
Reviews/month (velocity, not just count), survey completion rate, ask→review conversion by trigger type, and rating trend. This is also the before/after dataset the Konmashi product pitch needs.

## 12. Guardrails

- Dez states uncertainty rather than inventing AppFolio data; if a read fails, the card says so.
- No tenant/owner/vendor PII leaves Slack (no external posting surface exists by design).
- Compliance questions (fees, deposits, notices) answer from the SOP and flag "confirm with counsel" where the SOP does — Dez never generates novel legal positions.
- **Kill switch:** `agent_config('*','*')` `enabled=false` halts everything instantly (already wired); Routines (crons) can be disabled independently.
- **Autonomy ceilings** via `tiers.ts`: owner/tenant-facing sends hard-walled at L2 permanently; each write action promoted only on measured low override, one action type at a time.
- Spend limit set before launch.

## 13. Explicitly out of scope

Tenant-facing anything (Haven). Owner report (separate build, shares the AppFolio read plumbing). Voice. WhatsApp. Autonomous dispatch. Delinquency outreach (pending Haven call). Multi-bot identities (the backend is multi-agent; the *identity* stays single — one `@Dez`).

## 14. Open questions (resolve before or during Phase 0)

| # | Question | Owner | By |
|---|---|---|---|
| 1 | Can a Routine post directly into a channel **as Dez**, or does it need extra scopes? (native vs webhook-formatted cards) | build spike | Phase 0 |
| 2 | Slack Events API scopes for DM free-text (`message.im`) + `app_mention` — confirm app manifest + reuse of `verifySlackSignature`. | build spike | Phase 1 |
| 3 | **AppFolio ToS**: is an automated operator seat permitted? | Craig → AppFolio rep | Sep 4 |
| 4 | Which AppFolio entities does Max make writable — work orders specifically, in writing? | Craig → AppFolio rep | Sep 4 |
| 5 | Will Haven expose write-through on its partner-level AppFolio integration? | Craig → Haven rep | Sep 4 |
| 6 | AppFolio MCP: specs, pricing, timeline, unattended-service support. | Craig → AppFolio rep | Sep 4 |
| 7 | Merge `feature/dez-autonomy` (the 3-tier selector) into `feature/dez`? | Craig | Phase 0 |
| 8 | Who owns Dez operationally once the GM lands — spec assumes Craig until then. | Craig | — |

---

## Appendix A — Alven experience scorecard

Alven (`Alven-reverse.md`) is the design reference: an "AI employee that works as a PM and learns." Honest read — HDPM-OS has ~60–70% of Alven's *backend* but ~20% of its *experience*. The gap is unification + a conversational Slack face + legibility, not new plumbing. Dez = Alven's interaction design pointed inward.

| Alven signature | HDPM-OS today | Closes in |
|---|---|---|
| Plain-language 3-tier autonomy ("how you see me / control me") | ✅ built (`tiers.ts`, `AutonomyMatrix.tsx`, unmerged) | Phase 0 |
| Routines (recurring scheduled work) | ✅ the cron layer | Phase 1.5 (re-home + conversational creation later) |
| Agent plan inline ("THEN, MY PLAN") + one-tap Approve | 🟡 proposals + buttons exist; no numbered plan | Phase 2 (§6) |
| Visible/editable memory ("View memory", "Saved a note") | 🟡 brain exists; no UI/inline capture | Phase 1–1.5 (§7) |
| Conversational agent (free-text, negotiates scope in-thread) | 🟡 RAG chat on web only, not Slack | Phase 1 (Events endpoint) |
| Agent-as-colleague identity (name, avatar, email, seat) | 🟡 bot identity only | Phase 0 (§7: `dez@`, AppFolio seat) |
| Input-provenance panel ("receives," 30-day counts) + per-metric source hover | ❌ data exists, panel doesn't | Phase 1.5 (dashboard) |
| KPI dashboard w/ "before Dez" baselines, sparklines, Sankey, bento | 🟡 KPI + trends exist; Alven restyle queued | Phase 1.5 |

**The deliberate divergence:** Alven auto-communicates with tenants/owners/vendors ("I'll CC you on all my comms"). Dez does not — internal-only, drafts for staff, owner/tenant sends hard-walled at L2 permanently.

**Trial (Phase 0, walled off):** take the free Alven month as a live design reference — interaction flows, memory capture, Routines, and how it writes into AppFolio (partner-API like Haven, or an operator seat like ours?). Do **not** connect it to full live production AppFolio: request a demo/sandbox or synthetic-data mode; else narrowest scope + shortest window + disconnect after. Evaluation only; glance at their ToS for a "don't build a competitor" clause.

---

*Supersedes v0.2 (2026-08-29). Inherits the architecture, autonomy ladder, and gate from `docs/agent-os/10-restart-2026-08-20.md` and the write-path options from `docs/agent-os/11-writepath-spike.md`. Consolidation-map file references verified against `feature/dez` on 2026-08-30.*
