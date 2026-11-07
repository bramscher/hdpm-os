-- Field time: manual entries (Craig, 2026-10-30). A tech who forgot the company phone adds the time by
-- hand on the field day page; the entry is confirmed at once and labelled Manual so reviewers can tell
-- recollection from GPS evidence. The nightly/upload rebuild keeps confirmed segments and trims its
-- suggestions around them, so a manual entry simply replaces "No signal" time.
-- Apply in the Supabase SQL Editor. Safe to re-run.
BEGIN;
ALTER TABLE field_segment ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION field_time_manual(actor text, request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  who staff; is_admin boolean; op text := request->>'op'; d field_day; s field_segment;
  tech text := request->>'technician'; work date := nullif(request->>'work_date', '')::date;
  starts timestamptz; ends timestamptz; k text := request->>'kind'; lbl text := nullif(request->>'label', '');
  alloc jsonb := coalesce(request->'allocations', '[]'::jsonb); details jsonb;
  today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
  SELECT * INTO who FROM staff WHERE lower(email) = lower(actor) AND active LIMIT 1;
  IF who.person IS NULL OR who.access_role IN ('read_only', 'inspector', 'front_desk') THEN RAISE EXCEPTION 'FORBIDDEN: active staff required'; END IF;
  is_admin := who.access_role = 'admin';

  IF op = 'add' THEN
    IF NOT (is_admin OR who.person = tech) THEN RAISE EXCEPTION 'FORBIDDEN: only the tech or an admin can add time to this day'; END IF;
    IF NOT EXISTS (SELECT 1 FROM staff WHERE person = tech AND active) THEN RAISE EXCEPTION 'Active technician required'; END IF;
    IF work IS NULL OR work > today OR work < today - 31 THEN RAISE EXCEPTION 'Choose a day in the last month'; END IF;
    starts := (request->>'started_at')::timestamptz; ends := (request->>'ended_at')::timestamptz;
    IF starts IS NULL OR ends IS NULL OR ends <= starts OR (starts AT TIME ZONE 'America/Los_Angeles')::date <> work
      OR ends > ((work + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') OR ends - starts > interval '16 hours' OR ends > now() THEN
      RAISE EXCEPTION 'Enter a start and end on that day, not in the future';
    END IF;
    IF k NOT IN ('on_site', 'parts_run', 'dump_run', 'stop') THEN RAISE EXCEPTION 'Choose a job, parts run, dump run or other work'; END IF;
    PERFORM field_time_check_allocations(alloc);
    IF k = 'on_site' AND (jsonb_array_length(alloc) = 0 OR lbl IS NOT NULL) THEN RAISE EXCEPTION 'Choose the job'; END IF;
    IF k IN ('parts_run', 'dump_run') AND NOT ((jsonb_array_length(alloc) > 0 AND lbl IS NULL) OR (jsonb_array_length(alloc) = 0 AND lbl = 'general')) THEN
      RAISE EXCEPTION 'Choose the jobs this run was for, or mark it van stock / general';
    END IF;
    IF k = 'stop' AND (lbl IS NULL OR lbl NOT IN ('personal', 'estimate', 'other_work') OR jsonb_array_length(alloc) > 0) THEN RAISE EXCEPTION 'Say what this time was'; END IF;
    IF lbl = 'other_work' AND nullif(trim(coalesce(request->>'note', '')), '') IS NULL THEN RAISE EXCEPTION 'Describe the other work'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('field_day:' || tech || ':' || work || ':device'));
    SELECT * INTO d FROM field_day WHERE technician = tech AND work_date = work AND source = 'device' FOR UPDATE;
    IF d.id IS NULL THEN
      INSERT INTO field_day (technician, work_date, source, created_by) VALUES (tech, work, 'device', actor) RETURNING * INTO d;
    ELSIF d.version IS DISTINCT FROM coalesce((request->>'version')::integer, d.version) THEN
      RAISE EXCEPTION 'CONFLICT: reload the changed day';
    END IF;
    IF EXISTS (SELECT 1 FROM field_segment WHERE day_id = d.id AND state = 'confirmed' AND started_at < ends AND ended_at > starts) THEN
      RAISE EXCEPTION 'That time overlaps time already confirmed';
    END IF;
    INSERT INTO field_segment (day_id, technician, work_date, kind, started_at, ended_at, property_label, allocations, label, note, state, manual, confirmed_by, confirmed_at)
    VALUES (d.id, tech, work, k, starts, ends, left(coalesce(request->>'property_label', ''), 200), alloc, lbl, left(coalesce(request->>'note', ''), 2000), 'confirmed', true, actor, now())
    RETURNING * INTO s;
    details := jsonb_build_object('after', to_jsonb(s));

  ELSIF op = 'remove' THEN
    SELECT * INTO s FROM field_segment WHERE id = nullif(request->>'segment_id', '')::uuid FOR UPDATE;
    IF s.id IS NULL OR NOT s.manual THEN RAISE EXCEPTION 'Only a manual entry can be removed'; END IF;
    SELECT * INTO d FROM field_day WHERE id = s.day_id FOR UPDATE;
    IF NOT (is_admin OR who.person = d.technician) THEN RAISE EXCEPTION 'FORBIDDEN: only the tech or an admin can remove this entry'; END IF;
    IF d.version IS DISTINCT FROM (request->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT: reload the changed day'; END IF;
    DELETE FROM field_segment WHERE id = s.id;
    details := jsonb_build_object('before', to_jsonb(s));
  ELSE
    RAISE EXCEPTION 'Unknown manual entry action';
  END IF;

  UPDATE field_day SET version = version + 1, updated_at = now() WHERE id = d.id RETURNING * INTO d;
  INSERT INTO maintenance_workspace_audit (actor, op, entity_id, details) VALUES (actor, 'field_time:manual_' || op, d.id, details);
  RETURN jsonb_build_object('day', to_jsonb(d));
END $$;
REVOKE ALL ON FUNCTION field_time_manual(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION field_time_manual(text, jsonb) TO service_role;
COMMIT;
