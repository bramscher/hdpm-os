# Hybrid Write Layer — one interface, two pipes (API + RPA)

**Date:** 2026-08-24 · **Status:** design spec, not built · Companion to `11-writepath-spike.md`

> Dez's brain should never know *how* a write reaches AppFolio — only *what* it
> wants to happen. This layer sits between intent and AppFolio and routes each
> write to the best available transport: the **API** where it exists (fast,
> stable), **RPA** (server Playwright) for the web-app-only gaps. Swap pipes per
> action without changing a line of Dez.

---

## 1. Principles

1. **Action-declarative, not transport-imperative.** Dez asks for `wo.add_note`;
   the layer decides API-vs-RPA from a registry. Adding Write-API access later is
   a registry flip, not a Dez rewrite.
2. **Autonomy gates every write.** The layer consults `agent_config` (the same
   ladder the Dez selector edits) *before* executing. A write above an action's
   `ceiling_level` is refused; L2 needs a human approval token, L3+ can run
   unattended.
3. **Verify or it didn't happen.** Every write is read back and confirmed before
   it's reported as success. Unverified = failed.
4. **Everything is motion.** Each write lands in `wo_event` / `audit_event` with
   actor `agent:dez` + which transport ran it — the restart-plan metric.
5. **Idempotent.** A retry (or an API→RPA fallback) must never double-write.

## 2. Shape

```
Dez brain ──WriteRequest──▶ WriteRouter
                              │  1. autonomy gate (agent_config)
                              │  2. pick transport (registry + health)
                              │  3. execute
                              │  4. verify (read-back)
                              │  5. audit (wo_event)
                              ▼
                 ┌────────────┴─────────────┐
        ApiWriteTransport            RpaWriteTransport
        (v0 / Write API / Realm-X)   (HTTPS + separate key ─▶ htToolKit on
                 │                     Railway: FastAPI + Playwright + Chromium)
                 └──────────▶ AppFolio ◀──────┘
```

## 3. Core interfaces (sketch — `lib/agents/write/`)

```ts
// The vocabulary of things Dez can do. Namespaced by entity.
export type WriteActionType =
  | 'wo.add_note'
  | 'wo.set_vendor_instructions'
  | 'wo.set_followup_date'
  | 'wo.set_status'          // scheduled / waiting / done / completed
  | 'inspection.set_custom_date'
  | 'listing.update';        // …grows as the registry grows

export interface WriteRequest {
  action: WriteActionType;
  subjectType: 'work_order' | 'inspection' | 'listing';
  subjectId: string;               // AppFolio id / our internal id
  params: Record<string, unknown>; // e.g. { text } | { date } | { status }
  actor: string;                   // 'agent:dez' or 'human:<email>' (approver)
  agent: string;                   // agent_config.agent (autonomy binding)
  actionKey: string;               // agent_config.action_type
  approvalToken?: string;          // required at L2 — the Slack-tap / proposal id
  idempotencyKey: string;          // dedupe across retries + fallbacks
}

export interface WriteResult {
  ok: boolean;
  transport: 'api' | 'rpa';
  verified: boolean;
  detail?: string;                 // for audit / the Slack reply
  error?: string;
  externalRef?: string;            // AppFolio note id / audit-log ref
}

export interface WriteTransport {
  readonly kind: 'api' | 'rpa';
  /** Which actions this pipe can currently perform. */
  capabilities(): Set<WriteActionType>;
  /** Cheap health probe (Write-API creds present / RPA worker session alive). */
  healthy(): Promise<boolean>;
  execute(req: WriteRequest): Promise<WriteResult>;
  /** Read-back the intended state → confirms the write landed. */
  verify(req: WriteRequest): Promise<boolean>;
}
```

## 4. The action registry — where "API if available, else RPA" lives

