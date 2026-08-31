> **STATUS: HISTORICAL / partly-stale.** The original KPI spec (references the old repo name `hdpm-webchat` and a QuickBooks data source that is not wired up). Partly realized as the live `/dashboard` (18 KPIs from AppFolio + financials, `kpi_snapshots`). Kept for the metric definitions; verify against the live dashboard before relying on it. See `docs/README.md`.

HDPM Dashboard — KPI & Reporting Spec

Repo: hdpm-webchat  ·  Data sources: AppFolio Property Manager Reporting API + QuickBooks Online/Payroll API (+ small manual-config layer)
Purpose: Define every KPI the owner dashboard should show — the standard operating metrics plus the new KPIs that track the growth strategy (in‑house maintenance capture, door/Bend growth, retention, and progress to $1M net income / $500K owner cash flow).

> Hand this to Claude Code as the implementation brief. Report/endpoint names below are the intended AppFolio sources — confirm exact report names and field keys against the live AppFolio Reporting API for this database before wiring them up (AppFolio occasionally renames report columns).

***
1. AppFolio Reporting API — integration notes

Pattern: AppFolio exposes standard reports as JSON endpoints, typically:
  GET https://{DATABASE}.appfolio.com/api/v1/reports/{report_name}.json?paginate_results=true&...filters
Auth: HTTP Basic with the API client ID + secret (the "AppFolio API" credentials Craig has). Store as repo secrets / env vars (APPFOLIO_DB, APPFOLIO_CLIENT_ID, APPFOLIO_CLIENT_SECRET). Never commit.
Pagination: follow next_page_url until null. Most reports accept date-range and property/portfolio filters as query params.
Refresh: nightly batch into a local cache/DB table per report; the dashboard reads the cache (don't hit the API on every page load). Add a manual "refresh now" action.
Rate limits: batch + cache; back off on 429.

Reports this dashboard depends on (confirm names)
Intended report	Feeds
rent_roll	doors, rent, occupancy, city/Bend mix, fee-per-door
unit_directory / property_directory	unit + property address → city tagging
unit_vacancy_detail	vacancy, days-on-market
lease_tickler / lease_expiration	upcoming expirations, renewals
delinquency / aged_receivables_detail	delinquency rate
work_order (service requests)	maintenance volume, age, turn time, labor
bill_detail / payable / vendor_ledger	maintenance $ to vendors → the ~$1.8M, split by GL acct & vendor
income_statement (cash flow)	revenue, expenses, NOI
balance_sheet	cash, trust balances
management_fees (or GL fee accounts)	fee revenue per door
owner_directory	owner count, churn
	Secondary source: QuickBooks Online / Payroll API (already connected)
QuickBooks is the accounting + payroll system of record and supplies the people data AppFolio does not. Confirmed available via the QBO API:
Headcount & roster (employees) — active/terminated status, salary vs hourly, pay rate. → headcount, doors/employee denominator.
Wages & loaded cost (payroll/employees, last_payroll_run, payslips) — base rate + employer taxes, workers' comp, benefits. → compute true loaded $/hr for the maintenance-margin KPIs (don't assume it).
Paid hours per pay period (last_payroll_run / payslips) — regular, OT, holiday, sick, vacation, commission, mileage, each with hours. → the denominator for technician utilization.
Turnover — derive from employee active→terminated transitions over time. ⚠️ In the current data the termination_date field is null even for terminated employees; to get a clean turnover rate, populate termination dates in QuickBooks (otherwise only point-in-time active vs terminated counts are possible).
Financials (income statement, balance sheet) are also available from QBO if you prefer the accounting source of record over AppFolio's property-level financials — pick one per metric and keep it consistent.

Genuinely manual (small config layer)
Loan terms (rate, term, payment, amortization) → debt service & DSCR.
GM salary & owner-draw targets, KPI targets/thresholds.
In-house vs outsourced flag on maintenance → derive from an internal "High Desert" vendor record or a GL/category tag. Define this early; it powers the in‑house capture KPI.
Time-to-fill (recruiting) → manual or ATS.

