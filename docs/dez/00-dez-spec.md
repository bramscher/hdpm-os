# DEZ — Build Specification v0.2

**What:** HDPM's employee-facing agent. One Slack identity between the team, AppFolio, and HDPM's documented procedures.
**Not:** tenant-facing (that's Haven), owner-facing (that's the owner report), or autonomous (every write is human-triggered).
**Status:** spec. Nothing in this document is built yet except the source content (SOPs, KPI layer, portfolio context).
**Date:** August 29, 2026

---

## 1. Principles (settled — do not re-litigate)

1. **One Slack identity.** Employees never pick an agent; channels do the routing.
2. **Dez talks to employees only.** He never messages a tenant, owner, or vendor.
3. **Reads are free, writes are verbs.** Dez can read anything he's scoped to. He can write only through a named, logged, human-triggered verb. There is no "Dez has the API."
4. **Cards end in a link (v0) or a button (v1). Never in "go figure it out."**
5. **Every correction becomes skill-file text.** If someone fixes Dez twice for the same thing, the fix wasn't captured.
6. **Proactive = Routines.** Scheduled jobs that read AppFolio and post cards. Dez-in-channel is reactive; the Routine layer is where proactivity lives.

## 2. Architecture

```
                        ┌──────────────────────────────┐
                        │  SLACK (one identity: Dez)   │
                        │  #maintenance #leasing        │
                        │  #accounting #front-desk      │
                        │  #dez-wishlist #dez-digest    │
                        └──────┬───────────────▲───────┘
                               │ questions      │ answers + cards
                        ┌──────▼───────────────┴───────┐
                        │  DEZ MAIN AGENT (router)      │
                        │  CLAUDE.md: HDPM context,     │
                        │  channel map, delegation      │
                        └──┬───────────┬───────────┬───┘
                           │           │           │
                 ┌─────────▼──┐ ┌──────▼─────┐ ┌───▼────────┐
                 │ maintenance│ │ leasing /  │ │ accounting │
                 │ subagent   │ │ front desk │ │ subagent   │
                 └─────┬──────┘ └──────┬─────┘ └───┬────────┘
                       │               │           │
        ┌──────────────▼───────────────▼───────────▼─────┐
        │            TOOL / DATA LAYER                    │
        │  AppFolio read API (Plus — have today)          │
        │  AppFolio write verbs (DB API — when it lands)  │
        │  SharePoint (SOPs, Procedures Handbook)         │
        │  KPI layer (existing exports/queries)           │
        └────────────────────────────────────────────────┘

        SCHEDULED LAYER (Routines, independent of chat):
        · Daily stale-WO hygiene card → #maintenance
        · Monday KPI card → per channel
        · Weekly question/wishlist digest → Craig
        · (later) Day-14/20/26 deposit-clock escalations → per SOP-MO-001
```

**Runtime:** Claude Tag (Option A from the port plan). Custom multi-bot Agent SDK build is the deliberate later swap, not the start.
**Repo:** `hdpm-crew` (forked skeleton per the port plan §Phase 4) — CLAUDE.md + `.claude/agents/*` + `skills/` + `context/`. Lives in git from day one.

## 3. Channel map & subagent scoping

| Channel | Subagent | Reads | Primary users |
|---|---|---|---|
| #maintenance | maintenance | work orders, vendors, units, SOP-INSP-*, SOP-MO-001 | Cheryl, Jamie, Brody, Alberto |
| #leasing-frontdesk | leasing | listings, applications, showings, guest cards, tenant records | Kennedy, Ashley, Jen, Matt |
| #accounting | accounting | ledgers (read-only), fee schedule, SOP-MO-001 §deposit, owner records | Penny |
| #dez-wishlist | main | — (intake only) | everyone |
| #dez-digest | — (Routine output) | — | Craig, GM when hired |

Trust boundary note: no family-office or Craig-personal content anywhere in this stack. `craig-crew` is a separate repo, separate memory, per the agent-team recommendation.

## 4. Phases

### Phase 0 — Content & plumbing (prerequisite, mostly done or in flight)
- [x] SOP-MO-001 drafted
- [ ] Brody's SOP-INSP-001/002/003 moved from personal OneDrive to shared Procedures folder
- [ ] `hdpm-crew` repo created; SOPs + PORTFOLIO/OPERATIONS context files in
- [ ] AppFolio read-API credentials confirmed working from a Routine
- [ ] Claude Tag enabled (gate: Team plan, 10-seat minimum vs 9 humans — buy the empty seat)

### Phase 1 — Dez v0: read-only Q&A (the launch)
Reactive only. Answers from SOPs, portfolio context, and AppFolio reads. Deep links into AppFolio for anything actionable.
- Jamie + Cheryl private pilot, 1 week → fix failures → standup demo → all-hands
- Wishlist convention live ("wish:" prefix, any channel)
- **Done when:** each of the 9 has asked ≥1 real question and gotten a competent answer; wishlist has entries.

