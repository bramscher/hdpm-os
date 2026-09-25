/**
 * Fee fatigue & churn — the downside of raising fees. Each owner gets a
 * 0–100 fatigue index from how much their total fees rise and how many new
 * fee types they start seeing; fatigue converts to extra probability of
 * leaving within a year, and expected lost fees offset the gross gain.
 *
 * There is no published elasticity for property-management fee increases,
 * so the three sensitivity inputs are explicit, editable assumptions. The
 * break-even figure (how many doors could leave before the change loses
 * money) needs no assumption at all.
 */

export interface FatigueAssumptions {
  /** % increase in an owner's total fees that counts as full fatigue (100). */
  fullFatigueAtPct: number;
  /** Fatigue points added per new fee type an owner starts paying. */
  pointsPerNewFee: number;
  /** Extra annual churn probability, in pts, for an owner at full fatigue. */
  maxAddedChurnPts: number;
}

export const DEFAULT_FATIGUE: FatigueAssumptions = { fullFatigueAtPct: 50, pointsPerNewFee: 10, maxAddedChurnPts: 15 };

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
  addedChurn: number; // probability 0–1
  expectedLoss: number; // $/yr of proposed fees at risk
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
    const addedChurn = (fatigue / 100) * (a.maxAddedChurnPts / 100);
    return { ...o, increasePct, fatigue, addedChurn, expectedLoss: addedChurn * o.proposedYearly };
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

  return {
    owners: rows.sort((x, y) => y.expectedLoss - x.expectedLoss),
    grossGain,
    expectedLoss,
    netGain: grossGain - expectedLoss,
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
  };
}

export function parseFatigue(v: unknown): FatigueAssumptions | null {
  const o = v as Record<string, unknown> | null;
  const a = { fullFatigueAtPct: Number(o?.fullFatigueAtPct), pointsPerNewFee: Number(o?.pointsPerNewFee), maxAddedChurnPts: Number(o?.maxAddedChurnPts) };
  if (!(a.fullFatigueAtPct > 0 && a.fullFatigueAtPct <= 1000)) return null;
  if (!(a.pointsPerNewFee >= 0 && a.pointsPerNewFee <= 100)) return null;
  if (!(a.maxAddedChurnPts >= 0 && a.maxAddedChurnPts <= 100)) return null;
  return a;
}