> Technician utilization is a cross-system join: billable hours (AppFolio work-order labor) ÷ paid hours (QuickBooks Payroll). Neither system has both halves — the dashboard must join them on employee.

***
2. KPI catalog

Legend: ★ NEW = new strategic KPI introduced by the growth plan. Cadence = dashboard refresh granularity.

A. Owner cash flow & profitability — tracks the $500K / $1M goals
KPI	Definition / formula	AppFolio source	Cadence	Target
Revenue (TTM & MoM)	Total operating income, trailing 12 mo and by month	income_statement	Monthly	↑ to ~$1.85–2.2M
Operating expenses	Total opex (ex‑debt principal)	income_statement	Monthly	hold % as rev grows
Net Operating Income	Revenue − opex	income_statement	Monthly	$1.0M
Net income margin %	NOI ÷ revenue	computed	Monthly	~50%
Owner distributable cash ★	NOI − annual debt service − GM cost	computed (config for debt+GM)	Monthly	$500K
Debt service coverage (DSCR) ★	NOI ÷ annual debt service (P&I)	computed (config)	Monthly	> 1.5×
Progress to $1M (gauge) ★	NOI ÷ $1,000,000	computed	Monthly	100%
Cash on hand / trust vs operating	Operating cash; trust liability balance	balance_sheet	Daily	n/a
	B. Portfolio & door growth — Pillar 1 & 5
KPI	Definition / formula	AppFolio source	Cadence	Target
Doors under management	Count of active managed units	rent_roll	Daily	+150 over 18–24 mo
Net door change (MoM)	New managed units − terminated	rent_roll deltas / mgmt start dates	Monthly	net positive every month
Bend mix % ★	Bend units ÷ total units (tag unit by property city)	rent_roll + unit_directory city field	Daily	~1/3 → ~1/2
Avg rent per unit	Mean scheduled rent; also Bend vs non‑Bend	rent_roll	Monthly	track Bend premium
Avg management fee per door	Mgmt fee revenue ÷ doors	management_fees ÷ doors	Monthly	↑ with Bend mix
Revenue per door	TTM revenue ÷ doors	computed	Monthly	↑
Owner count & churn %	Active owners; owners lost ÷ owners (TTM)	owner_directory	Monthly	churn < 10%
	C. Leasing & occupancy
KPI	Definition / formula	AppFolio source	Cadence	Target
Occupancy %	Occupied ÷ total units	rent_roll / unit_vacancy_detail	Daily	> 95%
Vacant units	Count vacant	unit_vacancy_detail	Daily	minimize
Avg days-to-lease	Mean days on market for leased units	unit_vacancy_detail	Weekly	< market
Lease expirations 30/60/90	Count expiring in window	lease_tickler	Weekly	manage ahead
Renewal rate %	Renewed ÷ expiring	lease_tickler history	Monthly	> 70%
Delinquency rate %	Past-due rent ÷ scheduled rent	delinquency / aged_receivables_detail	Daily	< 3%
	D. Maintenance — Pillar 2, includes the new in-house economics
