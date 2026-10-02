---
type: decision
status: active
tags: [partners, referrals, trailing-fees, appfolio-reports, general-ledger, batch-6a, go-no-go]
relatedTo: [docs/partners/00-referral-portal-plan.md]
---

# Batch 6a: can we get real management-fee income per property? (2026-10-01)

**Recommendation: GO, provisionally.** AppFolio's `general_ledger` report gives per-property, per-month management-fee amounts on GL account **5010 "Mgmt: Management Fee"**. Every row carries `property_integration_id`, the v0 UUID we already store, so it joins directly. For September 2026 it totals **$98,236.91 across 428 properties**. The `bill_detail` report independently returns the **same total**.

**One step left before this is final:** reconcile one property against its owner statement (see the end of this doc).

## How this was tested

Probe: `GET /api/partners/admin/spike/fee-income?month=2026-09` (PR #104). It is admin-only and read-only. It ran six candidate reports, one after another, against production AppFolio. Each candidate made one report call.

| Report | Accepted with | Per property? | Joins to our properties | Fee total, Sep 2026 | Usable |
|---|---|---|---|---|---|
| `general_ledger` | `posted_on_from/to` | Yes, 440 fee rows, 428 properties | `property_integration_id` (v0 UUID) + `property_id` | $98,236.91 | **Yes: the source** |
| `bill_detail` | `occurred_on_from/to` + columns | Yes, 443 rows, 431 properties | `property_id` only | $98,236.91 | Cross-check |
| `income_statement` | `posted_on_from/to`, cash basis | No, company-wide | n/a | n/a (no month column read) | No |
| `twelve_month_income_statement` | `posted_on_to` | No, company-wide | n/a | $895,276.61 (12 months to Sep) | No |
| `owner_statement` | rejected: "not a valid report" | n/a | n/a | n/a | No |
| `owner_statement_summary` | rejected: "not a valid report" | n/a | n/a | n/a | No |

## What we learned

- **The fee is an expense on each owner's ledger.** It posts to account 5010 when the monthly "Post Management Fees" step runs, so the GL row date is the month the fee was charged. That is exactly what a trailing fee needs: "HDPM earned $X from this property in month M."
- **`general_ledger` is the right source.**
  - It has `post_date`, `debit` / `credit`, `property_integration_id`, `unit_id` and `txn_id`.
  - The fee for a property and month is **debit − credit** on account 5010; credits are reversals. The probe now nets them; the first run summed debits only, which matched `bill_detail` exactly, so September had no reversals of note.
- **The account is identified by its name.** `general_ledger` labels it `"5010 - Mgmt: Management Fee"`; `bill_detail` uses `account_name` `"Mgmt: Management Fee"` + `account_number` `5010`. Batch 6b should filter on number 5010, parsed from the name, rather than on text.
- **Most properties have one fee line a month.** A few have two (e.g. DeLaCruz 8th St Apartments, Moe's Village); multi-unit or mid-month adjustments are summed.
- **Scale is fine.** About 8,000 GL rows a month. One report call per month comfortably fits the 7-runs-per-15s limit and the 300s function limit.
- **The current KPI is still an estimate.** The dashboard's "management fees" (market rent × fee policy) remains an estimate. This GL source could replace it later. That's out of scope here, but worth noting.

## Before calling it final: reconcile one property

Pick a property whose September 2026 owner statement you have. Larger ones are easier to spot:
- Luderman Crossing: **$4,434.60**
- Reindeer Canyon: **$2,578.96**
- Hatch Townhomes: **$2,433.20**

Open `/api/partners/admin/spike/fee-income?month=2026-09&property=<name>`, then check that the line items and total equal the statement's management-fee line.
- **They match:** GO is final. Build Batch 6b.
- **They don't match:** send both numbers. Likely causes are timing (post date vs. statement period) or fees split across accounts; both are fixable in 6b.

## If GO: Batch 6b in one paragraph

A nightly cron (`withCronRun`, registered in `lib/routines/registry.ts`) runs `general_ledger` for the current and previous month. It keeps account 5010 rows and upserts `referral_property_fee_income (appfolio_property_id = property_integration_id, period = YYYY-MM, mgmt_fee_income = Σ debit − credit, source_report = 'general_ledger')`. Re-pulling the previous month catches late reversals. It writes only for properties linked to a referral lead (`referral_lead.appfolio_property_ids`) plus a control total, so we don't store fee data we don't use. Batch 7 then accrues `income × frozen trailing %` per lead and month into the ledger.
