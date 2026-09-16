lets f

**Document status:** Implementation-ready product specification  
**Business:** High Desert Property Management, Inc. (HDPM)  
**Primary system:** HDPM Chat  
**Related system:** AppFolio  
**Initial market:** Central Oregon  
**Version:** 1.0  

## 1. Product objective

Build a unit-turn estimating and invoicing module inside HDPM Chat that lets staff:

1. Inspect a vacant unit and document its condition.
2. Select standardized work from an HDPM price book.
3. Produce a consistent owner estimate with photos and assumptions.
4. Route the estimate for internal and owner approval when required.
5. Dispatch work to HDPM technicians or outside vendors.
6. Track actual labor, materials, vendor costs, completion evidence, and turn-ready date.
7. Convert approved/completed work into an owner invoice.
8. Separately determine whether any amount may be allocated to the tenant/security deposit.
9. Export or sync work orders, bills, invoices, documents, and status updates to AppFolio.
10. Measure turn time, estimate accuracy, technician productivity, and gross margin.

The system must create predictable pricing without pretending every unit of the same size or bedroom count requires the same work.

## 2. Product principles

- Use a **hybrid price book**: flat prices for repeatable work; hourly or quoted pricing for uncertain work.
- Never use one universal price for an entire turn without a defined scope.
- Preserve an audit trail from inspection through final invoice.
- Store **internal cost**, **owner charge**, and **potential tenant allocation** separately.
- Never automatically assume an owner charge is chargeable to a tenant.
- Require photos, descriptions, responsibility findings, and supporting records for tenant allocations.
- Exclude ordinary wear and tear from tenant allocations.
- Make all pricing, authorization limits, markups, taxes, and minimums configurable and effective-dated.
- Do not let AI invent prices, responsibility findings, completed work, or approval.
- Optimize for both speed-to-ready and gross margin; neither metric alone is sufficient.

## 3. Roles and permissions

| Role | Key permissions |
|---|---|
| Inspector | Create inspection, upload photos, identify conditions, draft scope; cannot approve prices or tenant charges |
| Maintenance coordinator | Edit scope, select price-book items, assign labor/vendor, issue work orders, request approval |
| Technician | View assignment, clock in/out, record materials, upload completion photos, flag scope changes |
| Property manager | Review estimate, determine owner responsibility, recommend tenant responsibility, approve within authority |
| Accounting | Review invoices, vendor bills, owner/tenant allocations, post/export to AppFolio |
| Operations manager | Approve overrides, discounts, write-offs, after-hours charges, disputed allocations |
| Administrator | Manage price books, permissions, authorization rules, integrations, templates, and audit access |

Use least-privilege access. Every price override, responsibility change, approval, invoice edit, deletion/void, and AppFolio sync must record actor, timestamp, old value, new value, and reason.

## 4. Turn lifecycle

Use these controlled statuses:

`NOTICE_RECEIVED → INSPECTION_SCHEDULED → INSPECTED → SCOPE_DRAFT → ESTIMATE_READY → APPROVAL_PENDING → APPROVED → SCHEDULED → IN_PROGRESS → QC_PENDING → TURN_READY → INVOICE_REVIEW → INVOICED → POSTED → CLOSED`

Exception statuses:

- `ON_HOLD_OWNER`
- `ON_HOLD_PARTS`
- `ON_HOLD_VENDOR`
- `CHANGE_ORDER_PENDING`
- `DISPUTED`
- `CANCELLED`

Every status change must store its timestamp and responsible user. The system must calculate total vacant days and time spent in each status.

## 5. Required workflow

### 5.1 Create turn

Create manually or from an AppFolio move-out/vacancy event. Capture:

- Property and unit
- Owner and portfolio
- Tenant/lease reference
- Move-out date and date keys are due/received
- Target ready date and target move-in date
- Monthly rent and calculated daily vacancy cost
- Property type, bedrooms, bathrooms, square footage, year built, occupied/vacant status
- Applicable management agreement and owner authorization limit
- Applicable lease/security-deposit record

### 5.2 Inspection

Use a room-by-room mobile checklist. Each condition record must include:

- Room/location
- Component
- Condition and severity
- Written description
- At least one photo when repair or tenant allocation is proposed
- Optional move-in comparison photo/document
- Recommended action
- Preliminary responsibility: owner, tenant, shared, unknown, or not billable
- Safety/habitability/emergency flag

AI may analyze notes and images to suggest tasks, but the inspector must confirm each task before it enters the estimate.

### 5.3 Scope and estimate

Turn confirmed conditions into estimate line items. Each line must include:

