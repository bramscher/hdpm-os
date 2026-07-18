# HDPM-OS Agent Team — Part 1 Questions, Answered

> Recorded 2026-07-18 in a live walkthrough with Craig. Source of truth for the
> assumptions in `00-DRAFT-master-plan.md` (revised same day). Team facts
> cross-checked against the Notion page "HDPM Roles and Responsibilities —
> Detailed" (as of 2026-07-09).

## Q1. Channel — Slack, not Teams

**Answer: Slack for desk staff; Zoom Phone SMS for the field.**

- Slack is **already in daily use** at HDPM, so the draft's "M365 shop → Teams"
  premise was wrong on the channel (the M365/Graph stack itself stays — Outlook
  drafts and calendar work are unaffected). The "meet staff where they already
  are" thesis transfers wholesale to Slack; Block Kit provides the tap-to-act
  buttons the plan needs.
- **Q1a (field):** Zoom Phone SMS, not Twilio. The paused Twilio/10DLC path stays
  dead — no registration long-pole. *Verification task:* confirm Zoom Phone's
  SMS API supports inbound webhooks for structured "DONE / BLOCKED" replies.
- Channel-per-person reality (from Craig): **Brody** is mostly in AppFolio and
  now Slack → Slack surface. **Cheryl** is mostly in AppFolio and email today →
  her Morning Action Card ships Slack-first **with an email mirror** during
  Phase 1 (same outbox, two deliveries; measure which surface she acts from).
  **Alberto** is the SMS-only field case.

## Q2. Autonomy ceilings (maximums ever, not starting points)

| Action types | Ceiling |
|---|---|
| (a) next-action dates, (f) WO assignment to techs | **L4** — fully autonomous after earned promotion |
| (b) drafting + (c) sending vendor chases | **L3** — send-then-notify, with daily caps and no-double-chase rules |
| (d) owner approval drafts, (e) owner-facing sends, (i) tenant notices | **L2 hard wall, permanent** — nothing reaches an owner or tenant without a human tap |
| (g) AppFolio writes (post-Sep 4, if a write path exists) | **L2** — a write only ever happens as the completion of an approved proposal tap |
| (h) invoice creation | **L1/L2** — Penny confirms every invoice |
| Ledger writes | **Never, at any level** |

These match the draft's guardrails; they are now explicit policy, not assumption.

## Q3. Which pain first — Cheryl, maintenance focus

**Answer: Cheryl first.** Phase 1 = Cheryl's Morning Action Card + the Estimate
Chaser (retargeted, below) + Craig's Ops Brief.

Role corrections that came out of this question (confirmed against Notion):

