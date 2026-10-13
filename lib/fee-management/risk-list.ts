/**
 * The owners the proposed fee change puts most at risk, computed server-side
 * with the same math as Fee Management → Fee Schedule (Fee fatigue & churn):
 * Large-owner exposure and the top-10 Most at risk.
 */

import { buildOwnerRows } from './model';
import { portfolioFatigue, volumeContext } from './portfolio';
import type { FeeInputs } from './inputs';
import type { FeeVolumes } from './volumes';
import type { OwnerFatigue } from './fatigue';

export interface RiskOwner {
  /** Owner set key (fee_campaign / fee_risk_note key). */
  key: string;
  name: string;
  /** AppFolio owner ids in the set, to link to Knowledge Capture profiles. */
  ownerIds: string[];
  doors: number;
  currentYearly: number;
  proposedYearly: number;
  increasePct: number;
  fatigue: number;
  /** Chance of leaving within a year, 0–1. */
  addedChurn: number;
  expectedLoss: number;
}

export interface FeeRiskList {
  threshold: number;
  large: {
    owners: RiskOwner[];
    feesAtStake: number;
    doorsAtStake: number;
    netIfLargestLeaves: number | null;
    netIfAllLeave: number | null;
  };
  mostAtRisk: RiskOwner[];
}

export const MOST_AT_RISK_COUNT = 10;

export function feeRiskList(inputs: FeeInputs, volumes: FeeVolumes, today: string): FeeRiskList {
  const rows = buildOwnerRows({ ...inputs, today });
  const ctx = volumeContext(inputs.facts, volumes, today);
  const { fatigue } = portfolioFatigue(rows, inputs.feeSchedule, ctx);
  const idsByKey = new Map(rows.map((r) => [r.key, r.owners.map((o) => o.id)]));
  const toRisk = (o: OwnerFatigue): RiskOwner => ({
    key: o.key,
    name: o.name,
    ownerIds: idsByKey.get(o.key) ?? [],
    doors: o.doors,
    currentYearly: o.currentYearly,
    proposedYearly: o.proposedYearly,
    increasePct: o.increasePct,
    fatigue: o.fatigue,
    addedChurn: o.addedChurn,
    expectedLoss: o.expectedLoss,
  });
  return {
    threshold: fatigue.large.threshold,
    large: {
      owners: fatigue.large.owners.map(toRisk),
      feesAtStake: fatigue.large.feesAtStake,
      doorsAtStake: fatigue.large.doorsAtStake,
      netIfLargestLeaves: fatigue.large.netIfLargestLeaves,
      netIfAllLeave: fatigue.large.netIfAllLeave,
    },
    mostAtRisk: fatigue.owners.slice(0, MOST_AT_RISK_COUNT).map(toRisk),
  };
}
