-- ============================================
-- Field time, step 1: stop locations, field days and their segments
-- Date: 2026-10-29
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- Where a tech's paid day went, built from location evidence (docs/field-location-app-plan.md).
-- Step 1 builds days from hand-entered sample days. The iPhone app (step 2) adds the raw points
-- table, its upload endpoint and a 30-day purge together, so raw location never exists without
-- its purge. Segments never store coordinates: only location, property and work order references.
--
--   supplier        existing parts-order providers; gains version/updated_* for editing
--   field_place     stop locations (stores, dumps, the shop) with a match radius
--   field_day       one per tech, date and source (device | sample)
--   field_segment   the day's timeline; suggested by the server, confirmed by the tech or admin
--   field_time_apply(actor, request)  every write, with version checks and an audit row
-- ============================================

BEGIN;

ALTER TABLE supplier ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
INSERT INTO supplier(name) VALUES ('Parr Lumber'), ('Sherwin-Williams'), ('Miller Paint')
ON CONFLICT (org_id, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS field_place (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL DEFAULT 'hdpm',
  kind text NOT NULL CHECK (kind IN ('store', 'dump', 'shop', 'other')),
  supplier_id uuid REFERENCES supplier(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  address text NOT NULL DEFAULT '',
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m integer NOT NULL CHECK (radius_m BETWEEN 30 AND 1000),
  active boolean NOT NULL DEFAULT true,       -- deactivated, never deleted: segments point here
  version integer NOT NULL DEFAULT 1,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- Geocoded from the street address with Google (lib/inspection-geocode.ts) and checked on a map.
INSERT INTO field_place (kind, supplier_id, name, address, latitude, longitude, radius_m)
SELECT v.kind, (SELECT s.id FROM supplier s WHERE s.org_id = 'hdpm' AND s.name ILIKE v.provider ORDER BY s.created_at LIMIT 1),
       v.name, v.address, v.lat, v.lng, v.radius
FROM (VALUES
  ('shop',  NULL,                'Shop / office',            '1515 SW Reindeer Ave, Redmond, OR 97756', 44.256798,  -121.184346, 150),
  ('store', 'Lowe''s%',          'Lowe''s Redmond',          '1313 SW Canal Blvd, Redmond, OR 97756',   44.2656614, -121.1775335, 200),
  ('store', 'Lowe''s%',          'Lowe''s Bend',             '20501 Cooley Rd, Bend, OR 97701',         44.1083064, -121.2985835, 200),
  ('store', 'Home Depot%',       'Home Depot Redmond',       '300 NW Quince Ave, Redmond, OR 97756',    44.297463,  -121.1705412, 200),
  ('store', 'Home Depot%',       'Home Depot Bend',          '63465 N Hwy 97, Bend, OR 97703',          44.1052798, -121.3002401, 200),
  ('store', 'Ferguson%',         'Ferguson Bend',            '61390 S Hwy 97, Bend, OR 97702',          44.0290965, -121.3112976, 200),
  ('store', 'Parr Lumber%',      'Parr Lumber Bend',         '1311 SE Wilson Ave, Bend, OR 97702',      44.0434532, -121.287976,  200),
  ('store', 'Sherwin-Williams%', 'Sherwin-Williams Redmond', '2835 SW 17th Pl, Redmond, OR 97756',      44.2503795, -121.1882334, 200),
  ('store', 'Miller Paint%',     'Miller Paint Redmond',     '641 NW Fir Ave, Redmond, OR 97756',       44.2813646, -121.1751456, 200),
  ('dump',  NULL,                'Negus Transfer Station',   '2400 NE Maple Ave, Redmond, OR 97756',    44.2903986, -121.142505,  250),
  ('dump',  NULL,                'Knott Landfill',           '61050 SE 27th St, Bend, OR 97702',        44.0166378, -121.252746,  250)
) AS v(kind, provider, name, address, lat, lng, radius)
ON CONFLICT (org_id, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS field_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL DEFAULT 'hdpm',
  technician text NOT NULL REFERENCES staff(person),
  work_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('device', 'sample')),
  sample_spec jsonb CHECK (source <> 'sample' OR jsonb_typeof(sample_spec) = 'object'),
  version integer NOT NULL DEFAULT 1,         -- every write checks and bumps it
  built_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (technician, work_date, source)
);

CREATE TABLE IF NOT EXISTS field_segment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES field_day(id) ON DELETE CASCADE,
  technician text NOT NULL REFERENCES staff(person),
  work_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('on_site', 'inspection', 'parts_run', 'dump_run', 'shop', 'drive', 'stop', 'no_data', 'break')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  place_id uuid REFERENCES field_place(id),
  appfolio_property_id text,
  appfolio_unit_id text,
  property_label text NOT NULL DEFAULT '',
  inspection_stop_id uuid,                    -- route_stops.id; no FK so deleting a route keeps history
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allocations) = 'array'),  -- [{work_order_id, percent}]
  label text CHECK (label IS NULL OR label IN ('general', 'personal', 'estimate', 'other_work', 'phone_off')),
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(candidates) = 'array'),
  suggestion jsonb,                           -- what the server suggested, kept when confirmed
  state text NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested', 'confirmed')),
  note text NOT NULL DEFAULT '',
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at > started_at)
);
CREATE INDEX IF NOT EXISTS field_segment_day_idx ON field_segment (day_id);
CREATE INDEX IF NOT EXISTS field_segment_tech_date_idx ON field_segment (technician, work_date);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['field_place', 'field_day', 'field_segment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Service role full access to ' || t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', 'Service role full access to ' || t, t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- A job split: existing work orders, each once, whole percentages that add up to 100. Empty is allowed.
CREATE OR REPLACE FUNCTION field_time_check_allocations(a jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE e jsonb; total integer := 0; ids text[] := '{}'; wid text; pct numeric;
BEGIN
  IF a IS NULL OR jsonb_typeof(a) <> 'array' THEN RAISE EXCEPTION 'A job split must be a list'; END IF;
  IF jsonb_array_length(a) = 0 THEN RETURN; END IF;
  IF jsonb_array_length(a) > 10 THEN RAISE EXCEPTION 'Split across at most 10 jobs'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(a) LOOP
    wid := e->>'work_order_id';
    IF wid IS NULL OR wid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR NOT EXISTS (SELECT 1 FROM work_orders WHERE id = wid::uuid) THEN
      RAISE EXCEPTION 'Choose a work order from the list';
    END IF;
    IF wid = ANY(ids) THEN RAISE EXCEPTION 'Each job can appear once in a split'; END IF;
    IF jsonb_typeof(e->'percent') <> 'number' THEN RAISE EXCEPTION 'Split percentages must be numbers'; END IF;
    pct := (e->>'percent')::numeric;
    IF pct <> floor(pct) OR pct < 1 OR pct > 100 THEN RAISE EXCEPTION 'Split percentages must be whole numbers from 1 to 100'; END IF;
    ids := ids || wid;
    total := total + pct::integer;
  END LOOP;
  IF total <> 100 THEN RAISE EXCEPTION 'The split must add up to 100%%'; END IF;
END $$;

CREATE OR REPLACE FUNCTION field_time_apply(actor text, request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  who staff; is_admin boolean; is_office boolean; op text := request->>'op';
  d field_day; s field_segment; pl field_place; sp supplier;
  prior jsonb; result jsonb; details jsonb; entity uuid; e jsonb; n integer := 0;
  new_kind text; new_label text; new_alloc jsonb; stop_kinds text[] := ARRAY['on_site', 'inspection', 'shop', 'stop'];
BEGIN
  SELECT * INTO who FROM staff WHERE lower(email) = lower(actor) AND active LIMIT 1;
  IF who.person IS NULL OR who.access_role IN ('read_only', 'inspector', 'front_desk') THEN RAISE EXCEPTION 'FORBIDDEN: active staff required'; END IF;
  is_admin := who.access_role = 'admin';
  is_office := who.access_role IN ('admin', 'manager', 'pm', 'maintenance', 'finance')
    OR (who.access_role = 'staff' AND lower(who.email) IN ('cheryl@highdesertpm.com', 'penny@highdesertpm.com'));

  IF op = 'replace' THEN
    -- Server-computed suggestions for a whole day; confirmed segments stay exactly as they are.
    IF NOT is_admin THEN RAISE EXCEPTION 'FORBIDDEN: only an admin can rebuild a field day'; END IF;
    IF coalesce(request->>'source', '') NOT IN ('device', 'sample') THEN RAISE EXCEPTION 'Unknown field day source'; END IF;
    IF NOT EXISTS (SELECT 1 FROM staff WHERE person = request->>'technician' AND active) THEN RAISE EXCEPTION 'Active technician required'; END IF;
    IF (request->>'work_date')::date > (now() AT TIME ZONE 'America/Los_Angeles')::date THEN RAISE EXCEPTION 'A field day cannot be in the future'; END IF;
    IF jsonb_typeof(request->'segments') <> 'array' OR jsonb_array_length(request->'segments') > 300 THEN RAISE EXCEPTION 'Invalid segments'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('field_day:' || (request->>'technician') || ':' || (request->>'work_date') || ':' || (request->>'source')));
    SELECT * INTO d FROM field_day WHERE technician = request->>'technician' AND work_date = (request->>'work_date')::date AND source = request->>'source' FOR UPDATE;
    IF d.id IS NULL THEN
      IF coalesce((request->>'version')::integer, 0) <> 0 THEN RAISE EXCEPTION 'CONFLICT: reload the changed day'; END IF;
      IF request->>'source' = 'sample' AND jsonb_typeof(request->'sample_spec') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A sample day needs its stops'; END IF;
      INSERT INTO field_day (technician, work_date, source, sample_spec, created_by)
      VALUES (request->>'technician', (request->>'work_date')::date, request->>'source', CASE WHEN request->>'source' = 'sample' THEN request->'sample_spec' END, actor)
      RETURNING * INTO d;
    ELSE
      IF d.version IS DISTINCT FROM (request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload the changed day'; END IF;
      IF d.source = 'sample' AND jsonb_typeof(request->'sample_spec') = 'object' THEN UPDATE field_day SET sample_spec = request->'sample_spec' WHERE id = d.id; END IF;
    END IF;
    DELETE FROM field_segment WHERE day_id = d.id AND state = 'suggested';
    FOR e IN SELECT * FROM jsonb_array_elements(request->'segments') LOOP
      PERFORM field_time_check_allocations(coalesce(e->'allocations', '[]'::jsonb));
      IF ((e->>'started_at')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date NOT BETWEEN d.work_date - 1 AND d.work_date + 1 THEN RAISE EXCEPTION 'A segment falls outside its day'; END IF;
      IF EXISTS (SELECT 1 FROM field_segment c WHERE c.day_id = d.id AND c.state = 'confirmed'
                 AND tstzrange(c.started_at, c.ended_at) && tstzrange((e->>'started_at')::timestamptz, (e->>'ended_at')::timestamptz)) THEN
        RAISE EXCEPTION 'CONFLICT: a suggestion overlaps confirmed time';
      END IF;
      INSERT INTO field_segment (day_id, technician, work_date, kind, started_at, ended_at, place_id, appfolio_property_id, appfolio_unit_id,
                                 property_label, inspection_stop_id, allocations, label, candidates)
      VALUES (d.id, d.technician, d.work_date, e->>'kind', (e->>'started_at')::timestamptz, (e->>'ended_at')::timestamptz,
              nullif(e->>'place_id', '')::uuid, nullif(e->>'appfolio_property_id', ''), nullif(e->>'appfolio_unit_id', ''),
              coalesce(e->>'property_label', ''), nullif(e->>'inspection_stop_id', '')::uuid,
              coalesce(e->'allocations', '[]'::jsonb), nullif(e->>'label', ''), coalesce(e->'candidates', '[]'::jsonb));
      n := n + 1;
    END LOOP;
    UPDATE field_day SET version = version + 1, built_at = now(), updated_at = now() WHERE id = d.id RETURNING * INTO d;
    entity := d.id;
    result := jsonb_build_object('day', to_jsonb(d), 'inserted', n);
    details := jsonb_build_object('technician', d.technician, 'work_date', d.work_date, 'source', d.source, 'inserted', n);

  ELSIF op IN ('confirm', 'confirm_all') THEN
    IF op = 'confirm' THEN
      SELECT * INTO s FROM field_segment WHERE id = nullif(request->>'segment_id', '')::uuid FOR UPDATE;
      IF s.id IS NULL THEN RAISE EXCEPTION 'Segment not found'; END IF;
      SELECT * INTO d FROM field_day WHERE id = s.day_id FOR UPDATE;
    ELSE
      SELECT * INTO d FROM field_day WHERE id = nullif(request->>'day_id', '')::uuid FOR UPDATE;
      IF d.id IS NULL THEN RAISE EXCEPTION 'Field day not found'; END IF;
    END IF;
    -- The tech confirms their own day; an admin can confirm any day. Sample days are admin only.
    IF NOT (is_admin OR (who.person = d.technician AND d.source = 'device')) THEN RAISE EXCEPTION 'FORBIDDEN: only the tech or an admin can confirm this day'; END IF;
    IF d.version IS DISTINCT FROM (request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload the changed day'; END IF;
    IF op = 'confirm' THEN
      prior := to_jsonb(s);
      new_kind := coalesce(nullif(request->>'kind', ''), s.kind);
      IF new_kind <> s.kind AND NOT ((s.kind = ANY(stop_kinds) AND new_kind = ANY(stop_kinds)) OR (s.kind IN ('parts_run', 'dump_run') AND new_kind IN ('parts_run', 'dump_run'))) THEN
        RAISE EXCEPTION 'That segment cannot change to %', new_kind;
      END IF;
      new_alloc := CASE WHEN request ? 'allocations' THEN request->'allocations' ELSE s.allocations END;
      new_label := CASE WHEN request ? 'label' THEN nullif(request->>'label', '') ELSE s.label END;
      PERFORM field_time_check_allocations(new_alloc);
      IF new_kind = 'on_site' AND (jsonb_array_length(new_alloc) = 0 OR new_label IS NOT NULL) THEN RAISE EXCEPTION 'Choose the job for this visit'; END IF;
      IF new_kind IN ('parts_run', 'dump_run') AND NOT ((jsonb_array_length(new_alloc) > 0 AND new_label IS NULL) OR (jsonb_array_length(new_alloc) = 0 AND coalesce(new_label, '') = 'general')) THEN
        RAISE EXCEPTION 'Choose the jobs this run was for, or mark it van stock / general';
      END IF;
      IF new_kind IN ('stop', 'no_data') AND (new_label IS NULL OR jsonb_array_length(new_alloc) > 0) THEN RAISE EXCEPTION 'Say what this time was'; END IF;
      IF new_kind IN ('inspection', 'shop', 'drive', 'break') AND (jsonb_array_length(new_alloc) > 0 OR new_label IS NOT NULL) THEN RAISE EXCEPTION 'This segment takes no job or label'; END IF;
      IF new_label = 'other_work' AND nullif(trim(coalesce(request->>'note', s.note)), '') IS NULL THEN RAISE EXCEPTION 'Describe the other work'; END IF;
      UPDATE field_segment SET kind = new_kind, allocations = new_alloc, label = new_label, note = coalesce(request->>'note', note),
        suggestion = CASE WHEN state = 'suggested' THEN jsonb_build_object('kind', kind, 'allocations', allocations, 'label', label) ELSE suggestion END,
        state = 'confirmed', confirmed_by = actor, confirmed_at = now()
      WHERE id = s.id RETURNING * INTO s;
      details := jsonb_build_object('before', prior, 'after', to_jsonb(s));
    ELSE
      -- Only suggestions that are already complete; anything needing a choice stays for the tech.
      UPDATE field_segment SET suggestion = jsonb_build_object('kind', kind, 'allocations', allocations, 'label', label),
        state = 'confirmed', confirmed_by = actor, confirmed_at = now()
      WHERE day_id = d.id AND state = 'suggested' AND (
        kind IN ('inspection', 'shop', 'drive', 'break')
        OR (kind = 'on_site' AND jsonb_array_length(allocations) > 0)
        OR (kind IN ('parts_run', 'dump_run') AND (jsonb_array_length(allocations) > 0 OR label = 'general'))
        OR (kind IN ('stop', 'no_data') AND label IS NOT NULL));
      GET DIAGNOSTICS n = ROW_COUNT;
      details := jsonb_build_object('confirmed', n);
    END IF;
    UPDATE field_day SET version = version + 1, updated_at = now() WHERE id = d.id RETURNING * INTO d;
    entity := d.id;
    result := jsonb_build_object('day', to_jsonb(d), 'segment', CASE WHEN op = 'confirm' THEN to_jsonb(s) END, 'confirmed', n);

  ELSIF op = 'delete_sample' THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'FORBIDDEN: only an admin can delete a sample day'; END IF;
    SELECT * INTO d FROM field_day WHERE id = nullif(request->>'day_id', '')::uuid FOR UPDATE;
    IF d.id IS NULL OR d.source <> 'sample' THEN RAISE EXCEPTION 'Sample day not found'; END IF;
    DELETE FROM field_day WHERE id = d.id;
    entity := d.id;
    result := jsonb_build_object('deleted', d.id);
    details := jsonb_build_object('technician', d.technician, 'work_date', d.work_date);

  ELSIF op = 'place_save' THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'FORBIDDEN: only an admin can change stop locations'; END IF;
    IF coalesce(request->>'kind', '') NOT IN ('store', 'dump', 'shop', 'other') THEN RAISE EXCEPTION 'Choose a location kind'; END IF;
    IF nullif(trim(request->>'name'), '') IS NULL THEN RAISE EXCEPTION 'Name the location'; END IF;
    IF jsonb_typeof(request->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(request->'longitude') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'The address could not be found. Paste coordinates from Google Maps'; END IF;
    IF jsonb_typeof(request->'radius_m') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Set the radius in metres'; END IF;
    IF nullif(request->>'supplier_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supplier WHERE id = (request->>'supplier_id')::uuid) THEN RAISE EXCEPTION 'Choose a provider from the list'; END IF;
    SELECT * INTO pl FROM field_place WHERE id = nullif(request->>'id', '')::uuid FOR UPDATE;
    BEGIN
      IF pl.id IS NOT NULL THEN
        IF pl.version IS DISTINCT FROM (request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload the changed location'; END IF;
        prior := to_jsonb(pl);
        UPDATE field_place SET kind = request->>'kind', supplier_id = nullif(request->>'supplier_id', '')::uuid, name = trim(request->>'name'),
          address = trim(coalesce(request->>'address', '')), latitude = (request->>'latitude')::double precision, longitude = (request->>'longitude')::double precision,
          radius_m = (request->>'radius_m')::integer, active = coalesce((request->>'active')::boolean, true),
          version = version + 1, updated_by = actor, updated_at = now()
        WHERE id = pl.id RETURNING * INTO pl;
      ELSE
        INSERT INTO field_place (kind, supplier_id, name, address, latitude, longitude, radius_m, active, updated_by)
        VALUES (request->>'kind', nullif(request->>'supplier_id', '')::uuid, trim(request->>'name'), trim(coalesce(request->>'address', '')),
                (request->>'latitude')::double precision, (request->>'longitude')::double precision, (request->>'radius_m')::integer,
                coalesce((request->>'active')::boolean, true), actor)
        RETURNING * INTO pl;
      END IF;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A location with that name already exists';
    END;
    entity := pl.id;
    result := to_jsonb(pl);
    details := jsonb_build_object('before', prior, 'after', result);

  ELSIF op = 'supplier_save' THEN
    IF NOT is_office THEN RAISE EXCEPTION 'FORBIDDEN: office staff only'; END IF;
    IF nullif(trim(request->>'name'), '') IS NULL THEN RAISE EXCEPTION 'Name the provider'; END IF;
    SELECT * INTO sp FROM supplier WHERE id = nullif(request->>'id', '')::uuid FOR UPDATE;
    BEGIN
      IF sp.id IS NOT NULL THEN
        IF sp.version IS DISTINCT FROM (request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload the changed provider'; END IF;
        prior := to_jsonb(sp);
        UPDATE supplier SET name = trim(request->>'name'), phone = nullif(trim(request->>'phone'), ''), email = nullif(trim(request->>'email'), ''),
          account_number = nullif(trim(request->>'account_number'), ''), pro_desk_notes = coalesce(request->>'pro_desk_notes', ''),
          active = coalesce((request->>'active')::boolean, true), version = version + 1, updated_by = actor, updated_at = now()
        WHERE id = sp.id RETURNING * INTO sp;
      ELSE
        INSERT INTO supplier (name, phone, email, account_number, pro_desk_notes, updated_by)
        VALUES (trim(request->>'name'), nullif(trim(request->>'phone'), ''), nullif(trim(request->>'email'), ''),
                nullif(trim(request->>'account_number'), ''), coalesce(request->>'pro_desk_notes', ''), actor)
        RETURNING * INTO sp;
      END IF;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A provider with that name already exists';
    END;
    entity := sp.id;
    result := to_jsonb(sp);
    details := jsonb_build_object('before', prior, 'after', result);

  ELSE
    RAISE EXCEPTION 'Unknown field time action';
  END IF;

  INSERT INTO maintenance_workspace_audit (actor, op, entity_id, details) VALUES (actor, 'field_time:' || op, entity, details);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION field_time_check_allocations(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION field_time_check_allocations(jsonb) TO service_role;
REVOKE ALL ON FUNCTION field_time_apply(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION field_time_apply(text, jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