- **Jen does not own estimates/approvals** — the draft had this wrong. Vendor
  work is **all Cheryl**, with **Brody assisting** on vendor follow-up and
  project management of unit turns. The Estimate Chaser is a **Cheryl/Brody
  agent end-to-end** (vendor bid chases *and* owner approval requests are
  Cheryl's).
- **PMs (Jen, Bianca, Kennedy) do nothing in maintenance or unit turns** — only
  compliance, move-in/move-out, and sales. A future PM-lane agent is their home.
- **Jen is on leave for ~6 weeks** starting around Phase 1 — with the ownership
  correction, her leave no longer touches Phase 1 at all.
- **Kennedy** does no vendor work; she's a tech-savvy early-adopter candidate
  for the PM lane later, nothing more for now.

## Q4. Haven.AI — API exists, but Haven is replaceable

**Answer: Haven exposes an API/webhook**, so tripwires #1 and #9 can be
un-stubbed for real and the After-Hours Intake Agent gets a concrete
integration brief. **But Haven is on the table for replacement**, so:

- Build a **thin adapter behind a generic "after-hours call source" interface**.
  Haven is the first implementation, not the foundation; a vendor swap rewrites
  only the adapter.
- **Ashley (Front Desk) is the daytime Haven monitor** (continuous dashboard
  watching per her role doc) — she is the natural human-in-the-loop for
  call-derived WO proposals, and the intake agent should reduce her
  watch-the-dashboard burden, not route around her.
- *Action item:* get Haven API docs/credentials before scheduling the intake
  brief.

## Q5. Budget — value-gated, not capped; Write API decision reframed

**Answer (envelope): no fixed monthly ceiling — spend follows demonstrated
hours-saved.** Per-agent daily action caps and per-month token budget caps act
as circuit breakers, reviewed monthly against `metrics_snapshot`.

**Answer (AppFolio Write API): reframed by the anticipated AppFolio MCP.**
Craig flags that an official AppFolio → Claude MCP is releasing soon (specs
unknown) and that, alongside Realm-X workflows, it might avoid the $850/mo
Write API entirely. Recorded as:

- The **≥40 retyped-touches/week metric gets built and measured regardless**
  (cheap `wo_event` query; quantifies the pain whichever write path wins).
- **Sep 4 becomes a three-way write-path decision:** buy the Write API now /
  wait for the AppFolio MCP / keep humans retyping.
- Cautions: an "MCP for Claude" may be designed for *interactive* use — its
  licensing and suitability for unattended agent-service writes, and its write
  scope (statuses? assignments? notes?), are unknown. Promising cost-avoider,
  not yet a plannable dependency.
- *Action items:* obtain MCP specs/pricing/timeline before Sep 4; inventory
  what Realm-X automates natively (anything Realm-X does for free leaves our
  agent scope).

## Q6. Bryce — license holder only; inspections belong to Brody

**Answer (confirmed): no agent maps to Bryce.** He holds the company CCB
license and does high-level oversight only (Notion shows 62 hrs/month in the
table vs 2 hrs/month in the detail section — worth fixing in Notion; either
way, no operational workflows).

- **Inspections Cadence Agent → Brody** (Property Inspector: routine + move-out
  inspections, notices, move-in/move-out WOs, deposit paperwork).
- **Leasing/compliance stays with the PM team** under Jen.

Further roster facts the draft was missing (from Notion):

- **Matt Free** (Executive PM, 25 hrs/wk) holds high-level maintenance
  oversight and is Cheryl's manager — and he's **transitioning out of that
  oversight through ~Dec 2026**. The agent layer is part of what absorbs the
  handoff; offer him the Ops Brief alongside Craig.
- **Alberto** is Maintenance **Lead** Tech: leads unit turns, oversees vendor
  work quality, updates WOs in AppFolio himself. The SMS day-close fits, but he
  is a quality-control node, not just a route-follower.
- **Bianca** (Assistant PM) shares the compliance/onboarding lane with Kennedy.
- **Ashley** (Front Desk) monitors Haven — see Q4.
- Where the (July 9) Notion doc and Craig differ on turns — Notion has Alberto
  leading vendor coordination; Craig says Brody does vendor follow-up with
  Cheryl — Craig's statement is treated as current: turns are Cheryl + Alberto
  + Brody, with **Cheryl owning the vendor relationship**.

## Q7. Product ambition — option kept open cheaply; add-on shape

**Answer: keep the option open cheaply** (the draft's assumption, confirmed):
`org_id` + RLS on all new tables, channel adapters behind one interface,
autonomy matrix and prompts as config — because those are cheap now. Billing,
self-serve onboarding, white-label, SOC2 all deferred until an HDPM case study
exists (~Q1 2027).

**Shape, if it happens: the agent team as an AppFolio add-on**, not the whole
OS. The OS stays HDPM's internal chassis; the sellable wedge rides AppFolio's
ecosystem (which the anticipated AppFolio MCP strengthens).

## Q8. Sep 4 framing — one input among several

**Answer: the agent plan is one input among several** at the build-vs-Jobber-
vs-Realm-X decision — weighed alongside cost, team capacity, and the
Jobber/Realm-X evaluations. Consequences:

- **Aug 25 is a target, not a hard gate.** Phase 1 shouldn't distort itself to
  hit the date.
- Phase 1 metrics are assembled as a **briefing input** (adoption counts,
  latency deltas, retyped-touches/week), not as "the build case" per se.
- The write-path question (Q5) is a distinct agenda item at the same meeting.

---

## Consolidated action items

1. Verify Zoom Phone SMS API inbound webhook support (blocks Agent #4 design).
2. Get Haven API docs/credentials + named contact (blocks Agent #9 brief).
3. Get AppFolio MCP specs, pricing, and release timeline before Sep 4.
4. Inventory Realm-X native automations (scope subtraction for our agents).
5. Fix the Bryce hours discrepancy in the Notion roles page (62 vs 2 hrs/month).
6. Confirm with Cheryl which surface she prefers acting from (Slack card vs
   email mirror) after two weeks of Phase 1 data.
