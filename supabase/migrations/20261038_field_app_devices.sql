-- HDPM Field iPhone app (field-location-app-plan.md step 2), server side.
--   field_device          one row per signed-in phone; only a SHA-256 of its token is stored
--   field_location_point  raw fixes while clocked in; deleted after 30 days by /api/field/cron
--   field_time_apply      'replace' now also lets a tech rebuild their own device day (the app's uploads do this)
-- Everything else in field_time_apply is unchanged from 20261029_field_time.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS field_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person text NOT NULL REFERENCES staff(person),
  email text NOT NULL,                      -- the Microsoft account that signed in
  token_hash text NOT NULL UNIQUE,          -- hex SHA-256 of the bearer token; the token itself is never stored
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by text
);
CREATE INDEX IF NOT EXISTS field_device_person_idx ON field_device (person);

CREATE TABLE IF NOT EXISTS field_location_point (
  device_id uuid NOT NULL REFERENCES field_device(id) ON DELETE CASCADE,
  person text NOT NULL REFERENCES staff(person),
  t timestamptz NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  acc real,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, t)                -- the app re-sends a batch whose reply was lost
);
CREATE INDEX IF NOT EXISTS field_location_point_person_t_idx ON field_location_point (person, t);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['field_device', 'field_location_point'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Service role full access to ' || t, t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', 'Service role full access to ' || t, t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
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
    IF NOT (is_admin OR (request->>'source' = 'device' AND who.person = request->>'technician')) THEN RAISE EXCEPTION 'FORBIDDEN: only an admin, or the tech for their own phone day, can rebuild a field day'; END IF;
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

REVOKE ALL ON FUNCTION field_time_apply(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION field_time_apply(text, jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Check: should return field_device, field_location_point.
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('field_device', 'field_location_point');
