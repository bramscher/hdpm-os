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
- [x] **PR-A4 — Migrations.** Core initial schema under
      `packages/habu-core/migrations/` (0001–0006): ported agent_config /
      agent_proposal / agent_outbox / staff as **DDL only** (HDPM seed rows,
      roster, and `'hdpm'` org_id default stripped); new `seat` (§3, with
      agent-needs-escalation + holder-field CHECK constraints), `jacket_template`
      / `jacket` / `jacket_step` (§4 + App A — color=process-identity,
      derived `attention` dot per A.0), `watcher_rule` / `watcher_hit` (§5).
      Left behind: staff_seed_contacts + the EOS operating layer
      (scorecard/issues/meetings/rocks) — not the four v1 primitives; A7 adds
      the issue/todo tables the ladder needs. **Status: pending application
      (manual, same as all hdpm-os migrations). No TS/test change.**
- [x] **PR-A5 — Jacket engine (new, pure/DB-free).** `jacket/types.ts` +
      `jacket/engine.ts`: `resolveDueRule` (`created+3bd` grammar, bd/d units),
      `instantiateSteps` (first step of each track activates — parallel tracks
      per App A.1, reduces to one step for linear), `advanceStep` (completing a
      step routes to the next in-track = the workflow engine, §4 rule 1;
      immutable, idempotent), `deriveAttention` (the derived 🔴 dot; color stays
      process-identity per A.0), `currentSeatId`/`leadStep`/`projectJacket`.
      Moved `business-days.ts` from tenant `lib/maintenance/` into core + added
      `addBusinessDays`/`addCalendarDays`. **Status: 77 tests pass, typecheck
      clean.** DB persistence wrapper deferred to A8 (kept engine pure).
- [x] **PR-A6 — Brief engine.** `brief/engine.ts` generalizes
      `morning-card.ts` off tripwires onto jackets, per human seat:
      `rankBriefItems` (attention → org-config severity → age), `buildBrief`
      (cap-at-7 items but honest board totals; `needs_you` uncapped),
      `buildBriefExclusions`/`applyBriefExclusions` (decision cool-off — snooze
      until date, else 3bd; "(marked done <date> — still unresolved)" resurface),
      `briefHeadline`. Dropped `owner==='Cheryl'`, the 12-tripwire SEVERITY_TIERS
      const, and AppFolio deep links (tenant concerns). Clock-free (`today`
      passed in). **Status: 86 tests pass, typecheck clean.**
- [x] **PR-A7 — Watchers + escalation ladder.** `watcher/engine.ts`:
      `evaluateWatchers`/`evaluateRule` over the 4 kinds (aged/recurring/
      no_owner/waiting_external) with thresholds as rule params (not consts);
      `countEpisodes` ported; `watcherSignal` feeds the jacket's deriveAttention.
      `escalation/ladder.ts`: `escalateWatcherHits` (files Issues routed up the
      holder's human escalation path via resolveEscalationSeat — agents file,
      never solve), plus the generic to-do lifecycle (`decideTodoAction`,
      `rolledDueOn`, `buildTodoRoll`, `buildTodoMissedIssue`). Migration 0007
      adds `issue` + `todo`. Left tenant-side: `decideTripwireIssues`,
      estimate-chaser `buildEscalationIssue`, tripwire #11, TripwireException.
      **Status: 103 tests pass, typecheck clean.**
- [x] **PR-A8 — Card + self-closing loop + demo.**
      - **A8a (core):** `jacket/card.ts` neutral CardModel → Slack blocks OR web
        ("one line, one color, one button"; done → single ✅); `jacket/interact.ts`
        `applyJacketAction` resolves a tap OR an external event, `matchExternalEvent`
        closes the matching active step with no human ack (§7 step 3). Pure.
        Added `@habu/core/jacket` + `/brief` subpath exports.
      - **A8b (tenant/demo):** `/habu` page in hdpm-os wires `@habu/core` (added
        `transpilePackages`, `/habu` to proxy PUBLIC_PREFIXES). Client-side,
        drives the REAL core engine — tap advances, "Simulate AppFolio
        wo_scheduled" fires the external event, card collapses to ✅.
      **Acceptance gate (§8.3) MET** — verified live in-browser: tap → tap →
      external event auto-closes step (`done · system:appfolio`) → final tap →
      card collapses, "clean board 🎉". 110 core tests pass; `next build`
      clean; hdpm-os deploys with the workspace.
      **Not done here:** DB persistence store (`jacket` rows + audit_event) and
      the Slack-native interact route — deferred to Phase B (the demo proves the
      loop off the pure engine without a DB).

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
