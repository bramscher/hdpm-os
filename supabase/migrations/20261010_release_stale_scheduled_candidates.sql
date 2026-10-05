-- Deleted routes and skipped stops returned inspections to the queue but left
-- their units flagged candidate_status = 'scheduled', so the candidate review
-- held them in "Needs confirmation" with no way out. Release every unit that
-- has no unfinished stop on any route. Units with a pending or in-progress
-- stop (including past-dated ones awaiting confirmation) are left alone.
-- Idempotent.

UPDATE inspection_properties AS p
SET candidate_status = 'eligible'
WHERE p.candidate_status = 'scheduled'
  AND NOT EXISTS (
    SELECT 1
    FROM inspections i
    JOIN route_stops rs ON rs.inspection_id = i.id
    JOIN route_plans rp ON rp.id = rs.route_plan_id
    WHERE i.property_id = p.id
      AND rs.status IN ('pending', 'in_progress')
      AND rp.status <> 'completed'
  );
