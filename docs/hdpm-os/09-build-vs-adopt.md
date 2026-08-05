# HDPM-OS — Build-versus-Adopt Matrix

> Status: exploration draft, 2026-08-03. Verdicts: **Adopt** (use as-is),
> **Integrate** (use as external service), **Fork lightly**, **Borrow
> concepts**, **Build internally**, **Defer**. Maintenance burden weighted
> heavily: this is a ~1-developer-cadence codebase; every adopted dependency
> is an operational liability, and heavily-modified third-party code is the
> worst of both worlds.

| Area | Verdict | Rationale (evidence in cited docs) |
|---|---|---|
| **GBrain** | **Borrow concepts** (+ optional throwaway PoC appliance on non-sensitive data) | MIT, architecturally excellent, but 4-months old, churning, self-attested multi-user security weeks old; stack impedance (Bun/markdown-git/MCP-only) vs a Supabase that already runs hybrid RAG in prod. Copy: hybrid+RRF+graph, think-with-gap-analysis, dream cycle, schema packs. (doc 04) |
| **Ringer** | **Borrow concepts**; **Adopt as fenced dev workbench only** | Pattern (manifests, executed checks, model tiers, cost audit) is exactly right; the tool is 1-month-old, single-user, shell-execution-by-manifest, macOS-only sandbox, PolyForm Shield (blocks the agent-product path). Internal runner implements the contract. (doc 05) |
| **FounderOS-DEMO** | **Borrow concepts** (UI reference only) | MIT but 3 days old, AI-generated, seeded-SQLite demo, self-described "larp-first." Study: AgentActivityFeed + AgentCostAnalysis, CommandPalette/Conductor (chat-drives-dashboard — matches our canvas), org chart, honest-connector-status. Zero code dependency. |
| **Founder Chief of Staff** | **Borrow concepts** | MIT, zero traction, methodology not product — but its automation contracts (allowed inputs/writes/stop conditions/verification), state registry (authoritative vs mirrored vs approval-required), contradiction-as-blocker, and human-gate tiers are directly portable into our workflow/agent specs. No code to adopt. |
| **EOS workflow** | **Build internally** (concepts from Traction, not trademark-cloned) | Thin CRUD + one meeting screen over existing snapshots/tripwires/Slack spine; no OSS EOS tool earns its integration cost. (doc 06) |
| **CRM** | **Build internally** | Core product surface, deeply coupled to AF mirror/Haven/Graph/Zoom + proposal spine; generic CRMs (Twenty, Attio…) would demand heavier integration than the ~5-table build. (doc 07) |
| **Task engine** | **Build internally** (exists in embryo) | morning cards + `next_action_date` + workflow_step = the task system; a separate task product would fragment the "one daily card" principle. |
| **Workflow engine** | **Build internally** | Generalization of the shipped maintenance state machine; template-as-data. Temporal/n8n class tools are overkill for ~13 templates and would split state. (doc 07 §5) |
| **Search** | **Adopt (existing)** + extend | Shipped hybrid RAG (`lib/rag.ts`) is the base; extend with brain schema + rank fusion + source tiers per GBrain patterns. |
| **Knowledge graph** | **Defer** (light `brain.edge` table only) | Both GBrain's benchmark caveats and the soul-brain research say graph pays only for multi-hop; deterministic edges from mirrors are nearly free — full graph querying waits for demand. |
| **Authentication** | **Adopt** (Auth.js v5 + Entra ID) — migration | Stay on the M365 identity SoR; upgrade off maintenance-mode next-auth v4; add DB roles. (doc 08 §2) |
| **Permissions** | **Build internally** (roles + RLS-on-new) | Small surface, must match our data classes exactly. (doc 08) |
| **Agent orchestration** | **Build internally** (exists) + Claude Agent SDK for the event-driven service | The `agent_proposal`/`agent_outbox`/`agent_config` spine is shipped and proven; agent-service per agent-os Part 2 when event loops demand it. No LangChain-class framework. |
| **Approval system** | **Build internally** (exists) | Proposal spine + ceilings + decide endpoint are live; extend classes per doc 08 §4. |
| **Dashboards** | **Build internally** (exists) + FounderOS visual references | KPI/canvas dashboards shipped; add agent-run cost/activity panels. |
| **Audit logging** | **Build internally** (exists) — generalize | `wo_event` pattern → `audit_event` across CRM/EOS/brain/runs. |

## Cross-cutting risks of the alternative paths

- **Deep-forking GBrain or Ringer:** both are pre-1.0 velocity codebases;
  a fork diverges within weeks and inherits their security posture while
  losing their fixes. Highest-regret option; rejected everywhere above.
- **Adopting a big workflow/CRM platform:** splits state across systems,
  breaks the single audit trail and the one-daily-card UX, and adds vendor
  surface for C3 data.
- **Building a brain service separate from Supabase:** second datastore to
  secure/back up; rejected in favor of `brain.*` schema in-place (doc 04 §3).
