# HDPM-OS — Executive Recommendation

> For Craig. Plain-language summary of the full exploration
> (docs 01–10, 12). 2026-08-03.

## What HDPM-OS should become

The one place where HDPM's work is **seen, decided, assigned, executed, and
remembered**. You already own more of this than you may realize: the
maintenance board, tripwires, invoicing, inspections, KPI dashboards, and a
working agent team (morning cards, chasers, ops briefs) are all live in this
codebase. HDPM-OS is the same system grown three layers: a **company brain**
(searchable institutional memory with citations), an **operating cadence**
(scorecard, issues, weekly meeting, decisions that don't evaporate), and a
**CRM + workflow engine** that replaces what LeadSimple would have done —
plus, later, a **bounded execution layer** so agents can do real chunks of
verified work under your approval rules.

## What stays in AppFolio

Everything transactional: properties, units, owners, tenants, leases,
ledgers, accounting, trust money. HDPM-OS mirrors it read-only, builds
workflow and intelligence around it, and — only if you buy a write path —
completes the exact actions a human already tapped. No second ledger, ever.

## The external projects — go / modify / reject

| Project | Call | One-line why |
|---|---|---|
| **GBrain** (Garry Tan's brain) | **Modify → borrow the design, not the software** | Brilliant architecture (hybrid search, citations, gap analysis, nightly self-maintenance), MIT-licensed, hugely popular — but 4 months old, fast-churning, and its multi-user security is weeks old and self-tested. We copy its patterns into our own Supabase (where a working search pipeline already runs) instead of operating and trusting a second system. Optional: a throwaway sandbox instance on public SOPs to calibrate quality. |
| **Ringer** (agent swarm runner) | **Modify → borrow the pattern; use the tool only as a fenced dev workbench** | Its core idea — agents must *prove* work via checks the boss executes, cheap workers + premium reviewers, every attempt costed and logged — is exactly the right discipline. The tool itself is a month old, one-maintainer, single-user, and its license blocks any future product embedding. We implement the same contract as a small internal runner; Ringer itself can help build this repo on an isolated machine with no real data. |
| **FounderOS-DEMO** | **Reject as code; keep as a design reference** | A 3-day-old, AI-generated demo running on fake seeded data (its own README says so). Some screens are worth studying — agent activity + cost panels, command palette, org chart. Nothing to depend on. |
| **Founder Chief of Staff** | **Reject as code; adopt three ideas** | It's a methodology, not software (zero users). Its "automation contracts" (every automated job declares allowed inputs, allowed writes, stop conditions, verification), "state registry" (what's authoritative vs mirrored), and contradiction-as-blocker rules slot straight into our agent specs. |

## What to build first — the 30-day proof of concept

**Company Brain PoC + first EOS loop** (after a short hardening pass):

1. **Week 1 — hardening essentials:** real user roles in the database
   (replacing the env-file admin list), missing schema captured, per-service
   tokens. Unsexy; prevents expensive regret.
2. **Weeks 2–3 — brain v1:** ingest what already exists (SOP corpus, the
   agent-os decisions, meeting notes, this docs folder); answers in the
   knowledge chat with citations **and "here's what I don't know"**; nightly
   dedup/contradiction pass; agents (Ops Brief first) start citing it.
3. **Week 4 — first weekly loop:** scorecard (auto-filled from KPI
   snapshots), an Issues list fed by tripwires, a runnable weekly-meeting
   screen, to-dos with owners. Run two real meetings in it.

**Success test:** in week 4 you ask "why did we stop using Property Meld,
and what did we decide about vendor SMS?" and get a cited, correct answer —
and your Monday meeting runs from a screen where nothing discussed gets
lost.

## Biggest risks (top 5)

1. **Adoption, not technology.** The agent-os finding stands: detection
   without staff action is worthless. Every layer keeps the ≥25
   actions/week gate; if a surface isn't used, we stop building on it.
2. **Authorization debt.** Today security = app code + one env variable;
   fine for 10 trusted staff, not for CRM/finance/HR-adjacent data. Phase 0
   fixes this first.
3. **Brain pollution or leakage.** Indexing everything would make the brain
   both noisy and dangerous. Allowlisted, curated ingestion with hard
   exclusions (screening data, HR, ledgers, door codes — never stored).
4. **Young dependencies.** GBrain/Ringer churn weekly. Borrowing patterns
   instead of adopting code is the insurance; nothing in the plan breaks if
   either project dies.
5. **Scope gravity.** CRM + EOS + brain + execution is a year of steady
   waves, not a quarter. The phase gates and "deliberately not built" lists
   are the defense; the agent-os rollout keeps delivering value in
   parallel.

## Bottom line

The repo is the right foundation — keep it, rename it, harden it. Build the
brain and the weekly operating loop on top of what's shipped, borrow the
best ideas from all four external projects, adopt none of them as
load-bearing dependencies, and keep every consequential action behind a
human tap.
