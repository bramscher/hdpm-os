-- Add La Pine to Rent Comps without changing existing comp data.
BEGIN;

ALTER TABLE public.rental_comps
  DROP CONSTRAINT IF EXISTS rental_comps_town_check;
ALTER TABLE public.rental_comps
  ADD CONSTRAINT rental_comps_town_check
  CHECK (town IN ('Bend', 'Redmond', 'Sisters', 'Prineville', 'Culver', 'La Pine'));

-- HUD FMR is county-wide. Reuse the existing Deschutes County HUD values,
-- preserving their year/source; never copy Bend's city-specific median rent.
INSERT INTO public.market_baselines (area_name, county, bedrooms, fmr_rent, data_year, source)
SELECT 'La Pine', county, bedrooms, fmr_rent, data_year, source
FROM public.market_baselines
WHERE area_name = 'Bend' AND county = 'Deschutes' AND source = 'hud_fmr'
ON CONFLICT (area_name, bedrooms, data_year) DO NOTHING;

COMMIT;
