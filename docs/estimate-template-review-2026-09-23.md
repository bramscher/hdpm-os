# Estimate template recommendations — September 23, 2026

## Recommendation

Build five estimate templates: **Quick unit turn**, **Full unit turn / extended occupancy**, **Rekey and access**, **Smoke/CO detector refresh**, and **Appliance replacement**. Make the last three reusable sections inside either turn template as well as standalone estimates. Staff should choose a template, fill quantities and scope, remove unnecessary lines, and add exceptions.

“Occupied more than two years” should prompt the fuller inspection checklist, not automatically select a price or require every replacement. The invoice records do not establish tenancy duration or support a reliable under/over-two-year pricing split.

## What was reviewed

Read-only snapshot of all 426 HDPM invoice-table records available on September 23, 2026, created February 26–September 23 (service dates can be earlier). This is the OS invoice history, not an audit of every bill in AppFolio.

- 396 generated invoices, 18 draft invoices, 11 void invoices, and one generated credit.
- 414 non-void invoices reference 388 distinct work-order numbers.
- 22 work-order numbers have multiple non-void invoices, containing 48 records. Eleven groups have multiple generated invoices; eleven contain a draft alongside a generated invoice.
- Grouping the numeric prefix before the work-order suffix produces 281 work-order families; 65 have more than one distinct child work order. Treat these as candidate combined jobs, not automatically as confirmed unit turns. Three examples below were checked against live work-order descriptions and unit identities.
- No saved estimate templates were returned from `estimate_template`.

For frequency counts, count a work-order number once even when it has several invoices. Descriptions and line-item text identify overlapping scope families: 133 work orders mention rekeying/cylinders/tenant keys; 79 mention smoke/CO detector work; 54 paint/wall repair; 37 caulking/resealing; 33 blinds/screens; 29 bulbs/fixtures; 11 filters. Forty invoice records describe whole-appliance procurement/replacement, including a hot plate and one zero-dollar draft. These are scope indicators, not mutually exclusive categories or approved price samples.

## Five proposed templates

### 1. Quick unit turn

**Use:** A unit in generally good condition, with a short repair list and limited touch-up work. Occupancy length alone does not decide this.

| Starting line | Staff fills in |
|---|---|
| Scope walk and completion check | Unit, rooms, photos, access, ready-by date |
| Minor wall repairs and paint touch-ups | Rooms, patch count/size, paint color, estimated hours |
| Kitchen/bath caulk touch-ups | Fixture/location, extent, estimated hours, materials |
| Adjust doors, cabinets, closet tracks and hardware | Locations, counts, replacement parts |
| Replace bulbs and furnace filter | Counts, bulb types, filter dimensions |
| Small item removal/disposal | Items, volume, disposal charge |
| Materials and consumables | Named items and quantities |

**Optional sections:** Rekey/access, smoke/CO devices, screens/blinds, appliance repair or replacement, vendor cleaning. Default major replacements to unselected.

**History to model:** Invoice 000228 / WO 42190-4 (appliance shelf, bulbs, filter, hook removal); 000343 / WO 42723-2 (windowsills, backsplash, paint, door stop); 000412 / WO 42891-2 (caulk, paint, toilet seat, cabinet adjustment). These are maintenance portions of turns, not verified all-inclusive turn totals.

### 2. Full unit turn / extended occupancy

**Use:** Broad work across multiple rooms, numerous worn components, or an inspection after extended occupancy. Display “2+ years: inspect full scope” as a prompt, with condition determining the selected work.

| Starting section | Staff fills in |
|---|---|
| Inspection and room-by-room scope | Beds/baths, rooms, condition, photos, target completion |
| Walls, ceilings, trim and doors | Repair area; touch-up versus full repaint per room |
| Kitchen and bathrooms | Caulk locations, seats, drain stops, faucets, fans, cabinet repairs |
| Doors, windows, screens and blinds | Location, dimensions, counts, repair versus replacement |
| Flooring and trim repairs | Location, material, area; separate vendor quote for major work |
| Bulbs, filters and hardware | Counts, sizes, finish, device/part specifications |
| Removal and disposal | Items, loads, disposal basis |
| Rekey/access section | Cylinders, keys, remotes, replacement hardware |
| Smoke/CO section | Device types, counts, locations and installation requirements |
| Optional appliance replacement | Selected appliances, model/dimensions, installation, haul-away |
| Optional vendor cleaning/painting/flooring | Quoted scope, vendor, amount; included once |
| Final punch list | Named remaining tasks and completion check |

