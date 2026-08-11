# HABU — Execution Plan & Status

Companion to the extraction spec (`~/Downloads/habu-extraction-spec.md`, v0.1).
This tracks how the spec is being built and where we are.

## Decision log

- **2026-08-11 — Container: monorepo package, not a branch, not (yet) a new repo.**
  A branch on hdpm-os is wrong: the two coexist permanently (core is
  multi-tenant; `main` is HDPM's vertical tools that stay behind), the
  dependency direction inverts (hdpm-os *imports* core), and de-HDPM-ification
  is destructive to the tenant app. Built as `packages/habu-core` (npm
  workspace `@habu/core`) on branch `feature/habu-core`. Splitting to
  `bramscher/habu-core` later is trivial while it's just a package. Full new
  repo deferred until a second tenant needs its own deploy/auth (spec §9 — name
  not even cleared yet).

## Phase A — Extract the spine

- [x] **Phase 0 — scaffold.** `packages/habu-core` workspace: package.json,
      tsconfig, vitest, `src/`, barrel `index.ts`. Root `package.json` gets
      `workspaces` + `test:habu` / `typecheck:habu` scripts.
- [x] **PR-A1 (+A2) — spine + channels.** Ported DB-free-where-it-matters spine
      and channel adapters as one cohesive, green unit (outbox depends on the
      channel registry, so they can't split cleanly). Files: `actor`, `types`,
      `audit`, `config`, `proposals`, `outbox`, `metrics-history`, `graph`,
      `channels/*`, plus new `db.ts` (env-driven Supabase) and `sms-transport.ts`
      (injectable seam replacing the `@/lib/zoom-phone` coupling). Dropped
      `STAFF_PEOPLE`/`PEOPLE` from `types.ts` → staff table only.
      **Status: 37 tests pass, typecheck clean, zero `@/` imports, zero runtime
      HDPM literals. hdpm-os suite still 443 green.**
- [x] **PR-A3 — Seats.** Ported `buildSeatTree` from `lib/eos/org.ts`; extended
      `Seat` per §3 (`holder_type`, `person_id`, `agent_id`,
      `escalation_seat_id`). Dropped the static `SEAT_AGENTS` map (§3 redefines
      seat→agent as one holder on the row, not a code-side many-map). Added
      `validateSeats` (agent-seat-needs-escalation + holder/field invariants)
      and `resolveEscalationSeat` (cycle-safe walk to first human seat).
      **Status: 47 tests pass, typecheck clean.**
      **Scope note:** escalation-ladder extraction was NOT bundled here — the
      current `escalation.ts`/`-run.ts` are fused to HDPM's tripwires (import
      `TripwireException`, hardcode tripwire #11, wire tripwire-engine +
      estimate-chaser). Separating the generic ladder from the tenant tripwire
      cluster is the same surgery as Watchers → folded into **A7**.
- [ ] **PR-A4 — Migrations.** Port the 6 §1.4 migrations minus
      `20260719_staff_seed_contacts.sql`; add `jacket`, `jacket_step`,
      `jacket_template`, `watcher_rule`; extend `seat`.
- [ ] **PR-A5 — Jacket engine (new).** Types (§4), derived-color rule,
      one-seat-at-a-time routing = the workflow engine. Move
      `business-days.ts` into core for `due_rule` (it currently lives in the
      tenant-side `lib/maintenance/` — a real spec conflict, §2 vs §4).
- [ ] **PR-A6 — Brief engine.** Generalize `morning-card.ts`: cap-at-7 +
      honest totals, decision cool-off, remove `owner==='Cheryl'` filter,
      severity → per-org config.
- [ ] **PR-A7 — Watchers + escalation ladder.** Extract the engine from
      `tripwire-engine.ts`; rules become org config. Also here: split the
      generic escalation ladder (Todo roll/miss→issue, aging/recurrence
      counting, IssueDraft) out of `escalation.ts` from the tenant-specific
      tripwire parts (deferred from A3).
- [ ] **PR-A8 — Card renderer + generalized interact endpoint** (from the
      544-line `app/api/agents/slack/interact/route.ts`).
      **Acceptance gate (§8.3):** in a sandbox Slack, post card → tap →
      external webhook fires → card collapses with no human ack.

## Phase B — Re-tenant HDPM

- [ ] Express **move-out** as the first jacket template (Appendix A.1 — five
      parallel tracks, owner-selling branch rule). Run beside paper 2 weeks.
- [ ] Re-express the 12 tripwires as watcher rules; point Morning Card at Brief.
- [ ] Port **Estimate Chaser** as the first external tenant agent.
- [ ] Wire hdpm-os to import `@habu/core` (add `transpilePackages` in Next).

## Phase C — Second-tenant readiness

- [ ] Org onboarding: create org → chart seats → photograph paper forms →
      template-from-photo agent drafts jackets → review → live.

## Out of v1

Voice, brain (interface only), CRM/pipelines, vertical tools, native mobile,
Teams adapter.

## Open items (need Craig — spec §9)

1. `⟨JACKET-SCAN⟩` paper jackets (arriving ~Aug 11) finalize template colors,
   field order, step sequences, handoffs, per-type "done" definition.
2. Confirm agent-as-seat-holder (§3) — spec assumes YES + mandatory escalation.
3. Clear "HABU" trademark/domain before build-in-public.
4. First external tenant agent to port: Estimate Chaser (recommended) or Ops Brief.