```ts
type Pipe = 'api' | 'rpa';

interface ActionSpec {
  prefer: Pipe[];                  // order to try, e.g. ['api','rpa'] or ['rpa']
  fallback: boolean;              // may drop to the next pipe on failure?
  ceilingHint: 0|1|2|3|4;         // sanity check vs agent_config ceiling
  verifiable: boolean;            // must be true to ship
}

export const ACTION_REGISTRY: Record<WriteActionType, ActionSpec> = {
  // API-first once the Write API/Realm-X opens these; RPA today.
  'wo.set_status':            { prefer: ['api','rpa'], fallback: true,  ceilingHint: 2, verifiable: true },
  'wo.add_note':             { prefer: ['api','rpa'], fallback: true,  ceilingHint: 2, verifiable: true },
  'wo.set_vendor_instructions': { prefer: ['api','rpa'], fallback: true, ceilingHint: 2, verifiable: true },
  'wo.set_followup_date':    { prefer: ['api','rpa'], fallback: true,  ceilingHint: 2, verifiable: true },
  // Web-app-only — no API reaches these, RPA is the only pipe.
  'inspection.set_custom_date': { prefer: ['rpa'],     fallback: false, ceilingHint: 2, verifiable: true },
  'listing.update':          { prefer: ['rpa'],        fallback: false, ceilingHint: 3, verifiable: true },
};
```

Flipping an action to the API later = change `capabilities()` in `ApiWriteTransport`.
The registry's `prefer:['api','rpa']` already routes to API the moment it reports
that capability. **Zero Dez changes.**

## 5. Router algorithm

```
execute(req):
  cfg = getAgentConfig(req.agent, req.actionKey)
  if isGloballyKilled() or effectiveLevel(cfg) == 0: refuse('disabled')
  if spec.ceilingHint > cfg.ceiling_level: refuse('exceeds policy ceiling')
  level = effectiveLevel(cfg)
  if level <= 2 and !req.approvalToken: refuse('needs approval')      // L2 = act-on-tap
  if isWithinQuietHours(cfg) and !urgent: defer
  if overMaxPerDay(req.agent, req.actionKey): defer

  for pipe in spec.prefer:
     t = transports[pipe]
     if !t.capabilities().has(req.action) or !await t.healthy(): continue
     if alreadyDone(req.idempotencyKey): return cachedResult   // idempotency
     res = await t.execute(req)
     res.verified = await t.verify(req)
     recordEvent(req, res)                                      // wo_event / audit
     if res.ok and res.verified: return res
     if !spec.fallback: return res                              // stop, surface error
  return { ok:false, error:'no capable healthy transport' }
```

Ties directly to the existing `lib/agents/config.ts` (`effectiveLevel`,
`isWithinQuietHours`) and the tiers the Dez autonomy selector writes.

## 6. Transport adapters

### 6a. `ApiWriteTransport`
- Wraps whatever sanctioned write access we have: AppFolio **Write API (Max)**,
  **Realm-X** actions, or v0 where it permits. `capabilities()` returns only the
  actions the current access actually covers (starts *empty* today).
- Pure server-side HTTP (extends `lib/appfolio.ts`, which is GET-only now).
- `verify()` = a v0 GET read-back.

### 6b. `RpaWriteTransport` → htToolKit (Railway) — the worker already exists
The Next serverless runtime can't drive a browser, but we don't need a new
service: **htToolKit** (`bramscher/htToolKit`, `toolkit.hangten.studio`) is
already a FastAPI app on **Railway/Docker with Chromium in the image** and
existing browser automation. We add AppFolio automation there and call it over
HTTPS — **no `write_jobs` queue, no daemon, no cron.**

- **In htToolKit** — new `app/routers/appfolio.py` + `app/services/appfolio_service.py`
  using **Playwright-for-Python** (added to `requirements.txt` + the Dockerfile;
  it can reuse the system Chromium already installed). Endpoints:
  `POST /appfolio/wo/note`, `POST /appfolio/wo/followup`, … — each loads the saved
  session, **deep-links** to the known URL (`…/service_requests/{sr}/work_orders/{wo}`
  — no search step), runs the DOM flow, **verifies by read-back**, and returns
  `{ ok, verified, detail, externalRef }`. ~3–10s/action.
