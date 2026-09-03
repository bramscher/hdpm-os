# Unit Turn Estimator & Invoicing — Implementation Plan

**Companion to:** `docs/HDPM_Chat_Turn_Estimator_Invoicing_Spec.md`
**Status:** Draft plan for review (not yet started)
**Author:** codebase discovery + mapping, 2026-09-03

This is the §17 deliverable the spec asks for: (1) an implementation plan mapped to the existing codebase, (2) proposed schema/migrations, (3) integration boundaries, (4) unknowns/risks, and (5) a vertical-slice milestone.

---

## 0. The one important insight

**~60% of the spine already exists in HDPM Chat.** This is a *fill-the-gaps* build, not a greenfield module. Building it as if it were greenfield would fork and duplicate live systems (invoices, unit turns, roles, audit). The plan below reuses each existing system and adds only the genuinely missing pieces.

---

## 1. Reuse vs. net-new map

| Spec area | Already exists (reuse) | Net-new to build |
|---|---|---|
| **Invoice spine** | `hdms_invoices` + JSON `line_items`, `lib/invoices.ts` (create/update/duplicate/credit), cost-blind PDF (`lib/invoice-pdf-template.ts`), `invoice-analysis.ts` cost/charge engine, `lib/payments.ts` reconcile, `af_bills` matching | Extend line-item shape with a `pricing_method`; promote `internal_cost`/`owner_charge`/`tenant_allocation` to explicit fields |
| **Unit turn entity** | `unit_turn` table (property/unit/dates/budget/actual), AppFolio ServiceRequestId sync (`lib/maintenance/unit-turns.ts`), turnover board + Gantt (`board/views/turnover.tsx`, `turn/[id]/TurnGantt.tsx`), phase model (`turn-schedule.ts`) | Replace 3-state `status` (active/ready/closed) with the spec's controlled status machine |
| **Turn/WO state machine** | 8-stage WO `Stage` machine + guards (`lib/maintenance/workflow.ts`) — the template | Turn-level 15-state machine modeled on it |
| **Inspection scheduling** | `inspections`/`route_plans`/`route_stops`, notices, 6-mo cadence (`lib/inspection-*.ts`) | Reuse for INSPECTION_SCHEDULED; does **not** capture conditions |
| **Condition capture** | — (nothing: no rooms, conditions, per-item photos, responsibility) | `inspection_condition` + room-by-room capture + responsibility fields |
| **Media / photos** | Supabase Storage plumbing (`lib/referrals/storage.ts`, invoice-PDF bucket) | `media_evidence` table + upload flow (today photos are just URL strings in `wo_event`) |
| **Time / materials** | Manual labor `qty` on invoice line items; billable-hours rollup | `time_entry` (clock in/out) + `material_entry` tables |
| **Pricing** | Flat constants: `STANDARD_RATE=95`, `AFTER_HOURS_RATE`, `DEFAULT_MARKUP_PCT={materials:25,appliance:10}` | **Versioned, effective-dated price book** + all 8 pricing methods |
| **Estimate entity** | — (none) | `estimate` + `estimate_version` + `estimate_line` (immutable versions) |
| **Approval routing** | Manual `approval` table (WO-scoped, no limit logic); `maintenance_limit` stored as a note | Authorization-limit evaluation + auto-routing + change orders |
| **Audit** | `wo_event` **append-only DB trigger** (the template); `audit_event` + `logAudit()` | Route invoice/estimate/turn mutations through audit; add append-only trigger to `audit_event`; capture old→new + reason |
| **Roles** | `staff.access_role`, 10 roles incl. inspector/field/pm/finance/manager/admin (`lib/roles.ts`, `requireRole()`) | Per-action **capability** layer (can-override-price, can-void, can-approve>$X) |
| **AppFolio** | v0 **read-only** client, webhook receiver + log, `af_bills` mirror, `agent_outbox` retry pattern, channel-adapter registry (the template) | `AppFolioAdapter` interface + **mock adapter**, idempotency keys, field-level sync log, manual export (write API stays deferred) |
| **Config** | `agent_config` policy-as-rows (the template), `dashboard_config` singleton | Effective-dated pricing/limits config + "resolve as-of date" accessor |
| **Notifications** | Channel adapters + `agent_outbox` + `getNotifyRecipients()` (per-agent `slack_recipients`, just built) | Severity × role notification routing |

