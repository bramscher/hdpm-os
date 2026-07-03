# Product Brief — HDMS Maintenance OS

## Why

Maintenance is HDPM's highest-leverage experience: tenants judge responsiveness, owners judge stewardship, HDMS earns its margin there. Target properties of the system: at any moment we know the status of every open job, we know who/what each is waiting on, and one named person is accountable for moving it. North star: **eliminate every place work falls through cracks.**

Context: ~850 doors (target 1,500 in 24 mo). HDMS operates as an internal vendor inside AppFolio, dispatched first, external vendors as chosen overflow. HDMS revenue target Year 1 ~$500K, Year 3 ~$1.5M. The dispatch decision logic is the moat — which is why it's built, not rented.

## Existing stack (do not duplicate)

- **AppFolio** — system of record: properties, units, tenants, owners, vendors, WOs, bills, statements. API reads proven (this codebase uses them). Write scope = open verification item.
- **Haven.AI** — 24/7 reception, maintenance triage, showing scheduling. Owns tenant-facing intake conversation.
- **hdpm-chat (this repo)** — Claude + Supabase + Next.js. Already live: tech time/materials logging (SOP-MT-002), auto-priced invoice generation (1-hr min + markup, tech never prices), route optimization for inspections, AppFolio API integration.
- **QBO** — internal cost layer (true labor/materials cost vs. billed).
- Property Meld: decommissioned. Do not reference.

## The 8-stage lifecycle

Every job (tenant request, inspection finding, turn, emergency) moves through:

1. **NEW** — logged (Haven or inspection). Exit: triaged same business day.
2. **TRIAGED** — priority set, category set, HDMS-vs-vendor dispatch decision made.
3. **SCHEDULED** — date agreed with tenant AND tech/vendor; parts on hand/ordered.
4. **IN PROGRESS** — work underway; time/materials logged.
5. **WAITING ON** — blocked, with mandatory reason: TENANT / VENDOR / PARTS / OWNER / WEATHER / INTERNAL + next-action date. 48-hr follow-up cycle.
6. **VERIFY** — photos + time + materials required; quality confirmed (Alberto field; Brody for inspection-originated) before billing unlocks.
7. **BILL** — hdpm-chat generates invoice, uploads to AppFolio, single summary line.
8. **CLOSED** — only via the six-condition closure gate (see functional spec).

Two invariants: every open job has a **named owner** and a **next-action date**. A WAIT tag without a date is a violation by definition.

## The 12 tripwires (crack-proofing)

| # | Failure mode | Tripwire | Owner |
|---|-------------|----------|-------|
| 1 | Request never becomes a WO | Nightly Haven-log vs. AppFolio-WO diff | Cheryl |
| 2 | WO never assigned | No owner >1 business day → flag | Cheryl |
| 3 | Stalls in Waiting On | Next-action blank or past → flag | Cheryl |
| 4 | Vendor never accepts | Unaccepted >24h → escalate by phone | Cheryl |
| 5 | Failed access | Mandatory log; auto-return to SCHEDULED w/ new date | Cheryl |
| 6 | Scope grows w/o approval | Pause at "approval required"; no bill w/o matching approval | Alberto |
| 7 | Docs missing | VERIFY blocks BILL without photos+time+materials | Alberto |
| 8 | Done but unbilled | Verified >5 days, no invoice → weekly report | Penny |
| 9 | Closed but not fixed | Haven ping at close; negative reply → auto follow-up WO | Cheryl |
| 10 | Field follow-ups lost | Tech recommendation → WO or written dismissal in 3 days | Alberto |
| 11 | Owner approval stalls | Pending >3 business days → PM follow-up task | Jen/PMs |
| 12 | Turns drag silently | Turnover board: days vacant, ready date, blocker | Cheryl+Alberto |

Principle: **no job may ever be in a state where zero people are obligated to act on it by a specific date.**

## People (for role logic)

Cheryl Waterman — coordinator (dispatch, sweep, WO tracking; does NOT bill). Brody Bramscher — inspector, FT (bills own jobs). Alberto Flores — lead tech (bills own jobs; NOT CCB licensed). Bryce Bramscher — company CCB license holder (oversight 6 hrs/mo). Penny Free — finance (bills, unbilled review). Jen Bertran — Sr PM (owner approvals, violations). Craig — decisions.

## Operating rhythm the software serves

- Cheryl's daily sweep (10–15 min): Exceptions view to zero.
- Monday ops review (30 min): the dashboard IS the agenda (P1s, 30+ aging, vendor >5d, verify/unbilled queue, turns, one improvement).
- Phase-1 definition of done: Exceptions view reads zero for 5 consecutive business days.
