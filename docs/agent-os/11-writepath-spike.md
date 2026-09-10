# Write-Path Spike — Dez as an AppFolio operator (RPA vs. Write API)

**Date:** 2026-08-24 · **Status:** proposed spike, not started · **Owner:** Craig decides go/no-go

> Companion to `10-restart-2026-08-20.md` §3 (write access) and §7 (Sep 4 decision).
> This adds a **fourth option** to the write-path decision and defines a cheap test for it.

---

## The idea

Give **Dez its own AppFolio user account** (a real PM seat) and let it **operate the
AppFolio web app directly** (browser automation / RPA) to perform the writes the v0
API cannot — driven by a Slack instruction. If a Slack tap can make Dez complete a work
order *in AppFolio*, the autonomy ladder stops being theatre (restart plan §3: "a tap
*is* the job").

This sits alongside the three options already on the table:

| Option | Cost | Reach | Risk |
|---|---|---|---|
| **Write API (Max)** | ~$850/mo | Only entities Max opens (WOs "in writing" TBD) | Sanctioned, stable |
| **AppFolio MCP** (anticipated) | TBD | TBD | Sanctioned if it ships |
| **Keep retyping** | staff hours | everything (manually) | none, but no motion |
| **Dez-as-operator (this)** | ~1 PM seat | **superset — anything a PM can do in the web app** | **ToS gray area (the gating risk)** |

## Why it's attractive
- **Reaches web-app-only capabilities** the API (even paid) can't: custom inspection
  dates, Keys Detail, ACH import, report exports — walls we've already hit.
- **Clean attribution:** actions land in AppFolio's audit trail as the "Dez" user → the
  exact "motion" signal the restart plan measures.
- **Cheaper** than $850/mo (a per-user seat).
- **Makes the autonomy selector real** — "Supervised → act-on-tap" only means something
  if the tap completes work in the system of record.

## The gating risk — settle this BEFORE any scaling
- **AppFolio Terms of Service on automated web access.** The Write API exists *because*
  they want machine access to go through the paid channel; bot-driving a licensed seat
  on our live 830-door system of record could get the account **flagged or suspended.**
  → **Action: read the AppFolio ToS / ask our rep** whether an automated operator seat is
  permitted. Put it on the same Sep 4 call as "confirm what Max makes writable" and "call
  Haven." Do **not** scale this without an answer.
- Secondary: web RPA is **fragile** (breaks on UI changes) and **high-blast-radius** with
  full PM rights — must run behind approval gates, never open-loop.
- Session/2FA: a persistent authenticated browser session for the Dez seat is its own
  brittle security surface.

---

## The test (proof-of-concept — ~1 hour, $0, reversible)

**Goal:** prove "Slack instruction → Dez → AppFolio web app → verified change" for a
single benign, reversible action, with a human watching.

**Setup**
1. A Dez AppFolio login (or an existing test/low-rights account for the spike; full PM
   rights are *not* needed to prove the loop).
2. A browser-automation harness (we already drive Chrome via Claude-in-Chrome; a headless
   Playwright script is the productionizable version).
3. A **sandbox or trivially-reversible target** — ideally a test work order; if none, an
   internal *note* on a real WO (no tenant/owner-facing effect, nothing that sends).

**Steps**
1. Post in Slack: `Dez, add internal note "<token>" to WO #____`.
2. Dez logs into the web app, navigates to that WO, adds the note.
3. Dez reads the note back and replies in Slack with confirmation + a screenshot.
4. Human verifies the note in AppFolio; then deletes it (reversible).

**Success =** the note appears, attributed to the Dez user, from a Slack tap, with no
manual AppFolio clicks by staff.

## Guardrails (non-negotiable for anything past the spike)
- **Behind the autonomy ladder.** No web write above the action's ceiling; owner/tenant
  actions stay L2 (human-approved) permanently — same wall as the selector enforces.
- **One action type at a time**, promoted only on measured low override (restart plan §2 rule 6).
- **Approval gate before every write** until an action type earns L3+.
- **Velocity + hours caps** (max writes/run, business hours) to avoid bot-pattern detection
  and limit blast radius.
- **Every write logged to `wo_event` / `audit_event`** with actor `agent:dez` so it counts
  as motion and is fully traceable/reversible.
- **Kill switch** (`agent_config ('*','*')`) halts it instantly — already wired.

## Decision for Sep 4
Bring: the spike result (did the loop work?), the ToS answer, and a cost compare
(seat + maintenance vs. $850/mo Write API vs. MCP). Then choose the write path with real
data instead of assumptions.

## Open questions for Craig
1. Does AppFolio's ToS permit an automated operator seat? (rep call)
2. Is there a **test/sandbox work order** we can use, or should the first write be an
   internal note on a real WO?
3. Which **first action type** do we want the loop to complete — WO status, internal note,
   scheduling, inspection date? (Pick one benign, high-frequency, reversible one.)
4. Full PM rights, or start least-privilege and widen only as trust is earned?

*Nothing in this spike is started. It touches the live system of record, so it needs an
explicit go and a human in the loop for every write.*