---

## 2. Architecture decisions (each grounded in an existing pattern)

1. **Price book = effective-dated policy-as-rows**, modeled on `agent_config` (rows, typed loader, pure unit-tested helpers) but with `effective_from`/`effective_to` + a `resolvePrice(itemCode, asOf)` accessor. Migrate the hardcoded `STANDARD_RATE`/`AFTER_HOURS_RATE`/`DEFAULT_MARKUP_PCT` constants into it. This is the heart of the module — "predictable pricing without pretending every unit is the same."
2. **Estimate = immutable versions**, modeled on the `wo_event` append-only trigger and the invoice-variant precedent. A new estimate version is a new row; old versions are never mutated. `estimate_line` carries `pricing_method`, `internal_cost`, `owner_charge`, `tenant_allocation_proposed/approved` as **first-class NUMERIC(12,2)** columns (not JSON — money moves to typed columns going forward).
3. **Turn state machine** extends `unit_turn`, modeled on `lib/maintenance/workflow.ts` (transition table + guards + append-only status events). Map existing WO stages where they overlap (SCHEDULED/IN_PROGRESS/CLOSED, VERIFY≈QC, BILL≈INVOICE_REVIEW).
4. **Condition capture** = new `inspection_condition` rows (room/component/severity/description/responsibility) + `media_evidence` (Supabase Storage), linked to the existing `inspections` row. Reuse the storage pattern from `lib/referrals/storage.ts`.
5. **AppFolio seam = adapter interface + mock**, modeled on `lib/agents/channels/index.ts`. Ships in **read + manual-export mode** (the write API is deferred, ~$850/mo). Idempotency keys + a field-level `appfolio_sync_event` log modeled on `agent_outbox`.
6. **Permissions = capability map over `access_role`**, modeled on the `agent_config` matrix. A small `role_capability` table (or typed map) grants per-action rights; guards call `requireCapability('invoice.void')` on top of `requireRole()`.
7. **Audit everything financial** through `logAudit()`; add a DB append-only trigger to `audit_event` (mirroring `wo_event`) so invoice/estimate/turn edits, price overrides, responsibility changes, approvals, voids, and syncs are immutable with old→new + reason.
8. **Atomic multi-table writes** (invoice + lines + audit) need a Postgres RPC/function — there's no SQL-transaction pattern today. Introduce one for the estimate→invoice conversion.

---

## 3. Recommended phasing

The spec's Phase 1/2/3 is right, but Phase 1 is still large. I recommend a **Slice 0** first to de-risk the true net-new spine, then the spec's phases.

### Slice 0 — the pricing + estimate spine (de-risk everything)
The narrowest thing that proves the architecture end-to-end on **one** line item:
`price_book` (effective-dated) → `estimate`/`estimate_version`/`estimate_line` → calc engine (reusing `invoice-analysis` math) → authorization-limit evaluation → approve → convert to a draft `hdms_invoice` (reusing the existing invoice spine + PDF) → all mutations audited.
- No inspection UI, no mobile, no time-tracking, no AppFolio write yet.
- Proves: effective-dated pricing, immutable versioning, authorization routing, invoice reuse, audit. Everything else hangs off this.

### Phase 1 (spec) — usable estimator
Slice 0 + turn record & status machine + mobile inspection with photos + condition capture + estimate builder UI + owner PDF/email + owner-approval tracking + work orders/time/materials/completion photos + manual AppFolio export package + dashboard.

### Phase 2 (spec) — operational automation
AppFolio direct sync (if/when write API is enabled), Slack/email notifications (reuse outbox), vendor quote/bill portal, tenant-allocation evidence workflow, change orders + not-to-exceed, KPI dashboards + price calibration.

### Phase 3 (spec) — intelligence
AI scope-from-photos (HDPM Chat/Dez), predicted labor/materials, turn-ready risk alerts, anomaly/duplicate detection, price-book recommendations.

---

## 4. Schema sketch — Slice 0 / Phase 1 (new tables)

Following repo conventions (UUID PK, `org_id 'hdpm'`, `NUMERIC(12,2)` money, `updated_at` trigger, service-role RLS, append-only triggers for versioned/audit tables):

