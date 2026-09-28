import type { AppFolioUnit } from '@/lib/appfolio';

/** Fields returned by AppFolio Reports API's inspection_detail report. */
export interface AppFolioInspectionDetail {
  unit_id: number | string | null;
  status: string;
  inspected_on: string | null;
  marked_done_on: string | null;
}

/** The Unit Inspection report's date is trusted for scheduling, regardless of workflow status. */
export interface AppFolioUnitInspection {
  unit_id: number | string | null;
  last_inspection_date: string | null;
}

/** Combine trusted report dates and completed visits with the sometimes stale unit API. */
export function reconcileInspectionHistory(
  units: AppFolioUnit[],
  inspections: AppFolioInspectionDetail[],
  today: string,
  unitReport: AppFolioUnitInspection[] = [],
): AppFolioUnit[] {
  const latestByUnit = new Map<string, string>();
  const recordDate = (id: number | string | null, date: string | null) => {
    if (id == null || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date || date > today) return;
    const key = String(id);
    if (date > (latestByUnit.get(key) ?? '')) latestByUnit.set(key, date);
  };
  for (const row of unitReport) recordDate(row.unit_id, row.last_inspection_date);
  for (const inspection of inspections) {
    if (inspection.status !== 'DONE' || inspection.unit_id == null) continue;
    // Inspection date is when the visit occurred; completion may be logged later.
    const date = inspection.inspected_on || inspection.marked_done_on;
    recordDate(inspection.unit_id, date);
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
