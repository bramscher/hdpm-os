# HDPM Ops Soul & Brain — Revised Run (not a port)

**Created 7/22/2026.** Reference specs in `konmashi-reference/` were authored by
Craig Bramscher (Kompass component, Konmashi repo). This folder is a **revised,
ops-focused implementation for HDPM-OS** — read the references for the proven
patterns, then design fresh against this codebase. Do not copy Konmashi code.

## Relationship to the rest of the repo
- Sits on the agent-os spine (`docs/agent-os/`): the soul/brain is the **context
  layer** the agent roster reads (morning cards, email triage drafts, vendor
  texts sound like HDPM).
- Follows maintenance-os conventions: one wave per session, **plan mode first**.
- Single-org build, but never hardcode HDPM where an `org_id` belongs
  (agent-os Q7: product seam reserved cheaply — org_id/RLS now, rest deferred).

## Keep from Kompass (proven, reuse the pattern)
- Versioned soul artifact with confidence % / gaps / coverage JSONB;
  gap-pill re-interview loop; 3-pass composer (map → compose → score).
- Brain: pgvector per-org memory, write-back on every run, nightly "dream"
  maintenance (dedup / contradiction-flag / salience decay), and the
  **human-in-the-loop clarification queue** (the brain asks when unsure).
- Transcript recorded forever; audio discarded; steering messages never logged.

## Make it better (the four ops deltas — why this is a new design)
1. **Close the loop from day one.** Kompass defers outcome feedback (campaign
   results are slow). Ops outcomes are daily: WO closed, turn finished,
   days-to-ready, vendor performance. `kind='outcome'` memories ship in v1.
2. **Entity-anchored memory.** Not brand-level topics — memories attach to
   units, owners, tenants, vendors (appfolio ids): "owner slow to approve",
   "unit water-heater history", "vendor flakes in fair week". Retrieval by
   entity + situation.
3. **Decision memory.** `agent_proposal` approvals/edits/rejects are supervised
   judgment data, accumulating daily. The brain learns HDPM's taste from real
   decisions, not just interviews.
4. **Compliance rails.** ORS 90 / fair-housing constraints as hard boundaries
   in retrieval and drafting (the existing ORS 90 chat corpus is the seed).

## Interview scope (ops soul ≠ marketing soul)
Judgment and voice for operations: escalation instincts, owner-communication
rules ("owners see one summary line"), tenant tone, vendor philosophy, the
folder-color taxonomy, what "done" means. Craig first; then Cheryl
(maintenance) and Ashley (front desk) passes — transcripts re-mine forever.

## Suggested wave for the first session
Read this folder + `docs/agent-os/00-DRAFT-master-plan.md`, then plan:
(1) schema (`soul_interviews`, `soul_files`, `org_memory` w/ entity anchors +
outcome kind), (2) interviewer agent on the agent-service, (3) composer,
(4) retrieval API consumed by morning-card as the first reader.

## IP note
Konmashi is a separate company (Hangten). Nothing in `konmashi-reference/` is
production code; specs are reference material authored by Craig. The HDPM
implementation is written fresh in this repo. If either company productizes
overlapping capability, paper the boundary (marketing OS vs operations OS)
with counsel before external money or customers touch either side.
