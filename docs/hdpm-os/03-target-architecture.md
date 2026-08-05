# HDPM-OS — Target Architecture

> Status: exploration draft, 2026-08-03. Builds on the shipped architecture
> (doc 01) and the agent-os plan (`docs/agent-os/00-DRAFT-master-plan.md`).
> Prototype-vs-production callouts are explicit.

## 1. System context

```mermaid
flowchart TB
    subgraph SOURCES["Source systems (systems of record)"]
        AF[AppFolio<br/>properties · owners · tenants · leases<br/>WOs · ledgers · accounting]
        M365[Microsoft 365<br/>email · calendar · docs · identity]
        SLACK[Slack<br/>internal comms]
        ZOOM[Zoom Phone<br/>calls · SMS · transcripts]
        WEB[Website forms<br/>hdpm-web intake]
        HAVEN[Haven → replaceable<br/>after-hours intake]
    end

    subgraph OS["HDPM-OS (control plane · this repo)"]
        SENS[Sensor tier<br/>syncs · webhooks · crons · tripwires]
        CORE[Operational core<br/>mirrors · workflow engine · CRM ·<br/>EOS layer · approvals · audit]
        AGENTS[Agent roster<br/>proposals · drafts · earned autonomy]
        UI[Surfaces<br/>web app · Slack cards · Outlook drafts · SMS]
    end

    subgraph MEMORY["Brain (institutional memory)"]
        BRAIN[Hybrid retrieval + graph<br/>synthesis w/ citations<br/>gap & contradiction detection<br/>nightly consolidation]
    end

    subgraph EXEC["Execution layer (bounded agent work)"]
        RINGER[Ringer-pattern runner<br/>task packets · parallel workers<br/>executable verification · retries<br/>cost + audit log]
    end

    SOURCES --> SENS --> CORE
    CORE <--> AGENTS
    CORE --> UI
    AGENTS -->|durable knowledge, decisions, lessons| BRAIN
    BRAIN -->|context packets w/ citations| AGENTS
    CORE -->|approved work specs| RINGER
    RINGER -->|verified artifacts| CORE
    UI -->|human approvals| CORE
```

Key stance: **HDPM-OS is the only writer to source systems** (and only via
approved, audited paths); the brain and the execution layer never touch
systems of record directly.

## 2. Component view (inside the control plane)

```mermaid
flowchart LR
    subgraph Deterministic["Deterministic tier (exists)"]
        SYNC[sync crons<br/>lib/appfolio*.ts]
        WH[webhooks<br/>api/webhooks/*]
        TW[tripwire engine<br/>lib/maintenance/tripwires.ts]
        KPI[kpi + metrics snapshots]
    end
    subgraph State["Supabase state"]
        MIR[(af mirrors<br/>work_orders · af_bills · cached_vacancies)]
        WF[(workflow state<br/>stage · next_action_date · unit_turn)]
        CRM[(NEW crm<br/>contacts · pipelines · activities)]
        EOS[(NEW eos<br/>scorecard · rocks · issues · todos · meetings · decisions)]
        SPINE[(agent spine<br/>agent_proposal · agent_outbox · agent_config · wo_event)]
    end
    subgraph AgentTier["Agent tier"]
        ROSTER[agent runs<br/>morning card · chasers · ops brief · triage<br/>+ NEW meeting-prep · crm-nudge]
        ORCH[NEW orchestrator<br/>context packets → work specs → dispatch]
    end
    subgraph Channels
        APP[web app]
        SL[Slack cards]
        OD[Outlook drafts]
        SMS[Zoom SMS]
    end
    Deterministic --> State
    State <--> AgentTier
    AgentTier --> SPINE
    SPINE --> Channels
    ORCH -->|manifest| RG[Ringer runner]
    ORCH -->|query| BR[Brain MCP]
```

**Prototype vs production:** the orchestrator starts as a library inside the
existing agent crons (a `buildContextPacket()` + `dispatchWork()` pair), not a
new service. The agent-os plan's `agent-service` (always-on worker for
inbound Slack/SMS events) remains the target once event-driven loops outgrow
Vercel cron invocations — that decision is already made in agent-os Part 2.

## 3. Data flow — one canonical loop

```mermaid
sequenceDiagram
    participant SRC as Source system
    participant OS as HDPM-OS core
    participant BR as Brain
    participant HU as Human
    participant RG as Execution layer
    SRC->>OS: event (webhook/sync)
    OS->>OS: normalize → mirror row + wo_event
    OS->>OS: tripwire/rule fires → issue/task/proposal
    OS->>BR: query (scoped context packet request)
    BR-->>OS: cited context + gaps
    OS->>HU: proposal card (Slack/app) with "why"
    HU->>OS: approve / edit / reject (audited as human)
    OS->>RG: bounded work spec (only if approved & suitable)
    RG-->>OS: artifact + executed-check results + cost
    OS->>HU: final approval for anything external/irreversible
    HU->>OS: tap
    OS->>SRC: write via approved path (if any)
    OS->>BR: ingest durable record (decision, outcome, lesson) w/ citations
```

