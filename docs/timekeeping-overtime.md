# Overtime and emergency payroll hours

Researched September 16, 2026. Applies to ordinary private-sector work recorded in HDPM Timekeeping. Public works, government contracts and other special industry rules require a separate review.

Oregon generally requires at least 1.5 times the regular rate after 40 actual worked hours in a fixed workweek. HDPM uses Sunday through Saturday in Pacific time. Paid leave does not count toward that threshold; paid rest breaks remain worked time. Salary alone does not establish exemption. All timekeeping employees default to overtime eligible; an admin can record a confirmed exemption and its basis in Payroll setup. Sources: [BOLI overtime](https://www.oregon.gov/boli/employers/pages/overtime.aspx), [BOLI exemption tests](https://www.oregon.gov/boli/employers/pages/salaried-exempt-employees.aspx).

Craig authorized a company policy on September 16, 2026: after-hours emergency work receives 1.5× even below 40 weekly hours. This includes actual emergency phone work. It is a company premium, not a general Oregon requirement for all night or weekend work. Record the eligible work as a separate interval and select **After-hours emergency work · 1.5×**. The existing emergency-day flags are descriptive; a flagged day requires an explicit interval classification before payroll export. A whole regular shift must not be marked just because one emergency occurred that day. Source: [US DOL overtime guidance](https://www.dol.gov/general/topic/wages/overtimepay).

The allocation is chronological within each workweek. Emergency hours count toward 40. Weekly overtime plus emergency hours outside weekly overtime comprise the total hours payable at 1.5×. The same hour is counted once. Emergency premium hours on a different part of the week are not credited against separate weekly overtime hours. Compensable on-call restrictions require individual assessment; simply carrying an emergency phone is not automatically a marked work interval. Sources: [DOL regular-rate guidance](https://www.dol.gov/agencies/whd/fact-sheets/56a-regular-rate), [BOLI paid time](https://www.oregon.gov/boli/workers/pages/paid-time.aspx).

## Pay-period boundaries

The counter does not reset on the 1st or 16th. New exports freeze approved prior-period timecards needed for the opening workweek. Those prior hours establish the counter and are not paid again. A partial week at the end continues in the next period. Payroll must finalize the full-week regular rate and monetary adjustments when the week closes.

If prior records are absent or unapproved, an admin must enter **Opening workweek hours** from the prior payroll record, with a source note. The figure covers all actual work from that Sunday through the day before this pay period, including emergency work and excluding leave. Zero requires affirmative confirmation. Once complete approved prior timecards exist, they supersede a manual opening. Missing information blocks a new export rather than silently becoming zero.

## Excel package

Summary and Daily detail distinguish regular work, weekly overtime, and additional emergency hours. **Total hours at 1.5× (included)** is a subtotal, not additional work. **Weekly overtime** provides the opening counter, this-period work, full-week work known so far, emergency overlap and source note. The original signature, manager approval, leave, miles and timestamp evidence remain available. Old saved snapshots remain unchanged; legacy downloads identify that overtime was not calculated and require a new export for the new categories.

This remains an hours report, not a wage-payment engine. No employee pay rates are stored in Timekeeping. Payroll must use the applicable regular rate, required nondiscretionary bonuses, differentials, multiple rates and the salary agreement to calculate dollar wages. Payroll must also verify whether the emergency premium qualifies for exclusion from the regular rate under federal rules. This implementation does not calculate taxes, net pay, mileage reimbursement amounts or property chargebacks.

## Deployment

Apply [20260916_timekeeping_overtime.sql](../supabase/migrations/20260916_timekeeping_overtime.sql) after the existing timekeeping migrations, then deploy the application. The migration adds the eligibility column, private audited opening-hours storage and private functions. A serialized insert trigger validates and freezes overtime context into new immutable export snapshots. It does not rewrite signed timecards or saved exports. The new application refuses new exports until this migration is present. Existing saved files remain downloadable.

Validation: unit tests cover the 40-hour threshold, leave/break treatment, emergency overlap, separate emergency premiums, salary eligibility, split pay periods, missing opening records, DST elapsed time and workbook reconciliation. PostgreSQL tests cover migration replay, permissions, audit, stale writes, export gating and immutable context.
