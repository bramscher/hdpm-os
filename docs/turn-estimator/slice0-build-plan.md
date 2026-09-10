# Turn Estimator — Slice 0 build plan

**Parent:** `docs/HDPM_Chat_Turn_Estimator_Implementation_Plan.md` · **Spec:** `docs/HDPM_Chat_Turn_Estimator_Invoicing_Spec.md`
**Goal:** thread **one line item end-to-end through the net-new spine** to prove the architecture, reusing the existing invoice/audit systems. No UI polish, no mobile, no inspection capture, no time-tracking, no AppFolio write.

**End-to-end path Slice 0 proves:**
`price book (effective-dated)` → `estimate` (immutable versions) → `pricing engine` → `authorization evaluation` → `approval` → `convert to draft hdms_invoice` (reuse existing spine + PDF) → **every mutation audited**.

---

## 1. What Slice 0 includes vs. excludes

**Includes:** price-book items (effective-dated) with core pricing methods (flat, hourly, service_min, per_qty, cost_plus); estimate + immutable version + line; pure pricing engine; authorization-limit evaluation; estimate approval record; atomic estimate→invoice conversion (reusing `hdms_invoices` + PDF); audit on every financial mutation; role gating; unit tests mapping to spec acceptance tests #2, #3, #4, #6, #8, #9.

**Excludes (later phases):** inspection condition capture, mobile, media/photos, `time_entry`/`material_entry`, tenant-allocation *workflow* (the field exists and defaults to 0), change-order *execution* (only the detection function ships), package/quoted/allowance *full* pricing (structural enum only), AppFolio sync, the 15-state turn machine, severity×role notifications, the capability table (Slice 0 uses `requireRole`).

---

## 2. Migration `20260904_turn_estimator_slice0.sql`

Follows repo conventions: `IF NOT EXISTS`, UUID PK `gen_random_uuid()`, `org_id TEXT DEFAULT 'hdpm'`, `NUMERIC(12,2)` money, `updated_at` trigger, service-role RLS, append-only triggers modeled on `wo_event_append_only()`, ends with `NOTIFY pgrst, 'reload schema';`.

**`price_book_item`** — effective-dated, one row per (item_code × effective window). This IS the effective-dated pricing config (no separate config table for prices).
- `item_code TEXT`, `category TEXT`, `name TEXT`, `owner_description TEXT`, `internal_instructions TEXT`
- `pricing_method TEXT CHECK (pricing_method IN ('flat','hourly','service_min','package','per_qty','cost_plus','quoted','allowance'))`
- `base_price NUMERIC(12,2)` (meaning per method: flat price / hourly rate / minimum / per-unit / cap)
- `included_minutes INT`, `increment_minutes INT`, `increment_price NUMERIC(12,2)` (service_min)
- `standard_minutes INT`, `uom TEXT`, `markup_pct NUMERIC(6,3)`, `markup_eligible BOOL DEFAULT false`
- `gl_code TEXT`, `tenant_alloc_eligible BOOL DEFAULT false` (eligible ≠ approved)
- `skill_trade TEXT`, `market TEXT DEFAULT 'central_oregon'`
- `effective_from DATE NOT NULL`, `effective_to DATE` (NULL = open), `active BOOL DEFAULT true`
- unique-ish guard: no overlapping effective windows per `item_code` (enforced in app + a partial index)

**`estimate`** (mutable header)
- `unit_turn_id UUID` (FK `unit_turn`, nullable), `property_id/name`, `unit_id/name`
- `status TEXT CHECK (status IN ('draft','ready','approval_pending','approved','declined','superseded','void')) DEFAULT 'draft'`
- `current_version_id UUID`, `authorization_limit NUMERIC(12,2)` (seed from WO `maintenance_limit` or entered)
- `created_by TEXT`, `created_at`, `updated_at`