Each selected task has a labor allowance and material allowance. Split owner work and proposed tenant-related work using line-level responsibility and notes for office review; do not infer chargeability from a template or a previous invoice.

**History to model:** Roda WO family 42634, Stovall family 42827, and Malick family 42892 below. These are strong examples of assembling one estimate from several related scopes.

### 3. Rekey and access

**Evidence:** 133 distinct work orders mention this scope. This is the largest repeat opportunity.

**Lines:** Applicable service-call charge; rekey cylinders × count; tenant keys × count; optional owner keys; optional doorknob/deadbolt replacement; optional garage remote/programming/battery.

**Blanks:** Lock brand/keyway, number of cylinders, number of keys, keyed-alike requirements, hardware finish, remote type, access instructions.

**Examples:** WO 42892-1 / invoice 000403; WO 42761-1 / invoice 000394. Existing descriptions already use a near-template format. Service charges must follow the approved price book and must not be duplicated when this section is part of a larger turn.

### 4. Smoke/CO detector refresh

**Evidence:** 79 distinct work orders mention detector work, sometimes combined with other repairs.

**Lines:** Inspection/testing; smoke detectors × count; CO detectors × count; combination devices × count; installation labor; optional batteries/adapters; final testing.

**Blanks:** Device location, model, power/interconnection requirements, reason for replacement, quantities and planned labor. Technician verifies the actual requirements and scope on site.

**Examples:** WO 42937-1 / invoice 000422; WO 42935-1 / invoice 000420; WO 42874-1 / invoice 000380. Do not copy an old device model automatically into a new estimate.

### 5. Appliance replacement

**Evidence:** 40 invoice records for whole-appliance procurement/replacement, including one unpriced draft. Several other invoices cover small appliance parts; those should remain optional repair lines, not full replacements.

**Lines:** Appliance cost and approved markup; delivery; installation; required cords/hoses/connectors; haul-away; optional additional technician/vendor work. If a supplier quote includes delivery/installation/haul-away, mark them included rather than charging them again.

**Blanks:** Appliance type, existing dimensions/model, proposed model/finish, supplier quote, availability, connection requirements, access, installation date, disposal plan.

**Examples:** WO 42893-1 / invoice 000424 (range); WO 42769-1 / invoice 000423 (microwave); WO 42634-8 / invoice 000418 (refrigerator).

## What related work orders reveal

These are recorded generated-invoice amounts, not approved template prices, proof of payment, or complete turn budgets. Additional cleaning, painting, flooring or external bills may be outside this history.

| Confirmed unit/job family | Generated invoice scopes | Recorded total |
|---|---|---:|
| Malick P 141 — 616 Cliffside, 42892 | Rekey 000403; remote 000426; owner repairs 000429; tenant-related repairs 000430 | $738.55 |
| Stovall 499-A, 42827 | Door hardware 000378; owner repairs 000381; tenant-related repairs 000382; refrigerator 000391; rekey 000398 | $1,505.75 |
| Roda 220, 42634 | Tenant-related repairs 000325; rekey/battery 000344; owner repairs 000361; refrigerator 000418 | $1,747.82 |

Roda also has draft 000365 for the same work order as generated invoice 000361. The draft is excluded from that family total. The source work orders confirm the same unit for each of these three families.

## Workflow and billing controls

1. Brody selects Quick or Full Turn and fills the inspection scope, locations, quantities and required date.
2. Alberto confirms labor allowances, material quantities and missing tasks before pricing is sent for approval.
3. Office reviews price, responsibility allocations, exclusions and owner approval requirements.
4. Approved work enters the scheduling queue with task-level estimated hours and materials readiness. Assign the scheduling owner explicitly; do not assume the estimator also books the calendar.
5. Technician records actual work and materials against the approved tasks. New scope becomes a reviewed addition.
6. Office invoices completed tasks, showing what was already billed and what remains. Preserve a common estimate/turn link across child work orders; allow split invoices when needed.

Show **existing invoices / credits / already billed tasks** before creating another invoice on a work order. A duplicate copy should prompt a choice of correction, additional work, or split scope. Keep revisions and credits linked instead of treating every invoice as another completed job.

## Pricing and data readiness

The current price book has useful building blocks such as `LABOR_STD`, `LABOR_2P`, `MATERIALS_CP`, `APPLIANCE_CP`, `SVC_MIN`, `TURN_INSPECT` and `COORD_MIN`. Turn package, cleaning, wall painting and haul-away entries are explicitly labeled **[PLACEHOLDER]**. Validate those prices before using them in owner-facing estimates.

