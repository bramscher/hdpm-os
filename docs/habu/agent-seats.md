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

## Seats agents escalate to (HDPM, 2026-08-11)

- **Property Manager** — held by **two** people: **Kennedy** and **Jen**. In
  HABU a seat has ONE holder, so these are two PM seats; a jacket escalates to
  the PM responsible for that property (needs a property→PM map — see open Q3).
- **Finance** — **Penny**. The Finance Closer agent escalates here.
- **Leasing** — **held by an AI agent** (for now), not a human. It escalates up
  to a Property Manager. So the chain is agent → agent → human:
  *Move-In Coordinator → Leasing (agent) → PM (Kennedy/Jen).* The §3 rule is
  satisfied because the chain reaches a human; `resolveEscalationSeat` walks it.
- **Intake / front desk** — **Matt Free**, a *human* seat for now (not yet an
  agent). A future agent candidate (first tenant contact + triage), but out of
  the initial agent roster.

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

## Open questions to close before naming
1. **RESOLVED** — Finance Closer owns owner close-out (blue). Intake/front desk
   = Matt (human, for now). Leasing = an AI agent → PM.
2. **Owner onboarding (black jacket)** — still unassigned. Who owns it: a
   Property Manager (relationship-led), or a new "Owner Onboarding" agent?
3. **PM routing** — PM is Kennedy AND Jen. How does a jacket pick which one to
   escalate to? By property assignment (need a property→PM map)? By default (one
   senior PM)? Round-robin?
4. **Leasing layering** — is the Move-In Coordinator itself the leasing AI agent
   (one seat), or a Coordinator that reports to a separate Leasing agent seat?
   (Affects whether the chain is 2 or 3 links to a human.)

## Next
Name each seat (C1, C2, S1, S2) → then seed `agent` (identity/persona/expertise)
+ `seat` (holder_type='agent', escalation_seat_id) + `agent_config` (per-action
autonomy) rows, and give each a face in the demo.
