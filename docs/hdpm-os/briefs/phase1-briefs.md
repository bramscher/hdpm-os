# HDPM-OS Phase 1 — Company Brain PoC: Session Briefs

> Created 2026-08-03 on `feature/hdpmos`. Phase 1 objective (roadmap doc 10):
> cited, gap-aware institutional memory on real (C2) content. Design source:
> `docs/hdpm-os/04-gbrain-company-brain.md` (GBrain patterns, native build)
> + the soul-brain evolve/clarify patterns. One brief per session, in order.
>
> Phase acceptance: 10 golden questions answered with correct citations;
> gap analysis correctly reports 3 known-unknowns; Ops Brief cites the brain.

## Brief 1A — Brain core: schema, ingest, seed corpus  ⟵ SHIPPED 2026-08-03 (code-complete)

> **Execution notes:** migration `20260803_brain_core.sql` (6 tables, HNSW +
> GIN, RLS, hybrid `match_brain_chunks` RPC with RRF + sensitivity filter);
> `lib/brain/{types,embed,chunk,ingest,retrieve}.ts`; corrections supersede
> via `ingestCorrection()`; seeder validated in dry-run: **27 files → 225
> chunks** (konmashi-reference excluded). Chunker unit-tested (H1 replaces
> the trail root — found by test). **Live seeding blocked on the migration**
> (probed 2026-08-03: brain tables absent, as are the Brief A/C tables) —
> after the SQL run: `npx tsx scripts/brain/seed-docs.ts`.

1. Migration `20260803_brain_core.sql`: `brain_node`, `brain_chunk`
   (embedding vector(1536) + generated fts, kind/domain/sensitivity/author,
   supersede chain), `brain_edge`, `brain_contradiction`,
   `brain_clarification`, `brain_ingest_log`; HNSW + GIN indexes; RLS per
   convention; hybrid `match_brain_chunks` RPC (vector + fts, RRF,
   superseded rows hidden). **Deviation from doc 04:** tables are
   `brain_`-prefixed in `public`, not a separate Postgres schema —
   PostgREST exposure of extra schemas is a dashboard setting we don't need
   to depend on.
2. `lib/brain/`: `types.ts`, `embed.ts` (text-embedding-3-small, same as
   RAG), `chunk.ts` (markdown heading-aware chunker, tested),
   `ingest.ts` (idempotent by `source_key` + content hash, logs to
   ingest_log), `retrieve.ts` (hybrid search wrapper).
3. Seeder `scripts/brain/seed-docs.ts` (tsx): ingest the repo's own
   decision/knowledge corpus — `docs/hdpm-os/**`, `docs/agent-os/**`,
   `docs/maintenance-os/*.md`, `docs/soul-brain/00-README.md` (skip
   konmashi-reference IP). agent-os Q&A ingests as kind=`fact` (decisions);
   the rest as kind=`summary`. `--dry-run` mode chunks without embedding.
4. Unit tests for chunker + ingest hashing.

Operator step: run the migration, then `npx tsx scripts/brain/seed-docs.ts`.

## Brief 1B — `think()` synthesis + knowledge-chat integration  ⟵ SHIPPED 2026-08-04

> Shipped: `lib/brain/think.ts` (brainSourcesForChat / buildBrainContext /
> BRAIN_PROMPT_ADDENDUM / standalone `think()`); `lib/rag.ts` runs brain search
> in parallel with knowledge search in both askRAG and askRAGStream (document-
> analysis mode skips brain), merges 🧠 sources with continued numbering, and
> the system prompt covers three corpora + the required gaps section. Live
> smoke verified: GBrain question answered from memory alone (6 brain sources,
> knowledge base empty on the topic); think() gap probe returned citations +
> "What I don't know". Incidental fix shipped with this brief: the chat's
> Claude model `claude-sonnet-4-20250514` hit API end-of-life (404) — migrated
> all call sites to `claude-sonnet-5` with `thinking: disabled` (preserves
> pre-migration latency/behavior; Sonnet 5 defaults to adaptive thinking).

