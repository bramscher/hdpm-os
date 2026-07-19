# Agent-OS conventions (Brief B)

Shipped 2026-07-19: `agent_proposal` / `agent_outbox` / `agent_config` / `staff`
tables (migrations `20260719_*`), `lib/agents/`, `lib/webhook-verify.ts`,
`/api/agents/*` routes. This doc is the contract Briefs C+ code against.

## Actor convention

- **Agents** write `wo_event.actor` (and any audit field) as `agent:<name>` —
  lowercase `[a-z0-9_-]`, e.g. `agent:intake_triage`. Helpers:
  `agentActor / isAgentActor / parseAgentActor` in `lib/agents/actor.ts`.
- **Humans** resolve through the `staff` table (Slack tap → `slack_user_id`,
  SMS reply → `phone`, service relay → person/email) to `name || email` — the
  same semantics `requireStaffSession().actor` has always had.
- **Decisions are human-only.** `agent_proposal.decided_by` never holds an
  `agent:*` actor; the decide route returns 403 for agent actors. Agents never
  approve their own proposals.
- Existing `system:*` actors (sync, tripwires) are unchanged.

## Autonomy levels + ceilings

L0 observe → L1 draft → L2 act-on-tap → L3 act-then-notify → L4 silent.

- One `agent_config` row per (agent, action_type); changing autonomy is a row
  update, not a deploy.
- `ceiling_level` encodes the Q2 decisions (owner/tenant-facing hard wall at
  L2, vendor comms max L3, internal ops max L4). A DB CHECK enforces
  `autonomy_level <= ceiling_level`; `maxPromotableLevel()` in
  `lib/agents/config.ts` is the only promotion-computation point and never
  exceeds the ceiling.
- Missing or disabled config row → `effectiveLevel` = L0: an agent with no
  row can observe but not act. Add the row deliberately.
- Everything starts L1/L2 except the two sanctioned seeds:
  `ops_brief/send_brief` (L3) and `intake_haven/emergency_page` (L3).

## Kill switch

The row `(agent='*', action_type='*')`: set `enabled=false` to halt all
agents. `isGloballyKilled()` is checked at the top of `dispatchOutbox` and
must be checked by every future agent runner before acting.

## action_type strings are the contract

The seeds in `20260719_agent_config.sql` (`daily_card`, `triage_wo`,
`vendor_chase`, `owner_approval`, `sms_day_close`, `propose_match`,
`tenant_notice`, `route_email`, `send_brief`, `emergency_page`) are the names
Briefs C+ must use in proposals and config lookups. Renames are cheap (row
update + code constant) but must happen in both places.

## Adding a channel adapter

1. Implement `ChannelAdapter` (`lib/agents/channels/index.ts`): map an
   `OutboxMessage` onto the provider call, return
   `{status: 'sent'|'failed'|'skipped', message_id?, error?}`.
2. Register it in the `REGISTRY` map, replacing the `notConfiguredAdapter`
   stub for that channel.
3. Retry semantics come free from `dispatchOutbox`: `failed` retries until
   `MAX_SEND_ATTEMPTS` then parks; `skipped` is terminal ("this message
   cannot ever send" — no address, opt-out); throwing is treated as failed.
4. Inbound events for that channel verify signatures via
   `lib/webhook-verify.ts` (`verifySlackSignature`, `verifyZoomWebhook` +
   `zoomUrlValidationResponse` are ready; read the RAW body before parsing).

## Auth for /api/agents

`requireStaffOrService` (lib/maintenance/api-auth.ts): staff session, or
`Authorization: Bearer HDPM_SERVICE_TOKEN` + `X-Agent-Actor` header
(`agent:<name>` or a staff person/email). `/api/agents` is exempt from the
session middleware, so **this guard must be the first statement of every
handler under `app/api/agents/`** — that's the entire defense.

## staff vs maint_digest_recipient

`staff` is the identity source (all 11 people, contact fields filled in by
Craig). `maint_digest_recipient` still drives digest opt-ins and is
deliberately untouched; folding it into `staff` is a future chore — don't
read digest recipients from `staff` until that happens.

## Deliberate non-decisions (Briefs C+ own these)

- `decide(approved)` does NOT auto-enqueue an outbox message — the
  "approved → act" wiring belongs to each agent's brief.
- No outbox cron in `vercel.json` yet (no producers). Add it when the first
  agent ships.
- Dispatch assumes a single caller; add `FOR UPDATE SKIP LOCKED` if a cron
  and manual dispatch can ever overlap.
