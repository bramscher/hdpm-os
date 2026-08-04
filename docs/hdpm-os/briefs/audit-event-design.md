# `audit_event` — Design Note (Phase 0, Brief D)

> 1-pager per the Phase 0 plan. **Design only — the table ships with the
> first EOS migration (Phase 2)**, so CRM/EOS/brain surfaces are born
> audited rather than retrofitted. Maintenance keeps `wo_event` untouched.

## Why not just use `wo_event` everywhere

`wo_event` is scoped to work orders (`wo_id` FK, WO-shaped event types) and
is load-bearing for tripwires, sync rules, and the Sep-4 write-path query.
Generalizing it in place risks the machinery on top. Instead: a parallel,
subject-agnostic table with the same philosophy (append-only, actor
attribution, payload JSONB), and `wo_event` remains the maintenance-domain
specialization.

## Schema

```sql
CREATE TABLE audit_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  subject_type TEXT NOT NULL,   -- 'deal' | 'workflow_step' | 'issue' | 'todo'
                                -- | 'decision' | 'meeting' | 'brain_chunk'
                                -- | 'work_run' | 'service_token' | 'staff' | ...
  subject_id TEXT NOT NULL,     -- the row's PK, stringified
  event_type TEXT NOT NULL,     -- 'created' | 'stage_changed' | 'approved' | ...
  actor TEXT NOT NULL,          -- human name/email | 'agent:<name>' | 'system:<job>'
  payload JSONB,                -- before/after, rationale, channel refs
  channel_ref TEXT,             -- slack message id / outbox id when relevant
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_event (subject_type, subject_id, at DESC);
CREATE INDEX ON audit_event (actor, at DESC);
-- RLS + service-role policy per migrations/README convention. Append-only:
-- no UPDATE/DELETE path in app code; no update policy.
```

## Rules

1. **Append-only.** Corrections are new events, never edits.
2. **Actor convention identical to `wo_event`** (`lib/agents/actor.ts`):
   humans log as themselves (a tap relayed by a service still logs the
   human), agents as `agent:<name>`, jobs as `system:<job>`.
3. **Write helper, one place:** `lib/audit.ts` → `logAudit(subject_type,
   subject_id, event_type, actor, payload?, channel_ref?)` — mirrors the
   `wo_event` insert helper; all CRM/EOS/brain/work_run mutations call it in
   the same transaction-ish path (best-effort insert, error logged loudly,
   never blocks the user action).
4. **What must audit:** CRM stage/owner/next-action changes; workflow step
   completion/skip (with evidence ref); issue lifecycle; decision
   create/supersede; to-do done/missed; brain corrections + restricted-tier
   reads by agents; work_run approve/dispatch/complete; role changes on
   `staff`; service_token mint/revoke.
5. **What doesn't:** reads by humans, renders, drafts that never left the
   proposal spine (already audited in `agent_proposal`).
6. **Retention:** permanent (doc 08 §4). Volume is modest (single org,
   tens/day); revisit partitioning only if that changes.

## Non-goals

Not a metrics store (that's `metrics_snapshot`), not a message log (that's
`agent_outbox`), not a replacement for `wo_event`. A later view can UNION
`wo_event` into a unified timeline read model if the UI wants one.
