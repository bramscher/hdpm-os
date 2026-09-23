# Maintenance estimate templates

Published September 23, 2026 to the existing `estimate_template` store through `maintenance_template_publish`, under Craig's authorized request. All five templates were read back and verified. Source payloads are in `maintenance-templates-2026-09-23.json`; the invoice review and recommendations are in `../estimate-template-review-2026-09-23.md`.

| Template | Version | Saved ID |
|---|---|---|
| Quick unit turn | 1 | 3198b447-0373-486b-9897-e71b615c4bbd |
| Full unit turn / extended occupancy (2+ years) | 1 | c63d0668-65a4-423f-92fe-19c3823ad068 |
| Rekey & access | 1 | 2668628e-e6d4-444b-a815-7637da9be504 |
| Smoke / CO detector refresh | 1 | 800a2179-b0ee-4bb5-9cc0-7a0bdef40e1f |
| Appliance replacement | 1 | d6e51a54-28e2-4327-97fb-6759ec720548 |

## Staff use

Open Work & Billing → Estimates → Start from template / price book. Connect the work order, then select a template before editing.

- All rows start as optional, unchecked scope. Select **Include in charge** for the work required.
- Replace description blanks with actual quantities, specifications and locations. Enter estimated **minutes** for each hourly labor line; a blank hourly time otherwise falls back to the row quantity in the current pricing engine.
- Enter **total direct cost for the row** in Material $, not unit cost; the current cost-plus pricing engine applies markup to that entered total. Use separate lines for distinct items when helpful.
- Current approved price-book items supply labor rates and material/appliance markups. No placeholder price-book items or assumed labor durations were inserted into these templates.
- Instruction/checklist rows without a price-book item remain unchecked. To charge a vendor scope, select an approved pricing item and enter its reviewed amount/scope.
- Do not duplicate delivery, installation or haul-away already included in the supplier's appliance quote. Do not repeat the same labor in multiple sections.
- The Quick and Full Turn templates contain optional access, detector and appliance rows. Full Turn uses actual condition to determine scope; 2+ years is an inspection prompt, not an automatic price or replacement decision.
- Save a draft for Brody/Alberto scope and quantity review before office/owner approval and scheduling. Creating these templates did not issue or send an estimate.

The templates can be revised through the existing **Publish revision** control. The JSON is a version-one backup, not an instruction to overwrite later live revisions. Use the existing family/version conflict checks when publishing changes.
