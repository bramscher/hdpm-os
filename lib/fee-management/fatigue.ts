/**
 * Fee fatigue & churn — the downside of raising fees. Each owner gets a
 * 0–100 fatigue index from how much their total fees rise and how many new
 * fee types they start seeing; fatigue converts to extra probability of
 * leaving within a year, and expected lost fees offset the gross gain.
 *
 * There is no published elasticity for property-management fee increases,
 * so the sensitivity inputs are explicit, editable assumptions. The
 * break-even figure (how many doors could leave before the change loses
 * money) needs no assumption at all.
 *
 * Churn is all-or-nothing per owner set: an owner who leaves takes every
 * door and every fee. Expected values average that out, so large owners
 * also get a stress test (what if they actually leave).
 */

export interface FatigueAssumptions {
  /** % increase in an owner's total fees that counts as full fatigue (100). */
  fullFatigueAtPct: number;
  /** Fatigue points added per new fee type an owner starts paying. */
  pointsPerNewFee: number;
  /** Extra annual churn probability, in pts, for an owner at full fatigue. */
  maxAddedChurnPts: number;
  /**
   * Churn sensitivity by owner size (total doors): bigger owners have more to
   * save and get courted with volume discounts. Sorted by minDoors; the last
   * tier at or below an owner's doors applies.
   */
  sizeMultipliers?: { minDoors: number; multiplier: number }[];
  /** Owners at or above this many doors get the large-owner stress test. */
  largeOwnerDoors?: number;
}

export const DEFAULT_SIZE_MULTIPLIERS = [
  { minDoors: 1, multiplier: 1 },
  { minDoors: 4, multiplier: 1.25 },
  { minDoors: 16, multiplier: 1.5 },
];

export const DEFAULT_FATIGUE: FatigueAssumptions = {
  fullFatigueAtPct: 50,
  pointsPerNewFee: 10,
  maxAddedChurnPts: 15,
  sizeMultipliers: DEFAULT_SIZE_MULTIPLIERS,
  largeOwnerDoors: 16,
};

export function sizeMultiplier(doors: number, a: FatigueAssumptions): number {
  const tiers = [...(a.sizeMultipliers ?? DEFAULT_SIZE_MULTIPLIERS)].sort((x, y) => x.minDoors - y.minDoors);
  let m = 1;
  for (const t of tiers) if (doors >= t.minDoors) m = t.multiplier;
  return m;
}

export interface OwnerFeeImpact {
  key: string;
  name: string;
  doors: number;
  currentYearly: number;
  proposedYearly: number;
}

export interface OwnerFatigue extends OwnerFeeImpact {
  increasePct: number;
  fatigue: number;
  sizeMultiplier: number;
  addedChurn: number; // probability 0–1
  expectedLoss: number; // $/yr of proposed fees at risk
}

export interface LargeOwnerExposure {
  threshold: number;
  owners: OwnerFatigue[]; // large owners whose fees rise, by $ at stake
  /** Net gain if the single largest at-risk owner actually leaves (certainty instead of expectation). */
  netIfLargestLeaves: number | null;
  largest: OwnerFatigue | null;
  /** Net gain if every large at-risk owner leaves. */
  netIfAllLeave: number | null;
  feesAtStake: number;
  doorsAtStake: number;
}

export interface FatigueResult {
  owners: OwnerFatigue[];
  grossGain: number;
  expectedLoss: number;
  netGain: number;
  expectedDoorsLost: number;
  expectedOwnersLost: number;
  doors: number;
  revPerDoorNow: number;
  revPerDoorAfter: number;
  /** Doors that would earn today's fee revenue at the new revenue per door. */
  doorsForTodaysRevenue: number;
  /** Doors that could leave (at average proposed fees per door) before the change nets to $0. */
  breakEvenDoors: number;
  bands: { label: string; min: number; max: number; owners: number; doors: number; expectedLoss: number }[];
  large: LargeOwnerExposure;
}

export const FATIGUE_BANDS = [
  { label: 'Low', min: 0, max: 25 },
  { label: 'Moderate', min: 25, max: 50 },
  { label: 'High', min: 50, max: 75 },
  { label: 'Severe', min: 75, max: 101 },
];

export function fatigueFor(increasePct: number, newFeeTypes: number, a: FatigueAssumptions): number {
  if (increasePct <= 0 && newFeeTypes === 0) return 0;
  const fromIncrease = a.fullFatigueAtPct > 0 ? (Math.max(0, increasePct) / a.fullFatigueAtPct) * 100 : 0;
  return Math.min(100, Math.round(fromIncrease + newFeeTypes * a.pointsPerNewFee));
}

