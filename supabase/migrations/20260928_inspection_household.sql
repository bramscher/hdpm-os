-- NULL means not yet synced / unavailable; [] means no records in AppFolio.
ALTER TABLE inspection_properties
  ADD COLUMN IF NOT EXISTS financially_responsible_occupants text[],
  ADD COLUMN IF NOT EXISTS pets jsonb;
