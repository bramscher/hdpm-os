# @habu/core

The agent/seat/brief spine extracted from **hdpm-os**, generalized and made
multi-tenant. hdpm-os becomes HABU tenant #1; its vertical tools (Craigslist,
comps, keys, inspections, invoices, owner reports, Haven, reception) stay behind
as HDPM apps.

> **North star — four primitives, nothing else in v1:** Seats · Jackets · Score · Brief.
> If a feature isn't one of these four, it's not habu-core.

Spec: `~/Downloads/habu-extraction-spec.md`. Plan & status: `docs/habu/00-execution-plan.md`.

## Design rules carried in from the spec

- **No hardcoded people.** Staff are DB rows (`staff` table); each org supplies
  its own. No `STAFF_PEOPLE` / `PEOPLE` / `'Cheryl'` literals in runtime code.
- **No tenant imports.** Core reads Supabase from env (`./db`) and never imports
  the tenant app. `grep -rn "@/lib" src` must return nothing.
- **Slack is the chassis, not the identity.** Channel adapters stay swappable.
  Tenant-specific transports (e.g. Zoom SMS) plug in via a registered seam —
  see `sms-transport.ts` / `registerSmsTransport`.

## What's here (PR-A1 — spine + channels)

`actor` · `types` · `audit` · `config` · `proposals` · `outbox` · `channels/*`
(slack, email, in-app, outlook-draft, sms) · `sms-transport` · `metrics-history`
· `graph` · `db`. Public surface is re-exported from `src/index.ts`.

Not yet extracted: seats (`lib/eos`), jacket engine (new), brief engine
(from morning-card), watchers (from tripwire-engine), the generalized interact
endpoint. See the plan doc.

## Commands

From repo root (npm workspace):

```bash
npm run test:habu        # vitest run for @habu/core
npm run typecheck:habu   # tsc --noEmit
```

Or inside `packages/habu-core`: `npm test`, `npm run typecheck`.
