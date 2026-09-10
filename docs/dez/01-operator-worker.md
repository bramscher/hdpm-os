# Dez AppFolio Operator Worker — spec

**Status:** built, not yet deployed/live. Separate, independently on/off-able feature.
**Related:** `docs/agent-os/11-writepath-spike.md` (the write-path option this realizes), `00-dez-spec.md`.

## What & why

Dez needs to perform **web-app-only** AppFolio actions the v0 API cannot do — starting with the
**deposit-to-hold form merge** ("fill a form + merge the tenant record"). The only way to automate
these is to drive the AppFolio web app as a logged-in user. Screenshot-driven control (Claude-in-Chrome)
was used to *map* the flow but is far too slow to *run* it. So the production operator is a fast,
headless **Playwright** replay, run as a **separate Railway service** that Dez calls over a signed
contract. It is deliberately isolated (its own service, its own kill switches) so it can be turned on
or off cleanly, and so AppFolio credentials never touch the Vercel app.

## The mapped flow (deposit-to-hold)

Discovered live 2026-08-31:
`Communication → Forms → Resident Forms → "Send New Resident Form"` (`/forms/documents/new`) →
**Select Unit** (search by resident) → **Choose Templates** "Deposit to Hold" → **Prepare Form**
(the merge) → merged preview → *[Send for signing]*. The worker runs to **Prepare Form** and stops;
send-for-signing is outward-facing (a tenant e-signature request) and is **not enabled**.

## Architecture

```
Slack → Dez (Vercel /api/agents/slack/events)   matchOperatorRequest → gate → createProposal
   └─ signed HMAC → hdpm-dez-operator (Railway, Playwright)  mode:"prepare" → Prepare Form → preview
   └─ Dez posts card [Approve & Send]/[Discard]  · logs dez_activity(kind:verb, scope:operator)
       └─ [Approve & Send] → /api/agents/slack/interact (op:*) → mode:"send"  (worker refuses until enabled)
```

- **Worker** (`services/dez-operator/`, own repo/deploy): `POST /operator/form-merge` (HMAC-signed,
  `OPERATOR_SHARED_SECRET`), logs into AppFolio as `dez@` (password + **passkey** it owns, via a
  Chromium virtual authenticator — AppFolio has no TOTP option), keeps a warm session (`storageState`),
  replays the flow. Stateless re: our DB.
- **Dez side** (`lib/agents/dez/operator.ts`): intent detection, the signed client, and the `op:*` Slack
  action-id + card helpers. The verb lives in the events route; approve/discard in the interact route.

## On/off — layered (any one = off)

1. **Worker:** stop the Railway service or `OPERATOR_ENABLED=false` → 503.
2. **Dez wiring:** unset `DEZ_OPERATOR_URL` (Vercel) → Dez won't call it (verb replies "not configured").
3. **Autonomy spine:** `agent_config('dez_operator','form_merge')` `enabled=false` / level 0, or the
   global kill switch `('*','*')`. Seeded **OFF** (level 0, ceiling 2, enabled false) by migration
   `20260831_dez_operator.sql`; turn on from `/agents`.
4. **Per-action:** `send` is never automatic — only from an explicit `[Approve & Send]` tap, and the
   worker still refuses `send` until it is deliberately implemented + enabled.

## Env

**Vercel (Dez):** `DEZ_OPERATOR_URL` (the Railway URL), `DEZ_OPERATOR_SECRET` (== worker
`OPERATOR_SHARED_SECRET`).
**Railway (worker):** `OPERATOR_SHARED_SECRET`, `OPERATOR_ENABLED`, `APPFOLIO_DEZ_USER/_PASSWORD/
_PASSKEY`, `APPFOLIO_BASE_URL`, `APPFOLIO_STORAGE_STATE` (volume). See `services/dez-operator/.env.example`.
`APPFOLIO_DEZ_PASSKEY` is minted once via `npm run register-passkey` (see below).

## Gates before going live (not code)

- **AppFolio ToS** on an automated operator seat (Sep-4 rep question) — required before running against
  live AppFolio at scale. Until then: **preview only**.
- **`dez@` login** working with its **passkey** (AppFolio offers no TOTP): run `npm run register-passkey`
  once — reset dez@'s login (admin), open the setup link emailed to dez@highdesertpm.com, and the script
  mints a portable passkey into `APPFOLIO_DEZ_PASSKEY`.
- Restart plan Oct-1 gate (write path).

## Deferred / not built

`send` mode (past preview — must be mapped + deliberately enabled); templates beyond deposit-to-hold
(each is a `flows/*` file); embedding the merged-preview image in Slack (Slack file upload — the worker
returns it as base64 today); doc-age freshness; owner-facing forms. The **login-page selectors** in `appfolio-auth.ts` and the
**passkey-registration selectors** in `register-passkey.ts` are a first pass to tune on the first real
run (the merge navigation is accurate).
