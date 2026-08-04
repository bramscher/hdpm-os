# HDPM-OS — Company Brain: GBrain Evaluation & Integration Plan

> Status: exploration draft, 2026-08-03. Primary-source research fetched
> 2026-08-03 from github.com/garrytan/gbrain (repo root, raw README, LICENSE,
> commits, releases, issues, src tree, GitHub API). Cross-checked against the
> prior internal evaluation in `docs/soul-brain/konmashi-reference/
> company-brain-spec.md` (2026-07-02, 29-source adversarial research pass).

## 1. What GBrain actually is (FACTS, fetched)

- **Repo:** https://github.com/garrytan/gbrain — "Garry's Opinionated
  OpenClaw/Hermes Agent Brain." **License: MIT** (© 2026 Garry Tan).
- **Maturity:** created 2026-04-05; latest commit the day of research
  (2026-08-03); ~27.7k stars / 4.0k forks; 150 contributors; latest release
  v0.42.72.1; ~277 open issues (numbering past #3783 in 4 months); two recent
  "community fix wave" releases (40 bug fixes, incl. documented flags that
  were silently ignored).
- **Stack:** TypeScript on **Bun**; markdown files in a git "brain repo" as
  the system of record, synced into either **PGLite** (personal, ~50k-page
  cap) or **PostgreSQL/pgvector — Supabase explicitly supported**.
- **Retrieval:** hybrid pgvector HNSW + BM25 + reciprocal-rank fusion +
  source-tier boost + optional ZeroEntropy reranker; typed-edge knowledge
  graph auto-extracted from `[[wikilinks]]` with zero LLM calls; multi-hop
  `graph-query`. Self-reported benchmark: +31.4 P@5 over vector-only (on a
  240-page synthetic, self-evaluated corpus — treat as directional).
- **Synthesis:** `gbrain think` returns a prose answer with per-claim
  citations plus explicit **gap analysis** (unknowns, staleness, uncited
  claims, contradictions).
- **Maintenance ("dream cycle"):** cron-driven 24/7 enrichment — dedup,
  citation repair, salience scoring, contradiction detection, next-day prep;
  Postgres-native job queue.
- **Access:** CLI + **MCP only** (local stdio and remote HTTP with OAuth/DCR,
  read/write/admin scopes, rate limiting). **No REST API by design** (one
  bearer-token `/ingest` webhook for capture).
- **Multi-user:** "Company Brain" per-login read scoping shipped v0.41;
  per-person **write** isolation only days old (v0.42.72.0); security is
  self-attested fuzz testing, no third-party audit.
- **Operational reality checks:** open issue filed the day of research
  alleging hybrid search returns identical results regardless of query on
  some configs; Bun-only runtime; install path rides master unless pinned;
  no first-party hosting.

## 2. Recommendation: **borrow the architecture, run the store natively — do not deploy or fork GBrain as HDPM's brain service** (with a bounded exception)

This confirms the July soul-brain conclusion ("gbrain is the north star; we
will not fork; we design our own native to our stack") with fresh evidence.

Why not adopt as the company brain service:
1. **Trust-boundary math.** The brain will hold HDPM's most sensitive derived
   knowledge. GBrain's multi-user permission story is weeks old, self-tested,
   and churning (277 open issues, core-retrieval bug reports). Betting
   tenant/owner/employee-adjacent knowledge on that boundary today is unsafe.
2. **Stack impedance.** Bun runtime + markdown-git-repo-as-SoR + CLI/MCP-only
   surface is a second platform to operate, back up, and secure — alongside a
   Supabase that *already runs* pgvector hybrid retrieval in production
   (`lib/rag.ts`: vector + fulltext + phrase + substring RPCs, cited answers)
   and a designed-and-partially-proven brain spec (soul-brain C1–C3.5
   patterns: ingest, hybrid match RPC, evolve cron with dedup/contradiction/
   salience, clarification queue — built and evaluated in the Konmashi
   reference implementation, P@5 0.68, grounded-beats-cold 4/4).
3. **Fork risk.** 4-month-old, high-churn codebase; heavy modification would
   orphan us from upstream within weeks. MIT permits copying *patterns*
   freely — that is the durable value.

**Bounded exception (worth doing):** run a **stock, pinned GBrain instance as
a disposable PoC appliance** during Phase 1 — PGLite, non-sensitive corpus
only (public SOPs, published policies, this docs folder) — to calibrate our
native build against its `think` quality, graph payoff, and dream-cycle
output. Zero fork, zero sensitive data, delete when done.

What we copy into the native brain (the GBrain pattern list):
hybrid + RRF + source-tier boost; typed-edge graph from `[[entity]]` links
(zero-LLM extraction); `think` = answer + citations + **gap analysis**;
nightly consolidation (dedup, contradiction flag, staleness/salience,
citation repair); schema-pack idea (typed entities as config); MCP as the
agent access protocol.

## 3. Native brain design (HDPM schema pack)

Deployment: **same Supabase project, separate `brain` schema**; retrieval and
ingest as lib modules (`lib/brain/*`), following the soul-brain spec's
service-role caveat — server-side queries must scope explicitly because the
service role bypasses RLS; RPCs never `SECURITY DEFINER`.

### Tables

```
brain.node        (id, org_id, entity_type, slug, title, summary_md, source_system,
                   source_ref, sensitivity: public|internal|restricted, created_at, updated_at)
brain.chunk       (id, org_id, node_id?, kind: fact|summary|inference|agent_output|human_correction,
                   domain: ops|company|market, content, embedding vector, fts tsvector,
                   salience, confidence, sensitivity, source_table, source_id, source_url,
                   author: human|agent:<name>|system, superseded_by?, created_at, last_seen_at)
brain.edge        (src_node_id, dst_node_id, relation, weight, evidence_chunk_id?, created_at)
brain.contradiction (id, chunk_a, chunk_b, status: open|resolved, resolution_chunk_id?, created_at)
brain.clarification (id, question, context_ref, status, answered_by, answer_chunk_id)  -- human-in-loop queue
brain.ingest_log  (id, source, ref, action: add|update|skip|redact, reason, at)
```

### Entity types (HDPM pack)

`employee, owner, prospect, tenant, applicant, vendor, property, unit, lease,
work_order, inspection, incident, communication, meeting, issue, decision,
commitment, rock, metric, process, policy, project`

Most entities are **stub nodes pointing at the SoR** (a `property` node holds
a summary + `source_ref` to the AppFolio mirror row) — the brain never
re-stores transactional fields.

### Relations

`owns, manages, assigned_to, tenant_at, applicant_for, vendor_for, works_on,
responsible_for, discussed_in, decided_in, governed_by, violates, blocked_by,
depends_on, committed_by, measured_by, supersedes, related_to`

Extraction: deterministic first (mirror joins already give owns/tenant_at/
vendor_for/assigned_to for free); `[[wikilink]]`-style links in meeting
minutes/decisions/SOPs second; LLM extraction last and always marked
`kind=inference`.

## 4. Ingestion strategy (anti-noise by design)

**Curated, event-driven, allowlisted — never "index the firehose."**

| Source | What ingests | What never ingests |
|---|---|---|
| HDPM-OS rows | decisions, meeting minutes, solved issues w/ outcomes, closed-WO lessons (only when flagged notable), process versions, won/lost pipeline summaries | raw operational rows (they're queryable in the OS) |
| Notion SOPs | full corpus (already synced weekly) | — |
| Slack | messages a human marks (emoji/shortcut "📌 capture") + agent-detected decision/commitment candidates that a human confirms | everything else |
| Email (Graph) | threads explicitly filed by staff or attached to a CRM/workflow record | inbox-wide indexing |
| Zoom | call summaries linked to a CRM/WO record | raw transcripts by default |
| Agent outputs | accepted proposals' rationale + outcome (decision memory) | rejected/raw drafts |

Every chunk records `author` and `kind` — **fact vs summary vs inference vs
agent_output vs human_correction** — and retrieval ranks corrections > facts >
summaries > inferences, displaying kind in citations.

**Corrections propagate** via supersede chains (soul-brain C3 pattern): a
correction inserts a `human_correction` chunk, marks the old chunk
`superseded_by`, and resolves any linked contradiction; retrieval hides
superseded rows. Source updates (SOP re-sync, decision superseded) re-embed
and re-link, logged in `ingest_log`.

## 5. Access, auth, and citations

- **Humans:** brain answers surface inside the existing knowledge chat (same
  `lib/rag.ts` UX), filtered by the caller's role → allowed `sensitivity`
  tiers.
- **Agents:** an in-app **MCP endpoint** (`/api/mcp/brain`, bearer service
  token per agent identity) exposing `search`, `think`, `entity`,
  `ingest_proposal` (writes land as proposals, not direct chunks, for
  restricted tiers). Local-vs-remote: remote (HTTPS) only; no separate local
  daemon to operate.
- **Citations:** every synthesized claim carries `source_url`/`source_ref`
  back to the SoR row, Notion page, meeting, or decision id — the shipped
  RAG source-card UX extends naturally.
- **Retention & exclusions:** hard excludes (never stored): screening/credit
  data, SSNs/DOBs/bank details, ledger lines, legal-privileged content,
  employee HR records, door/lock codes (those stay in the keys module with
  its own access rules). Sensitivity `restricted` for owner-financial
  summaries and employee-adjacent process notes. Retention: derived chunks
  keep salience decay (soul-brain evolve pattern); source-linked chunks live
  as long as their source; correction/decision chunks are permanent.

## 6. Open items → doc 12

PoC acceptance metrics (P@5 target vs the shipped 0.68 baseline), whether the
graph layer ships in Phase 1 or waits for multi-hop demand (soul-brain
research says defer), embedding model choice, and whether the GBrain
calibration appliance is worth the setup time vs. going straight native.