export function computeFatigue(owners: OwnerFeeImpact[], newFeeTypes: number, a: FatigueAssumptions): FatigueResult {
  const rows: OwnerFatigue[] = owners.map((o) => {
    const increasePct = o.currentYearly > 0 ? ((o.proposedYearly - o.currentYearly) / o.currentYearly) * 100 : 0;
    const raised = o.proposedYearly > o.currentYearly;
    const fatigue = raised ? fatigueFor(increasePct, newFeeTypes, a) : 0;
    const mult = sizeMultiplier(o.doors, a);
    const addedChurn = Math.min(1, (fatigue / 100) * (a.maxAddedChurnPts / 100) * mult);
    return { ...o, increasePct, fatigue, sizeMultiplier: mult, addedChurn, expectedLoss: addedChurn * o.proposedYearly };
  });

  const doors = rows.reduce((s, o) => s + o.doors, 0);
  const current = rows.reduce((s, o) => s + o.currentYearly, 0);
  const proposed = rows.reduce((s, o) => s + o.proposedYearly, 0);
  const expectedLoss = rows.reduce((s, o) => s + o.expectedLoss, 0);
  const expectedDoorsLost = rows.reduce((s, o) => s + o.addedChurn * o.doors, 0);
  const grossGain = proposed - current;
  const revPerDoorNow = doors ? current / doors : 0;
  const doorsAfter = doors - expectedDoorsLost;
  const revPerDoorAfter = doorsAfter > 0 ? (proposed - expectedLoss) / doorsAfter : 0;
  const proposedPerDoor = doors ? proposed / doors : 0;
  const netGain = grossGain - expectedLoss;

  // Stress test: swap the expected loss for certainty on the big owners.
  const threshold = a.largeOwnerDoors ?? 16;
  const largeAtRisk = rows.filter((o) => o.doors >= threshold && o.fatigue > 0).sort((x, y) => y.proposedYearly - x.proposedYearly);
  const extraIfLeaves = (o: OwnerFatigue) => o.proposedYearly - o.expectedLoss;
  const largest = largeAtRisk[0] ?? null;

  return {
    owners: rows.sort((x, y) => y.expectedLoss - x.expectedLoss),
    grossGain,
    expectedLoss,
    netGain,
    expectedDoorsLost,
    expectedOwnersLost: rows.reduce((s, o) => s + o.addedChurn, 0),
    doors,
    revPerDoorNow,
    revPerDoorAfter,
    doorsForTodaysRevenue: revPerDoorAfter > 0 ? current / revPerDoorAfter : doors,
    breakEvenDoors: proposedPerDoor > 0 && grossGain > 0 ? grossGain / proposedPerDoor : 0,
    bands: FATIGUE_BANDS.map((b) => {
      const inBand = rows.filter((o) => o.fatigue >= b.min && o.fatigue < b.max);
      return {
        ...b,
        owners: inBand.length,
        doors: inBand.reduce((s, o) => s + o.doors, 0),
        expectedLoss: inBand.reduce((s, o) => s + o.expectedLoss, 0),
      };
    }),
    large: {
      threshold,
      owners: largeAtRisk,
      largest,
      netIfLargestLeaves: largest ? netGain - extraIfLeaves(largest) : null,
      netIfAllLeave: largeAtRisk.length ? netGain - largeAtRisk.reduce((s, o) => s + extraIfLeaves(o), 0) : null,
      feesAtStake: largeAtRisk.reduce((s, o) => s + o.proposedYearly, 0),
      doorsAtStake: largeAtRisk.reduce((s, o) => s + o.doors, 0),
    },
  };
}

export function parseFatigue(v: unknown): FatigueAssumptions | null {
  const o = v as Record<string, unknown> | null;
  const a = { fullFatigueAtPct: Number(o?.fullFatigueAtPct), pointsPerNewFee: Number(o?.pointsPerNewFee), maxAddedChurnPts: Number(o?.maxAddedChurnPts) };
  if (!(a.fullFatigueAtPct > 0 && a.fullFatigueAtPct <= 1000)) return null;
  if (!(a.pointsPerNewFee >= 0 && a.pointsPerNewFee <= 100)) return null;
  if (!(a.maxAddedChurnPts >= 0 && a.maxAddedChurnPts <= 100)) return null;
  // Size tiers and the large-owner threshold are optional (older saved configs lack them).
  let sizeMultipliers = DEFAULT_SIZE_MULTIPLIERS;
  if (o?.sizeMultipliers != null) {
    if (!Array.isArray(o.sizeMultipliers) || o.sizeMultipliers.length === 0 || o.sizeMultipliers.length > 10) return null;
    sizeMultipliers = [];
    for (const t of o.sizeMultipliers as Record<string, unknown>[]) {
      const minDoors = Number(t?.minDoors);
      const multiplier = Number(t?.multiplier);
      if (!Number.isInteger(minDoors) || minDoors < 1 || !(multiplier >= 0 && multiplier <= 10)) return null;
      sizeMultipliers.push({ minDoors, multiplier });
    }
    sizeMultipliers.sort((x, y) => x.minDoors - y.minDoors);
  }
  const largeOwnerDoors = o?.largeOwnerDoors == null ? 16 : Number(o.largeOwnerDoors);
  if (!Number.isInteger(largeOwnerDoors) || largeOwnerDoors < 1) return null;
  return { ...a, sizeMultipliers, largeOwnerDoors };
}