- Price-book item and version
- Customer-facing description
- Location/room
- Quantity and unit of measure
- Pricing method
- Estimated labor hours
- Estimated material quantity and cost
- Internal estimated cost
- Owner unit price and extended price
- Proposed tenant allocation, if any
- Responsibility rationale and evidence links
- Assigned technician/vendor, when known
- Tax treatment, if applicable
- Approval status

Group lines under: inspection/coordination, cleaning, painting, flooring, handyman/maintenance, appliances, landscaping/exterior, locks/security, haul-away, vendor work, and other.

### 5.4 Approval routing

- Compare the full owner estimate—not just individual lines—to the property authorization limit.
- Automatically approve only when allowed by the management agreement and HDPM policy.
- Always allow emergency/habitability work to follow a separately configured emergency authorization rule.
- Send owner approval requests with total, summarized scope, photos, target completion date, and approve/decline/request-changes actions.
- Record approval identity, timestamp, approved amount, and approved scope version.
- Any post-approval increase beyond the configured tolerance creates a change order.

Default change-order tolerance: greater of **$100 or 10% of the approved total**, configurable.

### 5.5 Dispatch and execution

- Create one or more work orders from the approved estimate.
- Bundle multiple tasks at the same property into one service-call minimum when appropriate.
- Do not apply a separate minimum to every task within one continuous visit.
- Require technicians to clock in/out, record travel if policy allows, log materials, add notes, and upload completion photos.
- A technician cannot silently expand scope. New work must be flagged as a proposed change order unless it is within an approved not-to-exceed amount.
- Permit offline mobile capture with later synchronization.

### 5.6 Quality control

- Require completion evidence for every line item.
- Perform a final turn-ready checklist: utilities, cleanliness, paint, flooring, fixtures, appliances, plumbing leaks, lights, smoke/CO devices, locks/keys, exterior, abandoned property, safety, and marketing readiness.
- Record rework separately and identify whether it is billable or absorbed by HDPM/vendor.
- Only authorized staff may mark the unit `TURN_READY`.

### 5.7 Invoice conversion

- Convert completed estimate/work-order lines to a draft invoice.
- Show approved amount, change orders, actual quantities, actual cost, owner charge, and variance.
- Prevent duplicate billing by associating every invoice line with its originating work-order line(s).
- Preserve original estimates and approvals; never overwrite history when invoicing.
- Require review for price overrides, negative margin, missing completion evidence, unapproved overage, missing vendor bill, or disputed tenant allocation.
- Export or sync the finalized owner charge to AppFolio with property/unit, GL code, work-order reference, description, documentation, and attachments.

## 6. Pricing engine

### 6.1 Supported pricing methods

1. **Flat task:** fixed labor/service price per unit.
2. **Hourly:** actual or estimated hours × billable rate.
3. **Service minimum:** minimum visit price, followed by time increments.
4. **Package:** predefined bundle with included hours/tasks and overage rules.
5. **Per quantity:** room, fixture, appliance, linear foot, square foot, cubic yard, load, or item.
6. **Cost plus markup:** vendor/material cost plus configured markup.
7. **Quoted:** manually entered vendor or project quote requiring documentation.
8. **Allowance/not-to-exceed:** authorized cap with actual billing up to the cap.

### 6.2 Launch defaults

All defaults are editable, effective-dated settings—not hard-coded constants.

| Setting | Launch default |
|---|---:|
| Standard service-call minimum | $125.00 |
| Included onsite labor | 60 minutes |
| Standard labor rate after minimum | $85.00/hour |
| Billing increment after included time | 15 minutes ($21.25) |
| Two-person labor rate | $170.00/hour |
| After-hours emergency minimum | $250.00 |
| Standard material markup | 20% |
| Turn inspection/scope | $150.00 |
| Turn coordination minimum | $150.00 |
| Optional coordination method | Greater of $150 or 10% of eligible outside-vendor work |
| Final QC inspection | Included by default; separately configurable |
| Rush premium | 20% on eligible labor/services |

Suggested maintenance packages:

| Package | Included labor | Launch price |
|---|---:|---:|
| Light maintenance turn | Up to 2 hours | $250 |
| Standard maintenance turn | Up to 4 hours | $450 |
| Heavy maintenance turn | Up to 8 hours | $800 |

Package materials are additional. Overage is billed at the standard labor rate in 15-minute increments. Define inclusions and exclusions on each package; staff must not infer them.

### 6.3 Calculation order

For each line and estimate:

1. Determine base price from the effective price-book version.
2. Apply quantity or included units.
3. Apply permitted complexity, after-hours, or rush adjustment.
4. Apply material/vendor markup only to eligible costs.
5. Apply portfolio-specific contract pricing.
6. Apply authorized discount or override.
7. Apply tax treatment, if required.
8. Calculate owner total.
9. Calculate proposed tenant allocation independently, capped at the supportable amount.
10. Store internal cost and calculate estimated gross margin.

Never compound markups unless an administrator explicitly configures that behavior. Display all adjustments.

### 6.4 Service-minimum rules

- One minimum per technician/team per continuous visit at a property/unit.
- Multiple tasks during that visit share the minimum.
- A return visit may create a new minimum only when separately justified (for example, approved second phase, parts unavailable, tenant access failure not caused by HDPM, or separate trade/date).
- No new minimum for technician rework or a preventable HDPM error.
- Multi-unit projects may use a property-level mobilization/minimum; allocation among units must be transparent.
- Minimum behavior must be configurable by owner contract and job type.

### 6.5 Price-book structure

Each price-book item requires:

- Stable item code and category
- Name and owner-facing description
- Internal technician instructions
- Pricing method and base price
- Estimated standard minutes
- Included/excluded materials
- Eligible markup rules
- Unit of measure
- Default GL code
- Skill/trade requirement
- Required photos or checklist
- Warranty/rework period
- Tenant-allocation eligibility flag (eligible does not mean approved)
- Active dates, market/region, and version

Never update historical estimates when a price book changes. New estimates use the price effective on the estimate date; authorized users may reprice a draft with an audit event.

## 7. Responsibility and security-deposit safeguards

Maintain three independent financial fields on each line:

1. `internal_cost`
2. `owner_charge`
3. `tenant_allocation_proposed` / `tenant_allocation_approved`

Rules:

- Default tenant allocation to $0.
- Require a human responsibility determination before setting a tenant allocation.
- Require evidence of condition beyond ordinary wear and tear and a description of why the tenant is responsible.
- Support move-in versus move-out evidence comparison.
- Account for useful life, prior condition, depreciation/proration, owner betterment, and partial responsibility when applicable.
- Tenant allocation cannot exceed the applicable supported owner cost/charge under HDPM policy.
- Owner approval of work does not approve a tenant deduction.
- Completion of work does not prove tenant responsibility.
- AI can summarize evidence but cannot make the final legal/accounting determination.
- Any tenant-facing deposit accounting must use an approved template and be reviewed by authorized staff.

## 8. Data model

Minimum entities:

- `Property`
- `Unit`
- `Owner`
- `TenantLease`
- `ManagementAgreement`
- `AuthorizationRule`
- `Turn`
- `TurnStatusEvent`
- `Inspection`
- `ConditionRecord`
- `MediaEvidence`
- `PriceBook`
- `PriceBookVersion`
- `PriceBookItem`
- `Estimate`
- `EstimateVersion`
- `EstimateLine`
- `ApprovalRequest`
- `ApprovalDecision`
- `ChangeOrder`
- `WorkOrder`
- `WorkOrderLine`
- `Assignment`
- `TimeEntry`
- `MaterialEntry`
- `VendorQuote`
- `VendorBill`
- `QCRecord`
- `Invoice`
- `InvoiceLine`
- `ResponsibilityDecision`
- `TenantAllocation`
- `AppFolioSyncEvent`
- `AuditEvent`

Use immutable versions for estimates, approvals, change orders, invoices, and price books. Monetary fields must use fixed-precision decimal values and store currency.

## 9. Core user interfaces

### 9.1 Turn dashboard

Display:

- Property/unit
- Move-out, target-ready, and actual-ready dates
- Current status and blocker
- Estimated and actual owner cost
- Proposed/approved tenant allocation
- Estimated daily vacancy loss and vacancy cost to date
- Approval status
- Assigned staff/vendors
- Next action and accountable person

Allow filtering by coordinator, property manager, status, aging, owner, ready-date risk, approval delay, and vendor.

### 9.2 Mobile inspection builder

- Room-by-room checklist
- Fast photo capture and markup
- Voice-to-text notes
- Suggested price-book tasks from notes/photos
- Move-in comparison
- Responsibility selection with rationale
- Offline support

### 9.3 Estimate builder

- Search/browse price book
- Add suggested tasks
- Adjust quantity and scope
- Show owner price, internal cost, margin, tenant proposal, and evidence
- Surface minimum/package interactions before saving
- Show authorization threshold and approval route
- Generate owner-facing PDF/email/portal view

### 9.4 Work-order execution

