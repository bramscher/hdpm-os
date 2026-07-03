-- ============================================
-- One-time data fix: grandfather-close the pre-launch VERIFY backlog
-- Date: 2026-07-03 (approved by Craig)
--
-- Work orders that AppFolio marked "Work Completed" BEFORE the Maintenance OS
-- launch (2026-07-01) predate the six-condition closure gate — nobody will
-- retroactively add photos/time/materials for them. Close them in OUR mirror
-- (stage column) so the Exceptions view starts clean. AppFolio is not touched.
--
-- Kept in VERIFY on purpose:
--   - completed on/after 2026-07-01  → go through the real gate
--   - completed_date IS NULL         → safe default, review by hand
--
-- Each row gets an audit event (actor 'system:backfill') so grandfathered
-- closes are permanently distinguishable from gate-passed closes.
--
-- NOTE: already executed against the live DB on 2026-07-03 via the service
-- client; kept here for the record / disaster recovery.
-- ============================================

BEGIN;

-- Audit trail first (from the exact rows the update will touch)
INSERT INTO wo_event (work_order_id, event_type, payload, actor)
SELECT id,
       'stage_change',
       jsonb_build_object(
         'from', 'VERIFY',
         'to', 'CLOSED',
         'system_override', true,
         'reason', 'grandfathered: completed in AppFolio before 2026-07-01 launch'
       ),
       'system:backfill'
FROM work_orders
WHERE stage = 'VERIFY'
  AND completed_date < '2026-07-01';

UPDATE work_orders
SET stage = 'CLOSED',
    closed_at = COALESCE(completed_date, NOW())
WHERE stage = 'VERIFY'
  AND completed_date < '2026-07-01';

COMMIT;

-- Verify:
--   SELECT stage, count(*) FROM work_orders GROUP BY 1 ORDER BY 1;
--   SELECT count(*) FROM wo_event WHERE actor = 'system:backfill';
