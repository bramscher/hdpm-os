-- Add Maupin (Wasco County) to Rent Comps without changing existing comp data.
BEGIN;

ALTER TABLE public.rental_comps
  DROP CONSTRAINT IF EXISTS rental_comps_town_check;
ALTER TABLE public.rental_comps
  ADD CONSTRAINT rental_comps_town_check
  CHECK (town IN ('Bend', 'Redmond', 'Sisters', 'Prineville', 'Culver', 'La Pine', 'Maupin'));

-- FY2026 HUD FMR for Wasco County, OR (huduser.gov entity 4106599999).
INSERT INTO public.market_baselines (area_name, county, bedrooms, fmr_rent, data_year, source)
VALUES
  ('Maupin', 'Wasco', 0, 1281, 2026, 'hud_fmr'),
  ('Maupin', 'Wasco', 1, 1289, 2026, 'hud_fmr'),
  ('Maupin', 'Wasco', 2, 1600, 2026, 'hud_fmr'),
  ('Maupin', 'Wasco', 3, 2225, 2026, 'hud_fmr'),
  ('Maupin', 'Wasco', 4, 2589, 2026, 'hud_fmr')
ON CONFLICT (area_name, bedrooms, data_year) DO NOTHING;

COMMIT;