KPI	Definition / formula	AppFolio source	Cadence	Target
Open work orders & avg age	Count open; mean days open	work_order	Daily	age ↓
Work orders completed (MoM)	Count closed per month	work_order	Monthly	n/a
Avg close / turn time	Mean days open→closed	work_order	Weekly	↓
Total maintenance spend (TTM) ★	Σ vendor bills on maintenance GL accounts (verifies the ~$1.8M)	bill_detail / vendor_ledger filtered to maint accts	Monthly	baseline
In-house vs outsourced split ★	Maint $ where vendor = internal vs external	bill_detail + internal-vendor flag	Monthly	in‑house share ↑
Labor vs materials split ★	Maint $ by GL (labor vs materials accounts)	bill_detail by GL account	Monthly	sizing input
Spend by trade/category ★	Maint $ grouped by category (general/turn vs specialty)	work_order category / GL	Monthly	identify addressable
In-house capture rate % ★	In‑house maintenance margin ÷ total maintenance volume	computed	Monthly	toward ~$200K/yr
Gross margin per work order ★	(Billed − loaded labor − materials) ÷ work order	AppFolio work_order billed + labor hrs × QuickBooks loaded $/hr	Monthly	positive & rising
Billable rate vs loaded cost ★	Avg billable $/hr − loaded tech $/hr (margin/hr)	AppFolio billed labor + QuickBooks Payroll loaded cost	Monthly	rate ≥ $65–95/hr
Avg cost per work order / per unit	Maint $ ÷ work orders; ÷ doors	computed	Monthly	watch outliers
	> Rate-card alert (build as a flag): if average billable labor rate < $56/hr (break-even) or < loaded senior-tech cost ($41.50/hr), surface a red warning. This is a known current issue.

E. People & retention — the binding constraint for Pillars 2–4
KPI	Definition / formula	Source	Cadence	Target
Headcount (total & services)	Active employees; maintenance/services subset	QuickBooks Payroll (employees)	Monthly	n/a
Technician utilization % ★	Billable hours ÷ paid hours	AppFolio work_order labor hrs ÷ QuickBooks Payroll paid hrs (join on employee)	Weekly	~72%+
Technician turnover (TTM) ★	Services separations ÷ avg services headcount	QuickBooks Payroll (employee status + termination dates)	Monthly	minimize
Time-to-fill open roles	Days posting→hire	manual / ATS	per hire	↓
Doors per employee ★	AppFolio doors ÷ QuickBooks headcount	computed (join)	Monthly	↑ (automation)
	F. Ancillary services (phase 2 — landscaping & cleaning)
KPI	Definition / formula	Source	Cadence	Target
Ancillary revenue & margin	Revenue and gross margin by service line	income_statement / GL once launched	Monthly	+$50–100K
Services team cross-utilization % ★	% of services hours across maint/turn/clean/landscape	work-order labor by category	Monthly	high & year-round
	***
3. Suggested dashboard layout

Top strip — Owner goals: three gauges — Net Income → $1M, Owner cash → $500K, DSCR. Plus revenue TTM and cash on hand.
Growth row: Doors under management (with net-change sparkline), Bend mix % vs target, revenue/door, owner churn.
Operations row: occupancy, avg days-to-lease, delinquency, open work orders & avg age.
Maintenance economics panel (new): total maint spend, in-house vs outsourced, labor/materials split, in-house capture $, gross margin/work order, rate-card flag.
People panel (new): technician utilization, services turnover, doors/employee.
Config drawer: loan terms, GM cost, owner-draw target, internal-vendor flag, KPI targets — all editable, feed the computed KPIs.

4. Build order (recommended)
Wire rent_roll + income_statement + balance_sheet → Section A & B core (immediate value, verifies door count & Bend mix).
Add bill_detail/vendor_ledger + internal-vendor flag → Section D maintenance economics (verifies the $1.8M, powers in-house capture).
Add QuickBooks Payroll feed (headcount, loaded wages, paid hours, turnover) → Section E, plus true loaded $/hr for Section D margins. Join to AppFolio work-order labor hours for utilization.
Layer the config drawer + computed owner-cashflow KPIs (A) last, since they depend on manual inputs.

5. Open items to confirm before coding
Exact AppFolio report names + field keys for this database (especially vendor/bill detail and work-order labor hours).
Whether technician labor hours are logged in AppFolio work orders (enables utilization & margin/WO without a separate time system).
The internal-vendor / in-house identifier so maintenance can be split in-house vs outsourced.
City field reliability for Bend tagging (use property address city; handle Redmond/Sisters/etc. grouping rules).
