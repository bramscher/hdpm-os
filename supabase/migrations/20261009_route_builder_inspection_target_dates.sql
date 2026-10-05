-- Route Builder routes used to mark inspections 'scheduled' without saving
-- the route date, so they never reached Send Notices (which filters on
-- target_date). Backfill upcoming ones from their pending route stop.
-- Idempotent: only touches scheduled inspections with no target_date.

UPDATE inspections AS i
SET target_date   = s.route_date,
    route_plan_id = s.route_plan_id,
    assigned_to   = COALESCE(i.assigned_to, s.assigned_to),
    updated_at    = now()
FROM (
  SELECT DISTINCT ON (rs.inspection_id)
         rs.inspection_id, rp.id AS route_plan_id, rp.route_date, rp.assigned_to
  FROM route_stops rs
  JOIN route_plans rp ON rp.id = rs.route_plan_id
  WHERE rs.status = 'pending'
    AND rp.route_date >= CURRENT_DATE
  ORDER BY rs.inspection_id, rp.route_date DESC
) AS s
WHERE i.id = s.inspection_id
  AND i.status = 'scheduled'
  AND i.target_date IS NULL;
