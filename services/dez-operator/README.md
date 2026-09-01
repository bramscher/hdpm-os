# hdpm-dez-operator

The Dez **AppFolio operator worker** — a small, headless Playwright service that performs
**web-app-only** AppFolio actions the v0 API can't do (starting with the **deposit-to-hold form
merge**). Deployed **separately to Railway**; called by the HDPM-OS Dez agent over a signed contract.
**Not** part of the Vercel/Next app (`services/` is in `.vercelignore`).

Full design: [`../../docs/dez/01-operator-worker.md`](../../docs/dez/01-operator-worker.md).

## Why a separate service
Vercel is serverless and can't hold a persistent authenticated browser session. This worker keeps a
warm AppFolio session (logged in as `dez@`) and replays the mapped merge flow with DOM selectors —
fast, unlike screenshot-driven control.

## Auth (passkey, not TOTP)
AppFolio's 2FA offers only SMS or **passkeys** — there is no authenticator-app (TOTP) option — so the
worker's second factor is a **passkey it owns**. A Chromium *virtual authenticator* (CDP `WebAuthn`
domain) carries the stored credential (`APPFOLIO_DEZ_PASSKEY`) and satisfies the login challenge with no
human and no phone. Register it **once**:

```
# 1. AppFolio (admin): "Reset Login" on dez@ → emails a setup link to dez@highdesertpm.com
# 2. Open that email, copy the setup link, then:
SETUP_URL="https://…setup link…" NEW_PASSWORD="…" npm run register-passkey
# 3. Paste the printed APPFOLIO_DEZ_PASSKEY into the worker env (with USER + PASSWORD).
```

See [`src/register-passkey.ts`](src/register-passkey.ts) and [`src/passkey.ts`](src/passkey.ts).

## Contract
`POST /operator/form-merge` — HMAC-signed (`x-dez-timestamp`, `x-dez-signature: v1=…`, 300s replay
window; secret `OPERATOR_SHARED_SECRET`). Body:
```json
{ "template": "deposit-to-hold", "tenantQuery": "Bryce Bramscher", "mode": "prepare", "requestId": "…" }
```
- `mode: "prepare"` → runs to **Prepare Form** and returns `{ status: "prepared", previewImageBase64, steps }`. **Nothing is sent.**
- `mode: "send"` → intentionally **not enabled** (returns an error). Send-for-signing is outward-facing and gated; it must be mapped + turned on deliberately.

`GET /healthz` → `{ ok, enabled }`.

## Kill switches (any one = off)
1. `OPERATOR_ENABLED=false` (or stop the Railway service) → 503.
2. Dez side: unset `DEZ_OPERATOR_URL` → Dez won't call it.
3. Dez side: `agent_config('dez_operator','form_merge')` disabled / global kill switch.
4. `send` always requires an explicit human approval tap in Slack (never automatic).

## Run locally
```
cp .env.example .env   # fill secrets
npm install            # installs Chromium via postinstall
npm run register-passkey  # ONE-TIME: mint dez@'s passkey → APPFOLIO_DEZ_PASSKEY (see Auth above)
npm run dev
```
Requires `dez@`'s **passkey** in `APPFOLIO_DEZ_PASSKEY` (from `npm run register-passkey`).

## Deploy (Railway)
Dockerfile-based (`railway.json`). Mount a volume at `/data` for `storageState.json` so the session
survives restarts. Set all env from `.env.example`. Point Dez's `DEZ_OPERATOR_URL` at this service and
share `OPERATOR_SHARED_SECRET` with the Vercel app's `DEZ_OPERATOR_SECRET`.

> ⚠️ Running against live AppFolio at scale waits on the AppFolio ToS answer (automated-seat question)
> and the restart plan's Oct-1 gate. Until then it stays at **preview only**.

## Note on selectors
The navigation URLs and the merge flow were mapped during discovery and are accurate. The **login-page**
and **passkey-registration** selectors (`appfolio-auth.ts`, `register-passkey.ts`) are a first pass —
tune them against the real pages on the first run. Run `register-passkey` headed (default) to watch it.