- Today's assignments
- Navigation/contact/access instructions
- Scope and exclusions
- Clock in/out
- Materials and receipts
- Before/after photos
- Change-order request
- Completion and technician certification

### 9.5 Invoice review

- Estimate-to-actual variance
- Approval/change-order reconciliation
- Owner charge versus tenant allocation
- Margin warnings
- Missing documentation warnings
- AppFolio preview and sync status

## 10. HDPM Chat assistant behavior

HDPM Chat should support requests such as:

- “Create a turn estimate from this inspection.”
- “Show all turns at risk of missing Friday.”
- “What is waiting on owner approval?”
- “Add a toilet-seat replacement from the current price book.”
- “Explain why this invoice is $240 over estimate.”
- “Draft an owner approval request with the relevant photos.”
- “Which completed turns are not yet invoiced?”
- “Compare Alberto’s actual time with price-book standard time.”

Assistant constraints:

- Cite the source record for all amounts and status claims.
- State when data is missing, stale, unsynced, or inferred.
- Ask for confirmation before committing financial transactions, sending owner communications, changing responsibility, or posting to AppFolio.
- Never fabricate a price-book item. Offer to create a draft custom line when no item matches.
- Never mark work completed without a completion record.
- Never represent a proposed tenant allocation as final.
- Respect user permissions in both chat and conventional UI.

## 11. AppFolio integration

Build an integration adapter so HDPM Chat remains usable if AppFolio APIs or export methods change.

Required mapping:

- Property/unit and owner identifiers
- Tenant/lease reference
- Work-order number and status
- Vendor and technician
- Owner charge and applicable GL account
- Vendor bill/cost
- Attachments, receipts, before/after photos, and approvals
- Tenant allocation/security-deposit support package
- Invoice/posting status and external transaction IDs

Integration requirements:

- Idempotency keys for all create/post operations
- Retry queue with visible errors
- No duplicate invoice or work-order creation
- Field-level sync log
- Manual reconciliation workflow
- Webhook/event processing where supported; scheduled reconciliation otherwise
- Draft/test mode before financial posting

Do not assume an AppFolio endpoint exists until verified against HDPM’s current AppFolio account, plan, API access, and documentation.

## 12. Notifications

Send role-appropriate notifications for:

- Inspection overdue
- Estimate ready for review
- Owner approval required/reminder
- Target-ready date at risk
- Technician assignment/change
- Change order pending
- Vendor/parts delay
- QC failure or rework
- Turn marked ready
- Completed but uninvoiced work
- Invoice exception or AppFolio sync failure

Support Slack and email, with notification rules configurable by severity and role. Do not disclose tenant-sensitive or financial information in public Slack channels.

## 13. Reporting and KPIs

Track at company, employee, vendor, property, owner, and unit levels:

- Turns completed
- Median and average days from keys received to turn ready
- Days waiting by status/blocker
- Estimated versus actual labor hours
- Estimated versus final owner charge
- Internal cost and gross margin dollars/percentage
- First-pass QC rate and rework rate
- Owner approval response time
- Vendor response/completion time
- Completed-but-uninvoiced dollars and aging
- Average physical make-ready cost by property type/bedroom count
- Tenant-allocation proposed, approved, collected, disputed, and reversed
- Vacancy cost and estimated vacancy days avoided
- Price-book item variance and recommended repricing candidates

Do not combine vacancy loss, leasing expense, and physical make-ready cost into one number unless the report explicitly labels each component.

## 14. Validation and business rules

- No estimate may be sent without property/unit, scope, price version, total, and authorization evaluation.
- No work order may be dispatched unless authorized or classified under an allowed emergency rule.
- No invoice line without completed work, approved fixed charge, documented coordination service, or supported vendor cost.
- No tenant allocation without responsibility decision and evidence.
- No invoice can exceed approval beyond tolerance without an approved change order.
- No negative-margin line can post without manager approval and reason.
- No price override without permission and reason.
- No deleted financial record; use void/reversal and preserve history.
- No duplicate minimum within one continuous eligible visit.
- No rush or after-hours premium unless its triggering facts are recorded.

## 15. MVP scope

### Phase 1 — Usable estimator

- Turn record and lifecycle
- Mobile inspection with photos
- Versioned price book
- Estimate builder and PDF/email output
- Authorization-limit evaluation
- Owner approval tracking
- Work orders, time, materials, and completion photos
- Draft invoice conversion
- Manual AppFolio export package
- Audit log and basic dashboard

### Phase 2 — Operational automation

- Direct AppFolio synchronization where supported
- Slack/email notifications
- Vendor quote/bill portal
- Tenant-allocation evidence workflow
- Change orders and not-to-exceed controls
- KPI dashboards and price calibration

