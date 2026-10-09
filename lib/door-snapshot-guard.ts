/**
 * Sanity check for door-count snapshots (net_doors, door_roster,
 * door_movement) before the KPI cron saves them. A partial AppFolio response
 * once wrote a single bad day (2026-08-20) that skewed the sparklines and,
 * via door_roster, the gained/lost counts. Doors move by a handful a day, so
 * a zero or a sudden swing against the last saved snapshot is treated as a
 * bad read and skipped; the next night's run tries again.
 *
 * A genuine big move (a large portfolio won or lost) can be saved by running
 * the cron once with ?allowDoorJump=1.
 */

export const DOOR_SNAPSHOT_KPIS = ['net_doors', 'door_roster', 'door_movement'] as const;

/**
 * Largest believable one-snapshot drop / rise, as a fraction of the last
 * saved count. The 2026-08-20 bad read was +7.4% (829 → 890), so 5% each way.
 */
export const MAX_DROP = 0.05;
export const MAX_RISE = 0.05;

export function doorSnapshotProblem(previousDoors: number | null | undefined, nextDoors: unknown): string | null {
  if (typeof nextDoors !== 'number' || !Number.isFinite(nextDoors) || nextDoors <= 0) {
    return `door count ${String(nextDoors)} is not a positive number`;
  }
  if (previousDoors == null || previousDoors <= 0) return null;
  const change = (nextDoors - previousDoors) / previousDoors;
  if (change < -MAX_DROP || change > MAX_RISE) {
    return `door count moved ${previousDoors} → ${nextDoors} (${(change * 100).toFixed(1)}%) since the last snapshot`;
  }
  return null;
}
