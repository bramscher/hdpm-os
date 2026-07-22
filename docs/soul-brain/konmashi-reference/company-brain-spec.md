# Company Brain — knowledge storage & master context management

*Spec for team review. Grounded in a deep-research pass (29 sources, 25 claims adversarially verified — 12 confirmed, 13 killed) contrasting two reference systems. Where the evidence failed verification, this doc says so explicitly.*

> **Build status:** **C1 + C2 built** (branch `feature/company-brain`, 2026-07-02).
> **C1** — pgvector store `brand_knowledge`, hybrid `match_brand_knowledge` RPC (vector + full-text, RRF), `src/lib/brain/{embed,ingest,retrieve}.ts`, `GET /api/brain/search`, HDPM backfill (`scripts/brain/backfill.mjs`), Precision@K harness (`scripts/eval/brain-precision.mjs`, HDPM mean P@5 0.68). Migrations `20260702120000` + `20260702130000` (apply via SQL editor).
> **C2** — the pipeline now compounds. Read-injection: query planning seeded with prior knowledge (`researcher.ts`), brief grounded in the brain (`compose.ts`), enriched plan draws on brand history (`plan.ts`) — all wired at the route edges via `src/lib/brain/context.ts` so the layer stays removable. Write-back: `src/lib/brain/ingest-run.ts` syncs each produced run's findings/insights/brief/soul into the brain (best-effort in the produce route). A/B grounding eval (`scripts/eval/brain-grounding.mjs`): **grounded beat cold 4/4, 28.8 vs 24.8 / 40**.
> **C3** — the brain self-maintains. Migration `20260702140000`: supersede/merge bookkeeping on `brand_knowledge` (retrieval hides superseded rows), `find_similar_knowledge` RPC, `knowledge_contradictions` + `brand_knowledge_evolution` tables. Engine `src/lib/brain/evolve.ts`: incremental (per-brand watermark) dedup (collapse near-dupes ≥0.95), bounded LLM contradiction flagging (same-topic band), stale-salience decay, metrics. Nightly cron `GET /api/cron/brain-evolve` (registered in `vercel.json`, 3am). Runner/measure `scripts/brain/evolve.mjs` → `docs/eval/brain-evolution.md`.
> **Planned — Performance / creative learning (NOT built yet, owner-flagged 2026-07-02):** the brain should also accumulate **what actually works for this brand over time** — post results, post/format types, hooks & scripts, predicted-vs-actual virality, what converts, what flops. This is a **third kept domain** (`performance`, alongside company + market) and reuses the reserved `kind='outcome'`. It can't be built until posts actually publish and report performance back — i.e. the flywheel's live-results / "grown-up Analyst" phase (see [[konmashi-agentic-flywheel]]). Shape when built: an ingest step writing each post's outcome (format, hook, predicted vs actual, engagement, worked/didn't) → retrieval feeds "what's worked for you" into idea/script generation → content compounds. Also the substrate for the C4 **horizontal** (channel/format) cross-brand tier. Add `'performance'` to the `domain` check constraint at that time.
>
> **Scope rework (2026-07-02, owner-directed):** the brain holds **company + market/marketing knowledge ONLY** (plus `performance` once built). Every item is classified `company` / `market` / `external` at ingest (`src/lib/brain/classify.ts`); **`external` — laws, regulations, statistics, third-party status/rankings — is EXCLUDED** (never stored, never grounds content, so no legal/regulatory claims). Owner-facing **conflict detection + clarification scope to `company` facts** only. Migration `20260702160000` adds `brand_knowledge.domain`. This replaced the earlier "flag every contradiction" behavior that surfaced Oregon-law/stats noise.
> **C3.5** — proactive human-in-the-loop. Migration `20260702150000`: `brand_clarifications` queue. `src/lib/brain/clarify.ts` turns open contradictions + brief gaps + a foundational identity checklist (location/pricing/differentiators/ICP/services, asked only when the brain doesn't already know) into owner questions; answers ingest as top-salience `human_correction` facts (source_table='human_correction') and resolve any linked contradiction. API `/api/brain/clarifications` (+ `/generate`); the Brain page (`/dashboard/developer-admin/brain`) leads with the question queue, contradiction resolver below. Generation also runs nightly inside the evolve pass. C4–C5 below still to build.

## TL;DR

Give every brand a **semantic, accumulating brain** on our Supabase: embed all of a brand's knowledge (soul + cited findings + insights + outcomes), retrieve it by **meaning** (hybrid + graph), so each customer's content **compounds run over run** instead of starting cold. Then — the strategic payoff — share **de-identified patterns across brands within a vertical (industry) and horizontal (channel/format)** to create a TikTok-style network effect: more customers in a lane → a smarter lane → better content for everyone in it. That accumulated context is the **moat and the lock-in** (the same mechanism that makes OpenAI/Anthropic memory sticky).

**One honest caveat up front:** the privacy-tech you'd reach for to do cross-brand learning "safely" (federated learning, differential privacy) **did not survive verification** in our research. So the cross-brand moat rests on *architectural separation + aggregated-pattern sharing*, not on a magic privacy guarantee — and the exact safe mechanism is an open question we resolve before that phase ships.

## Why now

Today a brand's knowledge (`soul_files`, `research_findings`, `insights`) is **cited and relational but only keyword/LLM-judged retrievable**. It doesn't accumulate semantically, doesn't compound across runs, and nothing is shared across brands. The brain fixes all three and turns "relevance" from an LLM judgment call into **cosine-similarity math**.

## Reference systems: OB1 vs gbrain

We evaluated two open implementations as references. **We will not fork either — we design our own native to our stack — but we borrow gbrain's patterns far more than OB1's.**

| | OB1 (`NateBJones-Projects/OB1`) | **gbrain (`garrytan/gbrain`)** |
|---|---|---|
| License | **FSL-1.1-MIT** (source-available; restricts competing commercial use ~2 yrs) | **MIT** (clean) |
| Retrieval | pgvector "thoughts" only | **Hybrid: vector + BM25 + rank fusion + typed-edge knowledge graph + reranker** (reports +31 P@5 over vector-only) |
| Synthesis | returns chunks | **`think` = prose answer + gap analysis** ("what the brain doesn't know") |
| Upkeep | static store + drop-in schema extensions | **cron "dream" enrichment**: dedup, contradiction detection, citation repair, salience |
| Multi-tenant | RLS + MCP gateway | **OAuth-scoped, fuzz-tested no-leak, audit logs** |
| Maturity | early; heavy product surface (dashboards, Slack/Discord capture) we don't need | **production-proven (146k pages, Garry Tan's own agents)** |

