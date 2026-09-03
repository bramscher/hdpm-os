-- Slice 0 price-book seed (placeholder). Run once after 20260904 migration.
--
-- Rates from spec §6.2 launch defaults, with labor at the CURRENT $95/hr (not
-- the spec's stale $85). Cleaning / painting / flooring prices are PLACEHOLDERS
-- pending the real vendor schedules (spec §18.8) — replace via the price-book
-- admin UI (reprice) before real use.

INSERT INTO price_book_item
  (item_code, category, name, owner_description, pricing_method, base_price,
   included_minutes, increment_minutes, increment_price, standard_minutes, uom,
   markup_pct, markup_eligible, tenant_alloc_eligible, gl_code, effective_from, created_by)
VALUES
  ('TURN_INSPECT', 'inspection', 'Turn inspection & scope',
   'Move-out inspection and scope of make-ready work', 'flat', 150,
   NULL, NULL, NULL, 60, 'each', NULL, false, false, NULL, CURRENT_DATE, 'system:seed'),

  ('COORD_MIN', 'coordination', 'Turn coordination minimum',
   'Coordination of make-ready work', 'flat', 150,
   NULL, NULL, NULL, 60, 'each', NULL, false, false, NULL, CURRENT_DATE, 'system:seed'),

  ('SVC_MIN', 'handyman', 'Standard service-call minimum',
   'Standard maintenance visit (up to 1 hour on site)', 'service_min', 125,
   60, 15, 21.25, 60, 'visit', NULL, false, true, NULL, CURRENT_DATE, 'system:seed'),

  ('LABOR_STD', 'handyman', 'Standard labor (hourly)',
   'Maintenance labor', 'hourly', 95,
   NULL, NULL, NULL, 60, 'hour', NULL, false, true, NULL, CURRENT_DATE, 'system:seed'),

  ('LABOR_2P', 'handyman', 'Two-person labor (hourly)',
   'Two-technician labor', 'hourly', 170,
   NULL, NULL, NULL, 60, 'hour', NULL, false, true, NULL, CURRENT_DATE, 'system:seed'),

  ('AFTER_HOURS_MIN', 'handyman', 'After-hours emergency minimum',
   'After-hours emergency visit minimum', 'service_min', 250,
   60, 15, 35.63, 60, 'visit', NULL, false, false, NULL, CURRENT_DATE, 'system:seed'),

  ('CLEAN_STD', 'cleaning', 'Standard turn clean [PLACEHOLDER]',
   'Full make-ready cleaning', 'flat', 250,
   NULL, NULL, NULL, 180, 'each', NULL, false, true, NULL, CURRENT_DATE, 'system:seed'),

  ('PAINT_WALL', 'painting', 'Wall paint per room [PLACEHOLDER]',
   'Repaint per room', 'per_qty', 120,
   NULL, NULL, NULL, 120, 'room', NULL, false, true, NULL, CURRENT_DATE, 'system:seed'),

  ('HAUL_LOAD', 'haul', 'Haul-away per load [PLACEHOLDER]',
   'Debris/abandoned-property removal per load', 'per_qty', 95,
   NULL, NULL, NULL, 30, 'load', NULL, false, true, NULL, CURRENT_DATE, 'system:seed'),

  ('APPLIANCE_CP', 'appliances', 'Appliance (cost + markup)',
   'Appliance supplied at cost plus markup', 'cost_plus', 0,
   NULL, NULL, NULL, NULL, 'each', 10, true, true, NULL, CURRENT_DATE, 'system:seed'),

  ('MATERIALS_CP', 'materials', 'Materials (cost + markup)',
   'Materials supplied at cost plus markup', 'cost_plus', 0,
   NULL, NULL, NULL, NULL, 'each', 25, true, true, NULL, CURRENT_DATE, 'system:seed'),

  ('PKG_STD_TURN', 'handyman', 'Standard maintenance turn package [PLACEHOLDER]',
   'Up to 4 hours make-ready labor; materials additional', 'package', 450,
   240, 15, 21.25, 240, 'each', NULL, false, false, NULL, CURRENT_DATE, 'system:seed')
ON CONFLICT DO NOTHING;
