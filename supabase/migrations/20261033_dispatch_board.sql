-- Dispatch board: drag a work order onto a vendor column to plan it.
-- AppFolio stays the system of record for vendor assignment (no write API), so a
-- board drop records the planned vendor here and the card nudges staff to assign
-- the same vendor in AppFolio until the sync shows it.
BEGIN;

ALTER TABLE public.vendor_assignment
  -- 'manual' = the Wave 1 dispatch record (tripwire #4 chases acceptance);
  -- 'board' = planned from the dispatch board (not chased).
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'board')),
  -- Set when the card is dragged to another column or back to Unassigned.
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ,
  -- AppFolio's vendor_id on the work order when the plan was made. If AppFolio
  -- later shows a third vendor, AppFolio wins and the plan is ignored.
  ADD COLUMN IF NOT EXISTS af_vendor_at_plan TEXT;

-- The board reads the newest live assignment per work order.
CREATE INDEX IF NOT EXISTS idx_vendor_assignment_live
  ON public.vendor_assignment (work_order_id, created_at DESC)
  WHERE completed_at IS NULL AND declined_at IS NULL AND withdrawn_at IS NULL;

COMMIT;