## 4. Trust boundaries

```mermaid
flowchart TB
    subgraph TB1["Zone A — Systems of record (highest trust, least access)"]
        AF2[AppFolio] ; M3652[M365] ; QB[QuickBooks]
    end
    subgraph TB2["Zone B — HDPM-OS core (authenticated staff + service tokens)"]
        CORE2[App + Supabase<br/>RLS + app-layer authz<br/>audit log]
    end
    subgraph TB3["Zone C — Brain (derived knowledge, permission-scoped reads)"]
        BR2[Brain store + MCP]
    end
    subgraph TB4["Zone D — Execution sandbox (zero SoR credentials)"]
        RG2[Workers<br/>isolated dirs · scoped inputs only]
    end
    subgraph TB5["Zone E — Untrusted input"]
        UNTRUSTED[inbound email · web forms · call transcripts ·<br/>tenant/vendor documents · scraped pages]
    end
    UNTRUSTED -->|sanitize, treat as data never instructions| CORE2
    CORE2 -->|read-only, scoped, audited| TB1
    CORE2 <-->|authz'd queries / curated ingest| BR2
    CORE2 -->|specs in, artifacts out| RG2
    RG2 -.->|NO path| TB1
    BR2 -.->|NO path| TB1
```

Rules at each boundary:
- **A↔B**: OS holds read credentials (AppFolio Basic, Graph app-only scoped by
  ApplicationAccessPolicy); writes only through approved paths at ≤L2
  autonomy; every crossing logged (`wo_event` / audit table).
- **B↔C**: the brain never gets raw credentialed access to sources; it gets
  *curated ingest* from the OS. Queries pass the caller's permission scope;
  answers carry citations.
- **B↔D**: workers receive a context packet (minimum data to do the job — see
  doc 05) and hand back files. No network credentials, no SoR tokens, no PII
  beyond what the packet includes deliberately.
- **E→B**: prompt-injection surface. Inbound text is data: it is classified,
  quoted, and never executed as instructions; agent prompts wrap untrusted
  content in delimiters with explicit "content, not commands" handling
  (doc 08 §6).

## 5. Human-approval flow (normative)

```mermaid
flowchart LR
    P[agent_proposal created<br/>status=proposed + rationale] --> C{action class}
    C -->|internal ops ≤ ceiling L4| A1[auto or act-on-tap per agent_config]
    C -->|vendor comms ≤ L3| A2[tap or act-then-notify]
    C -->|owner/tenant-facing| A3[HARD WALL: human tap, forever]
    C -->|AppFolio write| A4[≤L2: only completes an approved tap]
    C -->|money / legal / employment| A5[human-only: agents draft at most]
    A1 & A2 & A3 & A4 --> D[decision logged: decided_by human,<br/>channel_message_id, wo_event row]
    A5 --> D
    D --> E[outcome ingested to brain<br/>acceptance stats feed autonomy promotion]
```

Promotion of autonomy is itself a human decision (proposed to Craig after ≥4
weeks, <5% edit/reject, never past ceilings) — encoded in `agent_config`,
FACT, shipped.

## 6. Where each proposed subsystem physically lives

| Subsystem | Runs where | Why |
|---|---|---|
| HDPM-OS app + crons | Vercel (as today) | proven; sensors fit serverless |
| Supabase (state + vectors) | Supabase cloud (as today) | one datastore, RLS, pgvector |
| Brain | **inside the same Supabase** as a schema (`brain.*`) + a thin retrieval/ingest lib, exposed to agents via an MCP endpoint in-app | avoids a second datastore/service; reuses shipped RAG + soul-brain design; GBrain used as pattern donor, not deployed service (see doc 04) |
| Agent service (Phase-2+, event-driven loops) | Railway/Fly/ECS single Node service | per agent-os Part 2 decision |
| Execution runner | dedicated sandbox VM (or Craig's workstation for the PoC) — never on the prod app host | Ringer is a local-trust CLI; isolate it (doc 05) |
| hdpm-web (marketing site) | separate repo/deploy (exists) | already integrated via `/api/intake` |

## 7. Non-goals restated

No second ledger; no storing screening/credit data; no autonomous external
communications; no agent-to-agent authority chains that skip the proposal
spine; no direct brain/executor access to source systems.