### Phase 1.5 — Proactive cards (Routines, still read-only)
- Daily stale-WO hygiene card: anything untouched ≥14 days, batched, each item deep-linked
- Monday KPI card per channel, every metric stamped with its "before Dez" baseline
- Weekly digest Routine: all questions + wishes + failures → Craig
- **Done when:** the cards run 2 weeks unattended and Cheryl/Jamie act on them without prompting.

### Phase 2 — Dez v1: first write verb
- Verb 1: `workorder.close` / `workorder.keep-open` (from the hygiene card's buttons)
- Backlog sweep: the ~200 stale orders, batched through the same verb
- **Done when:** stale count reaches 0 and stays <10 for a month.

### Phase 3 — Verb expansion (each verb earns entry individually)
Candidates, in rough order: `workorder.assign`, `workorder.note`, `review-request.approve` (§7), `deposit-clock.acknowledge` (Day 14/20/26 checkpoints from SOP-MO-001 — fills the "nobody owns the clock" gap), `inspection.schedule`. Delinquency-related verbs deliberately absent pending the Haven roadmap call.

## 5. Write-verb registry (the v1 design)

Every verb is a file in `skills/verbs/` defining: name, AppFolio fields touched, who may trigger it (Slack user allowlist), required card context shown before the button, and the log line format. All verb executions log to an append-only `#dez-audit` channel (actor, verb, entity, timestamp). **Hard exclusions, permanent:** anything touching trust accounting, owner distributions, ledger postings, lease terms, or tenant charges. Those stay human-in-AppFolio indefinitely.

## 6. Skill inventory (initial)

| Skill | Source | Phase |
|---|---|---|
| `wo-triage` | Jamie's spreadsheet + her narrated reasoning (the walk-through) | 1.5 |
| `sop-answers` | Procedures Handbook + SOP-MO-001 + SOP-INSP-* | 1 |
| `kpi-brief` | existing KPI layer queries | 1.5 |
| `deposit-clock` | SOP-MO-001 timeline (ORS 90.300) | 3 |
| `review-engine` | §7 of this spec (triggers, templates, compliance rules) | 3 |
| one per walk-through | each employee narrates one repeated task | ongoing |

## 7. Review engine (Konmashi Layer 2 — HDPM instance)

**Goal:** sustained Google review velocity (target 3–4+/month, steady — volume, recency, and sustained influx are three separate ranking signals) without violating Google's Rating Manipulation policy, which HDPM's own sales pitch depends on being clean.

### The structural rule
**The incentive attaches to the survey. The Google ask is separate, unconditioned, and universal.** A drawing entry for a Google review is an incentive for a review — out of Google policy regardless of sponsor, sentiment, or intent. Paying for private feedback is fine everywhere.

### Flow
1. **Triggers (two):** AppFolio move-in completed; work order closed (Haven's post-repair follow-up is the natural carrier for the second).
2. **Routine** detects trigger → posts card to #leasing-frontdesk: tenant, unit, event, proposed template → PM taps **`review-request.approve`**.
3. **Send executes from the system of record** (AppFolio email template or Haven SMS) — Dez surfaces and approves, never messages tenants. Two-part content:
   - **Move-in survey** (short, "how was your move-in?"): completion = one entry in the monthly $250 drawing. Sponsor logo welcome here — it's a survey prize, not a review payment.
   - **Google review ask**: same message or survey thank-you page, unconditioned, no drawing mention, sent to *everyone* — no filtering by survey sentiment (filtering = review gating, also banned).
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

## 8. Guardrails

- Dez states uncertainty rather than inventing AppFolio data; if a read fails, the card says so.
- No tenant/owner/vendor PII leaves Slack (no external posting surface exists by design).
- Compliance questions (fees, deposits, notices) answer from the SOP and flag "confirm with counsel" where the SOP does — Dez never generates novel legal positions.
- Spend limit set in Tag admin before launch.
- Kill switch: disabling the Tag integration stops everything; Routines disabled independently.

## 9. Open questions (resolve before or during Phase 0)

1. **Routine → Slack posting path.** Can a Routine post directly into a channel as Dez, or does it need an incoming webhook? Determines whether cards are native or webhook-formatted. *Unverified — test first.*
2. **Card buttons in Tag.** Whether Tag supports interactive buttons or v1 verbs run as reply-keyword ("reply CLOSE 4471") until the SDK swap. Affects UX, not architecture.
3. **AppFolio read-API rate limits** at ~500 work orders / daily polling.
4. **DB Write API delivery date** (was "1–2 weeks away" on Aug 23 — confirm).
5. **Who owns Dez operationally** once the GM lands — the spec assumes Craig until then.

## 10. Explicitly out of scope

Tenant-facing anything (Haven). Owner report (separate build, shares the AppFolio read plumbing). Voice. WhatsApp. Autonomous dispatch. Delinquency outreach (pending Haven call). Multi-bot identities (later swap, designed-for, not built).
