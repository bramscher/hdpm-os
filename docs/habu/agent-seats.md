# HABU Agent Seats — roles & responsibilities

Definition of the HABU agent roster: the seats agents hold, what they own, and
their boundaries. **Names are deliberately TBD** — we name each seat once its
role is settled. These are *new* HABU agents, not HDPM's existing ops agents
(estimate-chaser / morning-card etc. stay tenant-side per spec §1.1). Everything
here becomes `agent` + `seat` + `agent_config` seed rows — data, not code.

## Model decisions (2026-08-11)

- **Hybrid slicing.** Per-jacket **Coordinators** own a jacket type end to end;
  shared **Specialists** own money/listing steps wherever they appear.
- **Draft-only outward comms (v1).** Every tenant- or owner-facing message is
  *drafted* by an agent and *sent by a human tap*. No auto-send to tenants/owners
  in v1 — hard ceiling **L2** on all outward comms, regardless of seat.
- **Listing is its own shared agent** (spans move-out + move-in).

## Autonomy ceilings (the walls)

L0 observe · L1 draft · L2 act-on-tap · L3 act-then-notify · L4 silent.
Permanent ceilings (§3 rule 2):
- **Tenant/owner-facing** → **L2** (draft; human sends).
- **Money-touching** (funds moves, ledgers, charges, ad fees) → **L2** (propose;
  human approves).
- **Internal ops** (scheduling, key tracking, listing-system updates, watchers)
  → may reach **L3/L4** once trust is earned.
- **Legal** → **L1** max (draft/chase only).

## The human bench (HDPM, 2026-08-11)

- **Property Managers** — **Matt**, **Jen**, **Kennedy**, plus a **new head
  being hired** (real person, TBD). Each is its own PM seat (one holder per
  seat). A jacket escalates to the PM who owns that property — needs a
  property→PM map (open Q3).
- **Finance** — **Penny**. Finance Closer escalates here.
- **Assistant** — **Jayme Payne**.
- **PM Assistant** — seat (holder TBD).
- **Maintenance** — seat (holder TBD).
- **Leasing** — **held by an AI agent**, not a human; escalates up to a PM. So
  the chain is agent → agent → human (*Move-In → Leasing → PM*). §3 is satisfied
  because it reaches a human; `resolveEscalationSeat` walks it.

Every agent seat names its escalation seat — the §3 safety rule (enforced by
`validateSeats`).

---

## Coordinators (own a jacket end to end)

### C1 · Move-Out Coordinator  ⟨name TBD⟩
- **Owns:** the move-out (yellow) jacket.
- **Handles autonomously (L3, internal):** save move-out date, schedule the
  turnover clean, chase key return, run the deadline/holdover watchers, keep the
  jacket moving across its tracks.
- **Drafts, human sends (L2):** move-out confirmation, prorated-rent notice, any
  tenant/owner message.
- **Escalates (human-only):** final tenant charges/credits, disputes.
- **Routes to specialists:** ADVERTISING track → Listing agent; CLOSE-OUT
  TENANTS (accounting) → Finance Closer.
- **Escalates to:** Property Manager.

### C2 · Move-In Coordinator  ⟨name TBD⟩
- **Owns:** the move-in (green) jacket.
- **Handles autonomously (L3, internal):** applicant scheduling, the
  deposit-to-hold countdown, generate the tenant packet, take down the listing
  on move-in, set up folders/inspection dates.
- **Drafts, human sends (L2):** applicant comms, welcome email, owner move-in
  letter.
- **Escalates (human-only / money L2):** the security-deposit ledger, lease
  preparation & send, HUD steps.
- **Routes to specialists:** listing takedown coordination → Listing agent.
- **Escalates to:** **Leasing (agent seat)** → which itself escalates to a
  Property Manager. NB: "leasing is our AI agent," so this Coordinator may in
  fact BE the leasing agent rather than report to a separate one — confirm the
  layering (open Q4).

## Specialists (shared across jackets)

### S1 · Listing / Advertising  ⟨name TBD⟩
- **Owns:** the ADVERTISING track wherever it appears (move-out re-list,
  move-in takedown).
- **Handles autonomously (L3, internal):** update AppFolio/website/Craigslist
  listings, attach the CL posting, keep utility/appliance info current.
- **Money-touching (L2):** ad-fee charges → propose, human approves.
- **Escalates to:** Property Manager.

### S2 · Finance Closer  ⟨name TBD⟩ — escalates to **Penny** (Finance)
- **Owns:** the CLOSE-OUT accounting track across jackets **and the whole owner
  close-out (blue) jacket** (confirmed 2026-08-11 — Finance Closer owns blue,
  spec A.5 "almost entirely a finance-seat process").
- **Handles autonomously (L2–L3 verification):** *check* ledger = $0, all
  invoices paid, recurring charges removed, reserve = $0 — all checkable against
  AppFolio (A.5). Reports pass/fail; does not move money.
- **Escalates / human-approves (L2, money):** any funds transfer, owner
  statement, final accounting, management-fee posting.
- **Escalates to:** Finance.

### S3 · Owner Onboarding Prep  ⟨name TBD⟩ — supports the PM, doesn't own the jacket
- **Owns:** nothing — the owner onboarding (black) jacket is **human-PM-owned**
  and very hands-on (confirmed 2026-08-11). This agent is a *prep* seat.
- **Handles autonomously (L1–L2, internal):** assemble everything for the
  onboarding meeting — owner info packet, HDPM setup checklist, property/utility
  data, draft of the welcome materials — so the PM walks in ready.
- **Never:** runs the meeting or the relationship; that's the PM.
- **Escalates to:** the owning **Property Manager**.
- **Note:** likely the same pattern as the existing EOS Meeting-Prep agent —
  candidate to share that machinery.

## Human-only (no agent seat)

### Eviction (red) — spec A.2
Legal steps (notice, FED filing, hearing, judgment) route to a **human** seat
only. An agent may **draft/chase (L1 max)** — reminders, document assembly — but
never acts autonomously on legal matters.

---

## Cross-cutting: the Watcher / Escalation ladder
Not necessarily a persona — it's the engine (PR-A7): scans open jackets, flags
aged/recurring/no-owner/waiting exceptions, files Issues **up the holder's human
escalation path**. Could be personified later ("the one who never forgets"), but
v1 it can run headless.

---

## The agent roster (roles settled — ready to name)
1. **C1** Move-Out Coordinator → PM
2. **C2** Move-In / Leasing Coordinator (the leasing AI agent) → PM
3. **S1** Listing / Advertising → PM
4. **S2** Finance Closer (owns the blue owner-close-out jacket) → Penny
5. **S3** Owner Onboarding Prep (supports the PM's meeting) → PM
   *(+ the Watcher/escalation ladder — headless, optional persona)*

## Still open (non-blocking — data, or refine later)
- **PM routing** — 3+ PMs (Matt/Jen/Kennedy + new head). A jacket escalates to
  the PM who owns the property; the property→PM map is tenant seed data, filled
  when we chart it. (Fallback: a default senior PM.)
- **Leasing layering** — assuming the Move-In Coordinator IS the leasing agent
  (one seat → PM), not a coordinator under a separate leasing agent. Confirm.

## Next
Name each seat (C1, C2, S1, S2) → then seed `agent` (identity/persona/expertise)
+ `seat` (holder_type='agent', escalation_seat_id) + `agent_config` (per-action
autonomy) rows, and give each a face in the demo.