### Phase 3 — Intelligence

- AI-assisted scope from images/notes
- Predicted labor/material requirements
- Turn-ready risk alerts
- Anomaly/duplicate detection
- Price-book adjustment recommendations
- Vendor and technician performance insights

## 16. Acceptance tests

The MVP is acceptable when all of the following pass:

1. A staff member can create a turn, complete an inspection, attach photos, select price-book work, and issue an owner estimate.
2. A visit with five tasks applies one $125 service minimum, not five minimums.
3. A 90-minute standard visit calculates $125 plus two 15-minute increments at $21.25, totaling $167.50 before materials or adjustments.
4. A price-book update does not change an already issued estimate.
5. An estimate above the property authorization limit enters `APPROVAL_PENDING` and cannot be dispatched under normal rules.
6. An approved estimate that increases beyond the configured tolerance creates a change-order requirement.
7. A technician can record time, materials, receipts, notes, and before/after photos from a phone.
8. An invoice preserves the original estimate, approval, actual work, variance, and source-line relationships.
9. The same completed work cannot be invoiced twice.
10. A tenant allocation defaults to zero and cannot be approved without evidence and a human responsibility decision.
11. Owner charge and tenant allocation can differ without changing internal cost.
12. A failed AppFolio export/sync is visible, retryable, and does not create a duplicate.
13. A manager can identify turns at risk, waiting approvals, completed-uninvoiced work, and negative-margin exceptions.
14. Every financial override and responsibility change appears in the audit log.

## 17. Build prompt for the development agent

Use the following prompt together with this complete specification:

> Build the Unit Turn Estimator and Invoicing module for HDPM Chat according to the attached specification. First inspect the existing repository, architecture, authentication/authorization model, database conventions, UI system, test framework, and any current AppFolio integration. Reuse established patterns and do not replace unrelated components.
>
> Begin by producing: (1) an implementation plan mapped to the existing codebase, (2) proposed schema/migrations, (3) integration boundaries, (4) identified unknowns and risks, and (5) a vertical-slice milestone. Then implement the smallest complete vertical slice: create turn → record inspection/evidence → add versioned price-book lines → calculate estimate → evaluate authorization → approve → create work order → record actuals/completion → generate draft invoice. Include role permissions, immutable version/audit behavior, fixed-precision money calculations, idempotency, and automated tests.
>
> Treat launch prices as editable effective-dated configuration, never constants embedded in business logic. Maintain internal cost, owner charge, and proposed/approved tenant allocation as separate values. Tenant allocations must default to zero and require evidence plus an authorized human decision. Do not let AI invent pricing, completion, approval, or responsibility.
>
> Do not assume AppFolio API capabilities. Implement an adapter interface, a mock/test adapter, idempotent operations, and an initial manual export workflow. Before enabling direct posting, document the exact verified AppFolio capability and mapping.
>
> Use database transactions for financial/status mutations, preserve historical versions, and implement void/reversal rather than destructive deletion. Add tests for service-minimum bundling, pricing increments, authorization limits, change orders, price-version preservation, duplicate invoice prevention, responsibility safeguards, and sync retry/idempotency.
>
> At the end of each milestone, report what was implemented, migrations/configuration required, tests run and results, remaining gaps, and exact steps for staff acceptance testing. Do not mark the module complete until the specification’s MVP acceptance tests pass.

## 18. Open implementation decisions

Confirm these during codebase discovery or initial stakeholder review:

1. HDPM Chat technology stack and repository location.
2. Current AppFolio access/API/export capabilities.
3. Whether invoices are issued by HDPM as contractor, passed through as owner expenses, or both.
4. Exact wording and authority contained in current owner management agreements.
5. Material/vendor markup permitted by each agreement.
6. Whether turn coordination is included in management fees for any owners.
7. Emergency approval thresholds.
8. Final price-book task list and cleaning/painting/flooring vendor schedules.
9. Responsibility approval roles and Oregon security-deposit review procedure.
10. GL/account mapping and accounting review process.
11. Required retention period for photos, approvals, invoices, and audit records.
12. Whether owners approve through a portal, email links, AppFolio, or a combination.

## 19. Launch recommendation

Pilot with one maintenance coordinator, Alberto, Brody, one property manager, and 20–30 turns. Continue recording actual labor even for flat-price jobs. Review weekly for incorrect minimums, missed scope, approval delays, estimate variance, rework, and margin. After 50–100 completed turns, recalibrate standard minutes and prices using HDPM’s own results rather than generic national averages.
