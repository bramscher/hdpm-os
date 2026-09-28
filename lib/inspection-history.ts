import type { AppFolioUnit } from '@/lib/appfolio';

/** Fields returned by AppFolio Reports API's inspection_detail report. */
export interface AppFolioInspectionDetail {
  unit_id: number | string | null;
  status: string;
  inspected_on: string | null;
  marked_done_on: string | null;
}

/** Reconcile actual completed inspections with the unit API's sometimes stale date. */
export function reconcileInspectionHistory(
  units: AppFolioUnit[],
  inspections: AppFolioInspectionDetail[],
  today: string,
): AppFolioUnit[] {
  const latestByUnit = new Map<string, string>();
  for (const inspection of inspections) {
    if (inspection.status !== 'DONE' || inspection.unit_id == null) continue;
    // Inspection date is when the visit occurred; completion may be logged later.
    const date = inspection.inspected_on || inspection.marked_done_on;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || date > today) continue;
    const key = String(inspection.unit_id);
    if (date > (latestByUnit.get(key) ?? '')) latestByUnit.set(key, date);
  }
  return units.map(unit => {
    // Report IDs are numeric, while the database API uses UUIDs. Never match by
    // property name/address: that can assign another unit's inspection history.
    const numericId = /\/units\/(\d+)(?:[/?#]|$)/.exec(unit.link ?? '')?.[1];
    const completedDate = numericId ? latestByUnit.get(numericId) : null;
    return completedDate && completedDate > (unit.lastInspectedDate ?? '')
      ? { ...unit, lastInspectedDate: completedDate }
      : unit;
  });
}