**`estimate_version`** (immutable — append-only trigger)
- `estimate_id UUID`, `version_number INT`, `status TEXT` (snapshot: draft/issued/approved/superseded)
- `owner_total`, `internal_cost_total`, `tenant_alloc_proposed_total`, `margin` — `NUMERIC(12,2)`
- `priced_asof DATE` (the date whose price-book rows were resolved — the effective-dating anchor; makes acceptance #4 hold)
- `notes TEXT`, `created_by TEXT`, `created_at`

**`estimate_line`** (immutable — append-only)
- `estimate_version_id UUID`, `line_no INT`
- `price_book_item_id UUID`, `price_book_item_code TEXT`, `pricing_method TEXT`, `description TEXT`
- `room TEXT`, `location TEXT`, `qty NUMERIC(12,3)`, `uom TEXT`, `est_labor_hours NUMERIC(8,2)`, `est_material_cost NUMERIC(12,2)`
- `internal_cost`, `owner_unit_price`, `owner_extended`, `tax_amount` — `NUMERIC(12,2)`
- `tenant_alloc_proposed NUMERIC(12,2) DEFAULT 0`
- `responsibility TEXT CHECK (responsibility IN ('owner','tenant','shared','unknown','not_billable')) DEFAULT 'owner'`, `responsibility_rationale TEXT`

**`estimate_approval`** (records — no destructive edits)
- `estimate_version_id UUID`, `kind TEXT CHECK (kind IN ('OWNER','PM','OPS'))`
- `requested_by`, `requested_at`, `approved_amount NUMERIC(12,2)`
- `decision TEXT CHECK (decision IN ('APPROVED','DECLINED','CHANGES'))`, `decided_by`, `decided_at`, `conditions TEXT`, `reason TEXT`

**`turn_estimator_config`** — JSONB singleton (`id='singleton'`), modeled on `dashboard_config`. Holds the few non-item globals: `change_order_tolerance_abs` (100), `change_order_tolerance_pct` (0.10), `internal_labor_cost_rate` (for margin), default `authorization_limit`. Keeps constants out of business logic.

**Alter `hdms_invoices`:** `ADD COLUMN IF NOT EXISTS source_estimate_version_id UUID` (prevents double-billing an estimate version → acceptance #9).

**Append-only trigger on `audit_event`:** replicate `wo_event_append_only()` so financial audit is DB-immutable.

---

## 3. Pricing engine — `lib/turn-estimator/pricing.ts` (pure, unit-tested)

Reuses the cost/markup math already in `lib/invoice-analysis.ts` (`chargedFromCost`, cent rounding).

```
priceLine(item: PriceBookItem, input: LineInput): PricedLine
  flat        → owner = base_price × qty
  hourly      → owner = base_price(rate) × hours
  service_min → owner = base_price(min) + ceil(max(0, minutes - included_minutes)/increment_minutes) × increment_price
  per_qty     → owner = base_price × qty
  cost_plus   → owner = chargedFromCost(cost, item.markup_pct)   // reuse invoice-analysis
  internal_cost = est_material_cost + (est_labor_hours × config.internal_labor_cost_rate)  // or provided

priceEstimate(lines): { owner_total, internal_cost_total, tenant_alloc_proposed_total, margin }
evaluateAuthorization(owner_total, limit): 'auto_approved' | 'approval_pending'
changeOrderRequired(approvedTotal, newTotal, cfg): boolean   // newTotal > approvedTotal + max($100, 10%)
```

**Acceptance tests hit directly here:**
- #2 — five tasks in one visit apply **one** `service_min`, not five (bundling rule: one minimum per visit; extra tasks priced without their own minimum).
- #3 — 90-min standard visit = `$125 + 2×$21.25 = $167.50` before materials/adjustments.
- #6 — approved estimate that grows beyond tolerance → `changeOrderRequired` true.

---

## 4. Data + service layer

- `lib/turn-estimator/price-book.ts` — the CRUD service layer with **effective-dated (version-on-change) semantics**:
  - `resolvePriceBookItem(itemCode, asOf)` — picks the row effective on `asOf`.
  - `createItem(...)` — add a new `item_code` + first effective row.
  - `reprice(itemCode, newFields, effectiveFrom)` — close the current row (`effective_to`) and insert a new one; **never mutates an issued price** → acceptance #4. In-place edits allowed only for metadata (description/instructions) with an audit event, or a draft item never used.
  - `retire(itemCode, effectiveTo)` — deactivate; no destructive delete of a used item.
  - `list(filter)` — browse/search for the admin UI.
  - **Admin CRUD UI** (`/turn-estimator/price-book`, Administrator role) is Phase 1 — Slice 0 exercises this layer via seeds + tests.
- `lib/turn-estimator/estimates.ts` — `createEstimate`, `addDraftLine`, `issueVersion` (computes prices at `priced_asof`, writes an **immutable** `estimate_version` + lines), `requestApproval`, `decideApproval`. Every mutation calls `logAudit(subject_type, subject_id, event_type, actor, {old, new, reason})`.
- `lib/turn-estimator/convert.ts` + Postgres RPC `convert_estimate_to_invoice(version_id, actor)` — atomically inserts a draft `hdms_invoices` row + `line_items` (mapping `estimate_line` → existing `LineItem` shape: `type` from category, `unit_price=owner_unit_price`, `amount=owner_extended`, `cost=internal_cost`, `markup_pct`), stamps `source_estimate_version_id`, writes audit. Reuses the existing PDF, payments, reconcile, af_bills unchanged. Guard: refuse if a non-void invoice already has this `source_estimate_version_id` (acceptance #9).

## 5. API + permissions

Thin routes under `app/api/turn-estimator/*` (price-book, estimates, approvals, convert). Slice 0 authz via existing `requireRole()`:
- create/edit estimate + lines → `maintenance`, `pm`, `admin`
- request/decide approval → `pm`, `manager`, `admin`
- convert to invoice → `finance`, `admin`
(The per-action capability table is Phase 1.)

## 6. Build order

1. Migration `20260904_turn_estimator_slice0.sql` (+ locate/capture the out-of-band `hdms_invoices` base schema first).
2. `pricing.ts` + tests (acceptance #2, #3, #6) — pure, no DB, fastest feedback.
3. `price-book.ts` + effective-dating test (#4).
4. `estimates.ts` (issue immutable versions, audited).
5. `convert_estimate_to_invoice` RPC + `convert.ts` + tests (#8 preserve, #9 no double-bill).
6. API routes + role gates.
7. Seed ~8 sample price-book items (placeholder prices) so the flow runs end-to-end; real items/prices swap in later.

## 7. Acceptance tests covered by Slice 0

#2 (one minimum for 5 tasks), #3 ($167.50 math), #4 (price-book update doesn't change an issued estimate), #6 (change-order tolerance), #8 (invoice preserves estimate/variance/source links), #9 (no double-billing). #5/#10/#11/#14 partially (authorization eval, tenant defaults to 0, audit) — full coverage in Phase 1.

## 8. Blockers / inputs before real use (not needed to build the architecture)

- **Real price-book items + prices** (spec §18.5) — Slice 0 runs on placeholders; correct pricing needs the actual list.
- **Labor rate: $95/hr (confirmed 2026-09-03).** Spec §6.2 said $85; the current rate is **$95/hr** (matches PR #58). Seed the price-book `LABOR_STD` item at $95; after-hours = $142.50 (95 × 1.5).
- **Authorization limits + markup rules** (spec §18.1, §18.2) — drive `evaluateAuthorization` and `cost_plus`. Slice 0 uses `turn_estimator_config` defaults + per-estimate `authorization_limit` (seedable from WO `maintenance_limit`) until the real rules land.
