/**
 * Door movement — the pure math behind the Growth & Retention KPI.
 *
 * A door count over time can't tell gained from lost (both happen in a period).
 * So we compare property ROSTERS: a map of appfolio property id → its active
 * door count, snapshotted daily. Per-property door deltas between a baseline
 * roster and the current roster give:
 *   gained = Σ positive deltas   (new properties + unit increases)
 *   lost   = Σ |negative deltas| (departed properties + unit decreases)
 *   net    = gained − lost = currentDoors − baselineDoors
 *   churn% = lost ÷ baselineDoors
 *
 * No I/O — unit-tested directly.
 */

/** appfolio property id → active (non-hidden) door count. */
export type DoorRoster = Record<string, number>;

export interface DoorMovement {
  gained: number;
  lost: number;
  net: number;
  baselineDoors: number;
  currentDoors: number;
  /** lost ÷ baselineDoors, as a percent (0–100), rounded to 1dp. null if no baseline doors. */
  churnPct: number | null;
}

const sum = (r: DoorRoster): number =>
  Object.values(r).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);

/**
 * Compare a current roster to a baseline roster. Positive per-property deltas
 * sum to `gained`, negative to `lost`. `net` always equals
 * currentDoors − baselineDoors (a consistency invariant the tests assert).
 */
export function computeDoorMovement(current: DoorRoster, baseline: DoorRoster): DoorMovement {
  const propertyIds = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  let gained = 0;
  let lost = 0;
  for (const id of propertyIds) {
    const delta = (current[id] ?? 0) - (baseline[id] ?? 0);
    if (delta > 0) gained += delta;
    else if (delta < 0) lost += -delta;
  }
  const currentDoors = sum(current);
  const baselineDoors = sum(baseline);
  const churnPct = baselineDoors > 0 ? Math.round((lost / baselineDoors) * 1000) / 10 : null;
  return {
    gained,
    lost,
    net: gained - lost,
    baselineDoors,
    currentDoors,
    churnPct,
  };
}
