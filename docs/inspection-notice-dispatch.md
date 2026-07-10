# Inspection tenant-notice dispatch

How the exact-date "entry notice" for routine inspections gets sent. All notices
**must be logged inside AppFolio**, so every channel routes through AppFolio.

The app is the **notice queue + system of record**. It does not send anything
itself — a *sender* drains the queue and reports results back. Two senders share
one contract; a third (direct email) could be added the same way.

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

## Sender 1 — manual bridge (live today)

Dashboard → **Send Notices** → copy each date's recipients + message into
**Realm-X Assistant → Send Bulk Email** → **Mark sent**. Records `channel='manual'`.

## Sender 2 — Realm-X MCP routine (activate when the connector is authenticated)

The AppFolio Realm-X MCP is reached from a Claude session, not from the app, so a
**scheduled Claude routine** drains the queue. Everything below is built; the only
blocker is the connector's OAuth + a verified "send tenant message" job.

To activate (once Realm-X MCP is connected and can send):

1. Confirm `CRON_SECRET` is set in the app env (already used by the WO sync).
2. Create the routine with the `/schedule` skill (suggested: daily 07:30), prompt:

```
You send High Desert PM's due inspection notices through the AppFolio Realm-X MCP.
Every notice must be logged in AppFolio — only send via Realm-X, never external email.

1. Ensure the AppFolio Realm-X MCP is authenticated (authenticate if needed).
2. GET {APP_URL}/api/inspections/notify?dispatchable=1 with header
   `Authorization: Bearer {CRON_SECRET}`. Each notice has id, email, subject, body.
3. For each notice, send an email to `email` with `subject` + `body` via the
   Realm-X "Send Bulk Email" / send-message job so it logs on the tenant record.
   Group by target_date where the job supports multiple recipients.
4. POST {APP_URL}/api/inspections/notify (same bearer) with:
   { "results": [ { "id": "<id>", "status": "sent", "channel": "realmx_mcp",
     "message_id": "<realmx id or ''>" }, ... ] }
   For any that failed, report { "id", "status": "failed", "channel": "realmx_mcp",
   "error": "<reason>" } so they retry next run.
5. Report a one-line summary: sent / failed / skipped.

Never invent recipients or send to anyone not returned by the API. If the Realm-X
MCP is unavailable, do nothing and report that it's not connected.
```

3. Watch the first run; confirm messages appear on tenant pages in AppFolio and
   the dashboard's due count drops. Then let it run daily.

Until then the manual bridge covers sending; nothing else needs to change to flip
the channel — the queue, tracking, retry, and API are already in place.