Start with editable task allowances rather than a fixed “full turn” price. Historical invoices often bundle many tasks into one labor line, use different rates across time, and include flat-price rekey scopes. They do not reliably establish time per task or total elapsed job time. Do not derive measured hours simply by dividing charges by a rate.

Build order: Quick and Full Turn as the primary staff choices; reuse Rekey, Detector and Appliance sections inside them. The narrower sections can be calibrated first because their quantities and scope are more consistent. After a pilot, compare estimated versus confirmed actual labor/materials by task and revise the template defaults.

## Repeat-invoice review list

These are review candidates, not findings of duplicate payment. Do not void or merge without reviewing AppFolio, source documents, credits and intent. No records were changed during this review.

| Work order | Non-void invoice records | Review focus |
|---|---|---|
| 40844-1 | HDMS-INV-000008 (generated, $98.00); HDMS-INV-000028 (generated, $139.00) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 40746-4 | HDMS-INV-000015 (generated, $185.00); HDMS-INV-000019 (generated, $650.74); HDMS-INV-000036 (generated, $849.89) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 36796-1 | HDMS-INV-000018 (generated, $476.78); HDMS-INV-000020 (generated, $476.78); HDMS-INV-000034 (generated, $476.78) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 40904-1 | HDMS-INV-000023 (generated, $95.00); HDMS-INV-000029 (generated, $23.75); HDMS-INV-000031 (generated, $2863.50); HDMS-INV-000038 (generated, $170.00) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 40843-1 | HDMS-INV-000026 (generated, $95.00); HDMS-INV-000030 (draft, $142.50) | Draft and generated scope overlap; identify the current record. |
| 40857-1 | HDMS-INV-000037 (draft, $0.00); HDMS-INV-000039 (generated, $119.00) | Draft and generated scope overlap; identify the current record. |
| 40809-1 | HDMS-INV-000040 (draft, $0.00); HDMS-INV-000042 (generated, $448.36) | Draft and generated scope overlap; identify the current record. |
| 41811-1 | HDMS-INV-000109 (draft, $199.64); HDMS-INV-000168 (generated, $199.64) | Draft and generated scope overlap; identify the current record. |
| 42058-1 | HDMS-INV-000140 (generated, $78.10); HDMS-INV-000152 (generated, $84.03) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 42190-4 | HDMS-INV-000193 (draft, $0.00); HDMS-INV-000228 (generated, $264.43) | Draft and generated scope overlap; identify the current record. |
| 42114-3 | HDMS-INV-000199 (draft, $140.00); HDMS-INV-000200 (generated, $140.00) | Draft and generated scope overlap; identify the current record. |
| 42105-2 | HDMS-INV-000203 (draft, $510.00); HDMS-INV-000204 (generated, $600.76) | Draft and generated scope overlap; identify the current record. |
| 42269-3 | HDMS-INV-000221 (generated, $336.05); HDMS-INV-000221-1 (generated, $336.05) | Explicit duplicate copy with identical scope and $336.05 amount. |
| 42363-1 | HDMS-INV-000232 (draft, $0.00); HDMS-INV-000242 (generated, $129.00) | Draft and generated scope overlap; identify the current record. |
| 40851-1 | HDMS-INV-000237 (generated, $88.54); HDMS-INV-000238 (generated, $88.54) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 42248-1 | HDMS-INV-000247 (generated, $129.00); HDMS-INV-000248 (generated, $129.00) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 42443-2 | HDMS-INV-000272 (generated, $331.38); HDMS-INV-000289 (draft, $36.75) | Draft and generated scope overlap; identify the current record. |
| 42521-3 | HDMS-INV-000291 (generated, $228.76); HDMS-INV-000292 (generated, $262.15) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 42632-1 | HDMS-INV-000315 (generated, $222.33); HDMS-INV-000315-1 (generated, $100.00) | Original plus $100 variant; also inspect the newly created linked credit before drawing conclusions. |
| 42725-2 | HDMS-INV-000334 (generated, $206.45); HDMS-INV-000340 (generated, $188.42) | Multiple generated records; distinguish additional work from corrections/duplicates. |
| 42634-4 | HDMS-INV-000361 (generated, $526.02); HDMS-INV-000365 (draft, $212.50) | Draft and generated scope overlap; identify the current record. |
| 42865-2 | HDMS-INV-000411 (draft, $203.75); HDMS-INV-000427 (generated, $244.84) | Draft and generated scope overlap; identify the current record. |