- `price_book` / `price_book_version` / `price_book_item` — item code, category, pricing_method enum (`flat|hourly|service_min|package|per_qty|cost_plus|quoted|allowance`), base price, standard minutes, markup rules, GL code, tenant-allocation-eligible flag, `effective_from/to`, market/region.
- `estimate` / `estimate_version` / `estimate_line` — immutable versions; line carries pricing_method, qty/uom, est. labor hours, `internal_cost`, `owner_charge`, `tenant_allocation_proposed/approved`, responsibility rationale, evidence links, approval status.
- `authorization_rule` — per management-agreement limit + emergency rule.
- `approval_request` / `approval_decision` — reuse/extend the existing `approval` table concept, add limit-based routing.
- `change_order` — links to estimate/invoice, tolerance = greater of $100 or 10%.
- `inspection_condition` + `media_evidence` — condition capture + photos.
- `time_entry` / `material_entry` — clock in/out + materials.
- `qc_record` — turn-ready checklist.
- `appfolio_sync_event` — idempotency key + field-level old→new + status/retry.
- `role_capability` — per-action grants.
- Alter `unit_turn`: replace `status` with the 15-state machine + `turn_status_event` (append-only).
- Alter `hdms_invoices` line items: add `pricing_method`, promote cost/charge/tenant fields.

All money `NUMERIC(12,2)`; all versioned/audit tables get append-only triggers modeled on `wo_event_append_only()`.

---

## 5. Integration boundaries

- **AppFolio:** all access behind an `AppFolioAdapter` interface (`read*` + `export*`/`post*`) with a `MockAppFolioAdapter` for tests and a `V0ReadAdapter` wrapping today's `lib/appfolio.ts`. Writes go through `appfolio_sync_event` (idempotency key, retry, field-level log) and start as **manual export** (generate the package; staff post it). Do not enable direct posting until the exact verified write capability + mapping is documented (§18).
- **Invoice reuse:** the estimate→invoice conversion produces a normal `hdms_invoice` draft so the existing PDF, payments, reconcile, and af_bills matching all keep working unchanged.
- **Auth:** new endpoints use `requireRole()` + a new `requireCapability()`; no new auth stack.
- **Notifications:** reuse the channel-adapter + outbox; extend recipients to severity × role.

---

## 6. Risks & unknowns

- **Money-in-JSON vs typed columns:** existing invoice line items are JS numbers in a JSONB blob. New estimate/tenant fields should be typed `NUMERIC` columns; needs a clear boundary so the two don't drift. (Medium risk.)
- **No SQL transactions today:** atomic estimate→invoice+audit needs a new Postgres RPC. (Medium.)
- **AppFolio write API deferred (~$850/mo):** module must be fully usable in read + manual-export mode; direct posting is a separate go decision. (Known constraint.)
- **`hdms_invoices` base CREATE TABLE is not in `supabase/migrations/`** (only ALTERs) — it was applied out-of-band via `scripts/`. Locate/capture the true base schema before extending. (Housekeeping, low but blocking for schema work.)
- **Scope size:** this is a multi-month module. Sequencing discipline (Slice 0 first) is the main risk control.

## 7. Open decisions needed from you / stakeholders (spec §18)

These are **inputs**, not code — several block correct pricing/approval logic:
1. Management-agreement wording & owner authorization limits (drives approval routing).
2. Markup permitted per agreement (materials/vendor).
3. Whether turn coordination is included in management fees for some owners.
4. Emergency approval thresholds.
5. Final price-book task list + cleaning/painting/flooring vendor schedules (the actual items + prices).
6. GL/account mapping + accounting review process.
7. Oregon security-deposit review procedure + who approves responsibility (roles).
8. Owner approval channel: portal, email link, AppFolio, or combination.
9. Are invoices issued by HDPM as contractor, passed through as owner expense, or both?
10. Photo/approval/invoice/audit retention period.

## 8. Recommended first build

**Slice 0** (§3): the price book + estimate spine + authorization eval + invoice conversion + audit — one line item, end to end, no UI polish. It's the smallest thing that proves the net-new architecture and immediately makes HDPM's pricing consistent. Everything else (inspection capture, mobile, time-tracking, AppFolio sync, tenant allocation) layers on afterward without re-architecting.

Before starting Slice 0, we need the launch price-book items + the authorization-limit / markup rules (decisions 1, 2, 5 above) — otherwise the pricing engine has nothing real to price against.