**Recommendation:** design our own on Supabase/Next.js; **reuse specific designs** — from **gbrain**: hybrid+graph retrieval, the dream-enrichment cron, gap-analysis synthesis, typed entities; from **OB1**: recency-boosted match, provenance chains, trgm hybrid. gbrain is the north star.

## Architecture (each choice tied to verified research)

**1. Retrieval = hybrid by default; graph where it pays.** Vector (pgvector) + full-text/keyword with rank fusion for *all* retrieval; add a typed-edge graph layer **only** for genuine multi-hop/compositional queries. Graph beats vector-only on multi-hop but carries real build/maintenance cost — so it's a later phase, not the foundation. *(Confirmed 3-0 — Supabase hybrid-search docs; agent-memory survey arXiv 2602.05665.)*

**2. Memory lifecycle = four stages.** Extraction → Storage → Retrieval → **Evolution**. Our findings/insights are already atomic units (free extraction); soul is chunked by markdown section. Dedup and contradiction handling collapse into **one LLM-driven update step** — Mem0's ADD / UPDATE / DELETE / NOOP: hand a candidate fact plus its most-similar existing memories to an LLM that picks the operation, rather than a separate classifier. *(Confirmed 3-0 — Mem0 arXiv 2504.19413; survey 2602.05665. NB: Mem0's headline efficiency numbers were refuted — we adopt the mechanism, not the figures.)*

**3. Per-brand isolation = RLS + an explicit server-side filter.** On Supabase, Row-Level Security automatically applies to pgvector similarity search, so a vector query only returns rows the caller may see — the backbone for any authenticated/client access and defense-in-depth. **Critical catch for us:** our pipeline runs as the **service role, which *bypasses* RLS**, so server-side brain retrieval must scope `brand_id`/`tier` **explicitly** in the query. Also: hybrid match RPCs must **not** be `SECURITY DEFINER` (that bypasses RLS), and ANN indexes (HNSW) with post-scan RLS can reduce recall. *(Confirmed 3-0 — Supabase RAG-with-permissions docs.)*

