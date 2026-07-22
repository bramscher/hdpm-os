# Inspection tenant-notice dispatch

How the exact-date "entry notice" for routine inspections gets sent. All notices
**must be logged inside AppFolio**, so every channel routes through AppFolio.

The app is the **notice queue + system of record**. It does not send anything
itself — a *sender* drains the queue and reports results back. The contract is
sender-agnostic: the manual bridge is live today, and another sender (e.g. direct
email) can be added without touching the queue.

## The queue

A notice is "due" when its inspection is `status='scheduled'`, has a future
`target_date`, and has not been sent (`notice_sent_at IS NULL`). Per-notice
dispatch state lives on `inspections`:

| column | meaning |
| --- | --- |
| `notice_status` | `pending` \| `queued` \| `sent` \| `failed` \| `skipped_no_email` |
| `notice_channel` | `manual` \| `realmx_mcp` \| `email` |
| `notice_sent_at` | set once delivered (removes it from the queue) |
| `notice_message_id` | sender's audit id (e.g. Realm-X message id) |
| `notice_attempts` | bumped on every dispatch attempt |
| `notice_last_attempt_at` | timestamp of the last attempt |
| `notice_error` | last failure reason (when `failed`) |

A **failed** notice keeps `notice_sent_at` null, so it stays in the queue and is
retried on the next pass.

## The contract (`/api/inspections/notify`)

Auth: `@highdesertpm.com` session **or** `CRON_SECRET` bearer (for headless runs).

- `GET ?dispatchable=1` → due notices **with an email** (machine-sendable):
  `{ count, with_email, missing_email, notices: [{ id, target_date, resident_name,
  email, address, subject, body, status, attempts, channel, error }] }`
- `GET` (no param) → all due notices incl. missing-email (staff view).
- `POST { results: [{ id, status: 'sent'|'failed'|'skipped', channel, message_id?, error? }] }`
  → records outcomes; returns `{ sent, failed, skipped }`.
- `POST { ids: [...] }` → back-compat: marks those sent via `channel='manual'`.

## Sender — manual bridge (live today)

Dashboard → **Send Notices** → copy each date's recipients + message into
**Realm-X Assistant → Send Bulk Email** → **Mark sent**. Records `channel='manual'`.

## Future senders

An automated Realm-X-MCP sender was explored and **dropped (July 2026)** — the
`mcp.appfolio.com` connector was never authorized and no verified "send tenant
message" job exists (community AppFolio MCP servers only wrap the read-only
Reports API). The `realmx_mcp` channel value remains in the schema/contract but
nothing uses it. If a machine sender materializes later (direct email or
otherwise), it only needs the two calls above: `GET ?dispatchable=1`, send, then
`POST { results }` — the queue, tracking, and retry are already in place.
