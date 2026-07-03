# Maintenance OS — Developer Handoff (hdpm-chat)

Drop this folder into the hdpm-chat repo as `docs/maintenance-os/` and add one line to the repo's `CLAUDE.md`:

```
Maintenance OS build: read docs/maintenance-os/00-README.md before any maintenance-related work. Build one wave at a time (03-build-waves.md). The dashboard mockup (04) is the visual spec.
```

## What's in this folder

| File | What it is | Use it for |
|------|-----------|------------|
| `01-product-brief.md` | Why this exists, the 8-stage lifecycle, the 12 tripwires | Context — read first |
| `02-functional-spec.md` | Exact statuses, fields, SLAs, tripwire rules, closure gate | The behavioral contract — acceptance criteria live here |
| `03-build-waves.md` | Feasibility verdicts + build order (3 waves) | Scoping each Claude Code session |
| `04-dashboard-mockup.html` | Clickable 7-view mockup with the brand system | Visual spec — match it, including the wait-type color system |
| `05-data-model.md` | Starter Supabase schema (tables, key constraints) | First migration draft — pressure-test, don't paste blindly |

## How to work this with Claude Code

1. **One wave per session.** Each wave in `03-build-waves.md` is a coherent scope. Start sessions with: *"Read docs/maintenance-os/, then plan Wave 1 against the current codebase"* — plan mode first, then build.
2. **The blocking unknown comes first.** Before Wave 2 architecture: verify AppFolio API **write** scope (WO create/update/attach) against our instance. Reads are proven. See `03-build-waves.md` §Blocking Unknown.
3. **Tripwires are testable.** Every tripwire in `02-functional-spec.md` is an if-then rule — ask Claude Code to write each as a unit-tested function before wiring it to cron.
4. **The closure gate is server-side validation**, not UI convention. A WO cannot reach CLOSED unless all six conditions pass.
5. **Reuse what exists.** Time/materials logging, auto-priced invoicing, and route optimization already live in this codebase. Point Claude Code at those modules as patterns before it invents new ones.
6. **Brand:** greens `#2f7d32` / `#1f5c22` / `#eef5ee`, ink `#1a1a1a`, muted `#5b625b`, hairline `#c7cec7`. Wait-type colors are in the mockup CSS (`--w-*` variables). Helvetica/Arial.

## Ground rules (from the ops plan — do not violate)

- **AppFolio is the system of record.** This app reads from it and mirrors it; it never becomes a competing WO database. No ledger writes, ever.
- **One accountable owner + next-action date on every open WO.** No state where nobody is obligated to act by a date.
- **Techs never set prices.** hdpm-chat computes billables (1-hr minimum + markup); techs enter time + materials only.
- **Owners see one summary line per job** — never raw notes or multi-line charges.
- **Decision pending Sep 4, 2026:** build vs. Jobber vs. Realm-X. Waves 1 is safe to build regardless (dashboard/tripwires are needed in every scenario). Don't start Wave 2/3 before the decision unless Craig says so.
