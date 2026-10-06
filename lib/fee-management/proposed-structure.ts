/**
 * Proposed management-fee structure, "as if fully implemented today": every
 * owner moved straight to their door band's rate (fees are never lowered —
 * owners already above keep their rate). Pure; uses the same owner rollup as
 * the Owner Fee Opportunity tab.
 */

import { bandLabel, type DoorBand, type OwnerRow } from './model';

export interface BandImpact {
  key: string;
  label: string;
  band: DoorBand | null;
  owners: number;
  doors: number;
  /** Owners whose fee would go up. */
  ownersRaised: number;
  /** Rent-weighted current fee %, over owners with a %-fee base. */
  currentPct: number | null;
  targetPct: number | null;
  currentYearly: number;
  fullYearly: number;
  deltaYearly: number;
  deltaPct: number | null;
  /** Most raises any owner in the band needs at the current max step. */
  maxRaises: number;
}

function summarize(key: string, label: string, band: DoorBand | null, rows: OwnerRow[]): BandImpact {
  const currentYearly = rows.reduce((a, r) => a + r.currentFeesMonthly * 12, 0);
  const added = rows.reduce((a, r) => a + r.addedYearly, 0);
  const weighted = rows.filter((r) => r.blendedPct != null && r.rentBaseYearly > 0);
  const base = weighted.reduce((a, r) => a + r.rentBaseYearly, 0);
  return {
    key,
    label,
    band,
    owners: rows.length,
    doors: rows.reduce((a, r) => a + r.doors, 0),
    ownersRaised: rows.filter((r) => r.addedYearly > 0).length,
    currentPct: base > 0 ? weighted.reduce((a, r) => a + r.blendedPct! * r.rentBaseYearly, 0) / base : null,
    targetPct: band?.targetPct ?? null,
    currentYearly,
    fullYearly: currentYearly + added,
    deltaYearly: added,
    deltaPct: currentYearly > 0 ? (added / currentYearly) * 100 : null,
    maxRaises: rows.reduce((m, r) => Math.max(m, r.raisesToTarget), 0),
  };
}

/** One row per door band (in schedule order), plus owners no band covers. */
export function bandImpacts(rows: OwnerRow[], schedule: DoorBand[]): { bands: BandImpact[]; total: BandImpact } {
  const sorted = [...schedule].sort((a, b) => a.minDoors - b.minDoors);
  const bands = sorted.map((b) =>
    summarize(`${b.minDoors}-${b.maxDoors ?? 'up'}`, bandLabel(b), b, rows.filter((r) => r.band && r.band.minDoors === b.minDoors)),
  );
  const unbanded = rows.filter((r) => !r.band);
  if (unbanded.length) bands.push(summarize('none', 'No band (check door counts)', null, unbanded));
  return { bands, total: summarize('total', 'Portfolio', null, rows) };
}

/** Validate an edited schedule before it drives the numbers. Returns an error or null. */
export function scheduleError(schedule: DoorBand[]): string | null {
  if (schedule.length === 0) return 'Add at least one band.';
  const sorted = [...schedule].sort((a, b) => a.minDoors - b.minDoors);
  for (const [i, b] of sorted.entries()) {
    if (!Number.isFinite(b.minDoors) || b.minDoors < 1) return 'Each band needs a starting door count of 1 or more.';
    if (b.maxDoors != null && b.maxDoors < b.minDoors) return `Band starting at ${b.minDoors} ends before it starts.`;
    if (!Number.isFinite(b.targetPct) || b.targetPct <= 0 || b.targetPct > 30) return 'Fee % must be between 0 and 30.';
    if (!Number.isFinite(b.maxRaisePts) || b.maxRaisePts <= 0) return 'Max step must be above 0.';
    const next = sorted[i + 1];
    if (next && b.maxDoors == null) return 'Only the last band can be open-ended.';
    if (next && b.maxDoors != null && next.minDoors !== b.maxDoors + 1) return `Gap or overlap between ${b.maxDoors} and ${next.minDoors} doors.`;
  }
  if (sorted[0].minDoors !== 1) return 'The first band must start at 1 door.';
  return null;
}