## The moat: scoping tiers + the honest privacy reality

Tag every knowledge item **brand → vertical → horizontal**, and retrieve across tiers:

| Tier | Contains | Shared with | Example |
|---|---|---|---|
| **Brand** (private) | the customer's own soul, findings, insights, content, outcomes | nobody | HDPM's actual research |
| **Vertical** (industry) | de-identified aggregate *patterns* | brands in that industry | "hooks naming a specific 2am pain convert for PM owners" |
| **Horizontal** (channel/format) | format/channel playbooks | brands using that channel | "a hook in the first 2s lifts reel watch-time" |
| **Global** | fully anonymized cross-lane patterns | all | broad creative principles |

More brands in a lane → a smarter lane → better content for all of them; a churning customer loses accumulated context they can't take with them. **That is the network-effect moat and the switching cost.**

**The honest privacy reality (our biggest research finding).** The mechanisms you'd reach for to learn across tenants without leaking — **federated learning and differential privacy — failed adversarial verification** in our research and are *not* a basis to design on. So cross-brand learning rests on **architectural separation**:
- Brand-private data stays **brand-scoped**, never shared.
- Only **aggregated, de-identified, k-anonymous patterns** (a minimum number of brands must exhibit a pattern before it's promotable; no raw assets or strategy) move up to vertical/horizontal/global tiers, via a deliberate, reviewed promotion step.

The exact safe promotion mechanism (k-anonymity thresholds that preserve usefulness) is an **open question we resolve before the cross-brand tier ships.** And the moat itself is real but **psychological/switching-cost-based**, softened by potential data-portability regulation — we frame it as accumulated context and switching cost, *not* a magic "data network effect" law (the "utility scales super-linearly with memory depth" claim was specifically refuted).

## Data model (new Supabase migration)

- `create extension vector`
- **`brand_knowledge`** (the store): `id, brand_id, team_id, tier (brand|vertical|horizontal|global), vertical_id, horizontal_id, kind (finding|insight|soul_chunk|brief|outcome|pattern), content, embedding vector(1536), fts tsvector, source_table, source_id, source_url, salience, confidence, created_at, last_seen_at`. HNSW index (cosine) on embedding; GIN on fts. RLS for the brand tier; lane tiers readable by lane members; `GRANT … service_role`.
- **`knowledge_patterns`** (promoted aggregates): `id, tier, vertical_id|horizontal_id, statement, support_count, embedding, evidence jsonb (de-identified), created_at` — the k-anonymity-gated promotion target.
- **`knowledge_edges`** (typed graph, later phase): `src_id, dst_id, relation, weight`.
- Retrieval RPCs: `match_brand_knowledge(...)` — hybrid vector+fts with rank fusion, RLS-respecting, **not** `SECURITY DEFINER`, returns rows + provenance; `match_patterns(...)` for lane tiers.

## Scaling to 10k–50k brands

**The workload is embarrassingly partitionable.** Retrieval is almost always scoped to one brand (or one lane), so per-query work stays tiny *regardless of total brand count* — a single search touches one brand's slice, never the whole corpus. That property is what makes this scale.

**Economics (rough, at ~1,000 knowledge chunks/brand at maturity):**
- 50k brands × 1k ≈ **50M vectors** ≈ ~300GB at 1536 dims × 4 bytes (halvable via `halfvec`/quantization) — within pgvector territory (gbrain runs 146k pages per brain on plain Postgres).
- Embedding cost ≈ **~$200 one-time** (~10B tokens × $0.02/M on `text-embedding-3-small`); re-embeds only on change.
- Per-query cost scales with **active usage, not corpus size**, because every search is brand-scoped — the bill tracks active customers, not the size of the corpus.

**The moat scales the *right* way.** The cross-brand pattern tiers are aggregated, so they stay small (thousands of patterns, not 50M rows) while getting richer as brands join a lane. Marginal cost per brand stays low; marginal value to every brand in a lane grows. More customers → smarter lanes → better content for all of them — scale makes the product both cheaper-per-unit *and* harder to leave.

**Two real risks to engineer around:**
1. **Filtered vector search.** "Filter by `brand_id`, then ANN" can lose recall/speed on a single giant shared table. Fix: **partition `brand_knowledge` by tenant** (Postgres declarative partitioning) so each brand's vectors get their own slice + HNSW index. This is the single most important scale decision.
2. **The enrichment cron.** The nightly dedup/contradiction/promotion loop must be **incremental** (touch only new/changed knowledge, never re-scan all) and **queued/sharded** (per-brand jobs in parallel) — otherwise it becomes an O(all-brands) bottleneck. Built on the durable job-table pattern we already use (`mashi_prepare_jobs`).

**Evolution path (don't over-build early):**
- **0–1k brands:** single Supabase Postgres, one shared table + HNSW + `brand_id` filter. Done.
- **1k–50k:** partition by tenant, per-partition indexes, sharded enrichment cron, read replicas for retrieval. *(The design target.)*
- **50k+:** shard tenants across DB instances, or peel hot vector search onto a dedicated store if pgvector ever caps out (many run it past 100M vectors).

**One-line takeaway:** cost scales with *active usage*; the moat scales with *customer count*. The main engineering bet is **tenant partitioning + an incremental enrichment queue** — get those right and tens of thousands of brands is a capacity-and-config problem, not an architecture rewrite.

## Code surface & where it plugs in

New: `src/lib/brain/{embed,ingest,retrieve}.ts` (embeddings via OpenAI `text-embedding-3-small`, 1536-dim; per-vertical tuning later since no single config is universally best — confirmed 3-0), `scripts/brain/backfill.mjs`, and a `src/app/api/cron/brain-evolve` dream cron.

Consumption — the value lands here:
- **Researcher query planning** (`src/lib/research/researcher.ts`) — seed from prior brand knowledge + vertical patterns; stop re-researching what we know. *Highest-value first injection.*
- **Brief composer** (`src/lib/research/compose.ts`) — ground with prior knowledge; gap-analysis vs. what we already have.
- **Planner** (`src/lib/research/plan.ts`) — messaging angles from brand history + the vertical playbook.
- **Relevance becomes math** — cosine similarity replaces LLM-judged finding relevance (the upgrade promised in the eval note).

## Phased roadmap

| Phase | What | Deliverable |
|---|---|---|
| **C1** | Store + hybrid retrieval (brand tier): pgvector, `brand_knowledge`, hybrid match RPC, embed/ingest/retrieve libs, backfill HDPM | Query HDPM's brain by meaning, brand-scoped; retrieval Precision@K measured |
| **C2** | Ground the pipeline: inject retrieval into query-planning + compose; cosine relevance | A 2nd HDPM run **compounds** (reuses/extends prior knowledge); blind-judge harness ≥ current |
| **C3** | Evolution cron (the "dream" loop): Mem0-style dedup/contradiction + salience | Brain self-maintains; contradiction rate + staleness measured |
| **C4** | Cross-brand tiers (the moat): vertical/horizontal pattern promotion, k-anonymity gate | A new PM brand benefits from PM-lane patterns on run 1, **zero raw cross-brand data exposed**. *Gated on resolving the privacy open-question first.* |
| **C5** (opt) | Typed-edge graph (multi-hop), reranker, MCP server (external tools query the brain), per-vertical embedding tuning | — |

## Evaluation (must go beyond Precision@K)

Models that ace *passive* recall benchmarks drop to **40–60% on active agentic memory use** — so retrieval metrics alone overstate utility *(confirmed 3-0 — survey 2603.07670; MemoryArena 2602.16313)*. Layered eval: (a) retrieval P@K / Recall@K on a labeled set; (b) memory quality — contradiction rate, staleness; (c) **downstream lift** — re-run our existing blind-judge harness (`scripts/eval/pain-comparison.mjs`) using brain-retrieved findings; (d) **validate any LLM-judge against human labels before trusting it** (a specific "LLM judge correlates with humans at ρ≈0.89" claim was refuted).

## Risks & open questions

1. **Privacy (highest).** No verified federated-learning/DP path. Cross-brand learning = architectural separation + k-anonymous aggregate promotion only; exact safe thresholds unresolved → dedicated research **before** C4. Do **not** claim FL/DP guarantees to customers.
2. **Service-role bypasses RLS** — server-side retrieval must scope `brand_id`/`tier` explicitly; RLS is defense-in-depth + the client path.
3. ANN + RLS can degrade recall; match RPCs must not be `SECURITY DEFINER`.
4. Moat softened by data-portability regulation and portable external memory stores; frame as switching cost, not a data-network law.
5. Treat as **refuted, do not cite**: Mem0's efficiency numbers, the super-linear memory-depth network effect, the LLM-judge ρ≈0.89 correlation, the DP ε=2 privacy/utility figures.

## Key sources

- Supabase — Hybrid search; RAG with permissions (RLS on pgvector): supabase.com/docs/guides/ai/hybrid-search, /rag-with-permissions
- Agent memory survey (lifecycle, vector vs graph): arXiv 2602.05665
- Mem0 (LLM-driven ADD/UPDATE/DELETE/NOOP): arXiv 2504.19413
- Memory/chunking + eval survey: arXiv 2603.07670 · MemoryArena (active memory gap): arXiv 2602.16313
- RAGalyst (no universal config; per-vertical): arXiv 2511.04502
- "The Memory Wars" (memory as moat/lock-in): arXiv 2508.05867
- Reference implementations: github.com/garrytan/gbrain (MIT) · github.com/NateBJones-Projects/OB1 (FSL)
- *Failed verification (not a basis to build on):* differential-privacy cross-tenant tradeoffs arXiv 2512.10341

---

# The case for the Company Brain — objectives, benefits, moat *(shareable summary)*

*Build a per-brand "Company Brain" into every brand deployed on Konmashi — by us or by our customers — so each brand's marketing gets sharper the longer it runs, and the whole network gets sharper as more brands join.*

## The objective
Turn Konmashi from "AI that generates marketing" into **"a system whose marketing improves with use."** Every brand on the platform gets a semantic memory that accumulates what we learn about it and its market — its identity, its evidence, its insights, what actually worked — and grounds every future piece of content in that growing, brand-specific, cited context instead of a stateless model guess.

## The benefits

**For each brand**
- Content is grounded in the brand's *own* accumulated, cited knowledge — specific and verifiable, not a generic averaged answer.
- Quality **compounds**: run two builds on the same advantage instead of starting cold each time; outputs get more on-brand and higher-performing the longer the brand runs.

**For our customers**
- A **brand asset that grows in value with use** — their context, their playbook, their results, queryable by meaning. Faster onboarding, more consistent output, less re-explaining.
- Their lane's collective wisdom works *for* them: a new property-management brand benefits from what's proven across property-management brands on day one.

**For Konmashi (the business)**
- A defensible core that converts "AI marketing" from a commodity wrapper into a **data-and-time advantage** — value increases with every brand, every run, every result.
- Cheap to run and clean to scale: cost tracks **active usage**, not corpus size, comfortably into the tens of thousands of brands.

## The resulting moat

1. **Accumulated context = switching cost.** A brand's brain — its soul, cited evidence, insights, and history of what worked — can't be exported, can't be rebuilt by a competitor, and can't be carried out by a churning customer. Leaving means losing accumulated strategic memory. (The same lock-in that makes persistent AI memory sticky for OpenAI/Anthropic users — applied to a brand's marketing.)
2. **Network effect within lanes.** Every brand in a vertical (industry) or horizontal (channel/format) makes that lane's **de-identified playbook** richer. More customers → smarter lane → better content for everyone in it → more customers. A single-tenant competitor structurally cannot replicate this.
3. **It compounds where competitors reset.** A naive LLM gives the same averaged answer forever; the Company Brain gets measurably better per brand and per lane with use — so the quality gap *widens* over time.
4. **Built on data we uniquely own.** Brand souls, cited research, and real published-content results are proprietary, growing, and the very substrate the moat is made of.

## The one-line case
**Every brain we deploy makes that brand's content better, makes its lane better for everyone in it, and becomes harder to leave the longer it runs.** Marketing AI is commoditizing fast; the durable advantage is the memory-and-context layer underneath it — and the Company Brain is how Konmashi owns that layer, brand by brand.

*Honest footnote: the per-brand brain stands on its own. The cross-brand network-effect tier (benefit #2 of the moat) depends on settling the privacy-safe pattern-promotion mechanism first — see Risks & open questions. We build it deliberately, not by hand-waving "federated learning."*
