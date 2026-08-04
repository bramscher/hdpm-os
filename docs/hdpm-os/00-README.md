# HDPM-OS Exploration — Index

Architectural exploration (2026-08-03, branch `feature/hdpmos`) of evolving
this repository into HDPM-OS, the company operating system. No production
changes were made; documents only. Research grounding: live fetches of the
four external repos (GBrain, Ringer, FounderOS-DEMO, founder-chief-of-staff)
plus a full code scan of this repo at `e240d67`.

Reading order:

| Doc | Contents |
|---|---|
| [01](01-current-repository-assessment.md) | What exists today, with file citations; keep/replace verdicts |
| [02](02-product-vision-and-boundaries.md) | Vision; system-of-record map; actor boundaries |
| [03](03-target-architecture.md) | Context/component/data-flow/trust-boundary/approval diagrams |
| [04](04-gbrain-company-brain.md) | GBrain evaluation; native brain design + HDPM schema pack |
| [05](05-ringer-agent-execution.md) | Ringer evaluation; execution contract + fenced-workbench plan |
| [06](06-eos-operating-layer.md) | Scorecard, Rocks, Issues, To-Dos, meetings, decisions, org chart |
| [07](07-crm-and-workflows.md) | CRM pipelines (owner + leasing) and the workflow engine |
| [08](08-security-and-permissions.md) | Data classes, roles, approvals, injection defense, hardening list |
| [09](09-build-vs-adopt.md) | Verdict matrix for every major area |
| [10](10-implementation-roadmap.md) | Phases 0–7 with gates and "not built yet" lists |
| [11](11-executive-recommendation.md) | Owner-readable summary + go/modify/reject calls + 30-day PoC |
| [12](12-open-questions.md) | Open items by resolution path (code / business / vendor / legal) |

Related prior work this exploration builds on (not superseded):
`docs/agent-os/` (agent roster, autonomy ceilings, rollout — decisions
stand), `docs/soul-brain/` (brain patterns; doc 04 reconciles with GBrain),
`docs/maintenance-os/` (conventions: one brief per session, plan mode first).