`lib/brain/think.ts`: retrieve → Claude synthesis with **per-claim citations
and an explicit gap section** ("what the brain does not know"), honoring
kind/author ranking (corrections > facts > summaries > inferences; agent
output labeled). Wire into the knowledge chat: brain results join the
existing RAG sources with a distinct source icon; answers render gaps.
Notion SOP corpus stays in `knowledge_chunks` (already synced) — the chat
queries both stores; no re-ingestion.

## Brief 1C — Nightly consolidation ("dream cycle")  ⟵ SHIPPED 2026-08-04

> Shipped: `lib/brain/evolve.ts` — one pairwise scan feeds both stages
> (dupes ≥0.95 → supersede lower-ranked; 0.78–0.95 statement-kind cross-doc
> band → one batched Claude call, capped at 15 pairs/night; cleared pairs
> recorded as `dismissed` so the window advances); new contradictions get a
> clarification question (surfaced on /agents); salience decays ×0.98 toward
> 0.5 for chunks unseen 30+ days (corrections never decay); report logged to
> brain_ingest_log (source 'evolve'). Route `/api/brain/cron/evolve`
> (CRON_SECRET, ?dryRun=1) + vercel.json 10:00 UTC + PUBLIC_PREFIXES entry.
> First live run: 225 scanned, 0 dupes, 77 band candidates, 15 checked,
> 1 real contradiction found (autonomy-ladder start levels) + question queued.
> Note: the cron activates when the branch merges to main (Vercel crons run
> from production only). Manual trigger: scripts/brain/run-evolve.ts.

`lib/brain/evolve.ts` (port soul-brain C3 pattern): incremental dedup
(collapse ≥0.95 cosine near-dupes via supersede), bounded LLM contradiction
flagging (same-topic band) → `brain_contradiction`, salience decay,
clarification-question generation → `brain_clarification`; metrics summary.
Cron route `/api/brain/cron/evolve` + vercel.json entry (3am). Clarification
queue surfaces as a simple list in the Agents console.

## Brief 1D — Agent access + Ops Brief citations + eval  ⟵ SHIPPED 2026-08-04

> Shipped: POST /api/brain/search + /api/brain/think (requireStaffOrService —
> service token scope 'agents' + X-Agent-Actor, or staff session; sensitivity
> clamped to 'internal'; /api/brain self-guarded prefix in proxy). Deep-Monday
> Ops Brief now includes a "🧠 From company memory" section — one bounded
> think() call about the escalation patterns present, with citation links
> (best-effort: any failure renders the brief without it; first live render
> next Monday). Golden eval scripts/brain/golden-questions.ts →
> docs/eval/brain-golden.md: **10/10 citation checks, 3/3 gap probes** on the
> live corpus — the Phase 1 acceptance gate PASSES. Route smoke: 401 without
> token/actor, 200 with scoped token (verified with a minted-then-deactivated
> smoke token).

1. `/api/brain/search` + `/api/brain/think` (service-token scope `agents` —
   add scope value `brain` only if separation proves needed). **MCP-proper
   deferred:** agents are in-process today; a real MCP server lands with the
   agent-service (Phase 2+ of agent-os) when an out-of-process consumer
   exists.
2. Ops Brief: deep-Monday brief queries `think()` for context on its
   escalation items and includes citation links.
3. Eval: `scripts/brain/golden-questions.ts` — the 10-question harness with
   expected-citation checks + 3 known-unknown gap probes; results to
   `docs/eval/brain-golden.md`. This is the phase acceptance gate.

## Brief 1E (optional, timeboxed ½ day) — GBrain calibration appliance

Pinned-release GBrain on PGLite with the public-doc corpus only; compare its
`think` output vs ours on the golden questions; record findings; delete.
Skip if 1B quality already satisfies the eval.