- **Separate API key (as decided).** htToolKit's media endpoints keep
  `settings.api_key` via the existing `require_api_key`. The AppFolio router is
  guarded by a **new** `require_appfolio_key` (`settings.appfolio_api_key`), so a
  leaked media key can't touch the PMS and vice-versa. hdpm-chatbot holds
  `APPFOLIO_TOOLKIT_KEY` in its own env. Ideally also allowlist the caller
  (shared secret / source) so only Dez can hit these routes.
- **Session persistence.** Playwright `storageState` JSON on a **Railway volume**;
  every call loads it already-authenticated. **2FA is cleared once by hand** to
  seed it; htToolKit flags expiry so it can be re-bootstrapped. One session = one
  AppFolio seat = **single-concurrency**.
- **`RpaWriteTransport` (hdpm side)** is a thin HTTPS client: POST the action to
  htToolKit with the separate key, await the JSON. `capabilities()` = the actions
  htToolKit currently implements; `healthy()` = a `GET /appfolio/health` that
  reports whether the stored session is still valid.
- **Guardrails live in htToolKit:** velocity + business-hours caps and a
  circuit-breaker; on repeated failure `/appfolio/health` returns unhealthy so the
  router stops routing to it.

## 7. Idempotency & verification
- `idempotencyKey` = hash(action + subjectId + normalized params + logical-date).
  Stored on the job/event; a duplicate returns the prior result instead of
  re-writing. Protects against retries **and** API→RPA fallback double-writes.
- `verify()` per action: note → confirm the note text exists; status → GET the WO
  and check `status`; followup → GET and check the date. No verify → the write is
  reported failed even if the click "succeeded."

## 8. Autonomy + audit (reuse, don't reinvent)
- **Gate:** `agent_config` via `lib/agents/config.ts` — the exact rows the Dez
  autonomy selector edits. Owner/tenant actions capped at L2 flow through here
  unchanged.
- **Approval at L2:** the `approvalToken` is the Slack-tap / `agent_proposal` id —
  the write only runs after a human taps Approve (the self-closing loop).
- **Audit:** every attempt → `recordEvent()` into `wo_event` with `actor`,
  `transport`, before/after, `verified`. This is the motion metric *and* the undo
  trail.

## 9. Failure / fallback policy
- Per-action `fallback` flag: `wo.*` actions are `['api','rpa']` + fallback
  (durable API, RPA safety net); web-app-only actions are `['rpa']` no-fallback.
- **Circuit breaker:** N consecutive RPA failures → worker unhealthy → router
  skips RPA and surfaces "write path down" to the Ops Brief rather than looping.
- Never silently succeed: an unverified or refused write posts back to the
  originating Slack thread with the reason.

## 10. Rollout
- **Phase 0 (now):** this spec + the interfaces/registry stub. No worker. Writes
  are still human (or supervised RPA like the spike).
- **Phase 1:** add `POST /appfolio/wo/note` + `/appfolio/wo/followup` to
  **htToolKit** (Playwright + `storageState`, behind `require_appfolio_key`) and a
  thin `RpaWriteTransport` in hdpm-chatbot, RPA-only, gated at **L2** (approval
  required). One-time 2FA session bootstrap. First real "@dez → tap → write" loop.
- **Phase 2:** add `ApiWriteTransport` as Write API / Realm-X access lands; flip
  the high-frequency `wo.*` actions to API (registry already prefers it). RPA
  becomes the fallback + the web-app-only long tail.
- **Phase 3:** widen the registry; promote autonomy per action (L2→L3) only as
  measured override rates clear the bar (restart plan §2 rule 6).

## 11. Open questions
1. **Hosting: resolved** → htToolKit on Railway (Docker + Chromium + FastAPI).
   Remaining infra detail: `storageState` on a Railway volume + how often the
   AppFolio session/2FA needs re-bootstrapping (session TTL unknown until we run it).
2. Does the ToS answer permit the **unattended** htToolKit session (vs. today's
   supervised spike)? — gates Phase 1 going unattended.
3. Which two actions first — `add_note` + `followup` are safest; is
   `set_status`/`mark_done` more valuable for motion?
4. Caller restriction: beyond the separate `appfolio_api_key`, do we allowlist the
   hdpm-chatbot origin / add a shared secret so only Dez can hit the AppFolio routes?
