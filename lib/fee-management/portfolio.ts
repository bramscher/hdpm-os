/**
 * Shared glue between the owner rollup, the fee schedule and the fatigue
 * model, so the Owner Fee Opportunity and Fee Schedule tabs compute the
 * same numbers from the same inputs.
 */

import type { FeeVolumes } from './volumes';
import type { FeeFacts, OwnerRow } from './model';
import { computeCashFlow, type CashFlow, type FeeScheduleConfig, type MgmtScenario, type VolumeContext } from './fee-schedule';
import { DEFAULT_FATIGUE, computeFatigue, type FatigueResult, type OwnerFeeImpact } from './fatigue';

function isoDaysAgo(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * 86_400_000).toISOString().slice(0, 10);
}

/** Trailing-12-month volumes + portfolio size for pricing fees. */
export function volumeContext(facts: FeeFacts, v: FeeVolumes, today: string): VolumeContext {
  const yearAgo = isoDaysAgo(today, 365);
  const newProps = facts.properties.filter((p) => p.mgmtStartDate && p.mgmtStartDate >= yearAgo);
  const existingSets = new Set(
    facts.properties.filter((p) => !p.mgmtStartDate || p.mgmtStartDate < yearAgo).map((p) => p.ownerSetKey)
  );
  const occupied = facts.properties.reduce((a, p) => a + p.occupiedDoors, 0);
  return {
    newLeases: v.newLeases,
    renewals: v.renewals,
    newProperties: newProps.length,
    newOwners: new Set(newProps.map((p) => p.ownerSetKey).filter((k) => !existingSets.has(k))).size,
    properties: facts.properties.length,
    doors: facts.properties.reduce((a, p) => a + p.doors, 0),
    vendorSpend: v.vendorSpend ?? 0,
    avgMonthlyRent: occupied ? facts.properties.reduce((a, p) => a + p.occupiedRentMonthly, 0) / occupied : 0,
  };
}

/** Portfolio management-fee revenue under each scenario. */
export function mgmtScenarios(rows: OwnerRow[]): Record<MgmtScenario, number> {
  const current = rows.reduce((a, r) => a + r.currentFeesMonthly * 12, 0);
  return {
    current,
    firstRaise: current + rows.reduce((a, r) => a + r.nextRaiseYearly, 0),
    schedule: current + rows.reduce((a, r) => a + r.addedYearly, 0),
  };
}

/**
 * Each owner's current vs proposed total fees: their own management change
 * for the scenario, plus other fees spread across owners per door.
 */
export function ownerImpacts(rows: OwnerRow[], cash: CashFlow, doors: number, scenario: MgmtScenario) {
  const perDoorCurrent = doors ? cash.lines.reduce((s, l) => s + l.currentYearly, 0) / doors : 0;
  const perDoorProposed = doors ? cash.lines.reduce((s, l) => s + l.proposedYearly, 0) / doors : 0;
  const newFeeTypes = cash.lines.filter((l) => l.currentYearly === 0 && l.proposedYearly > 0).length;
  const impacts: OwnerFeeImpact[] = rows.map((r) => {
    const mgmtNow = r.currentFeesMonthly * 12;
    const mgmtAdd = scenario === 'firstRaise' ? r.nextRaiseYearly : scenario === 'schedule' ? r.addedYearly : 0;
    return {
      key: r.key,
      name: r.name,
      doors: r.doors,
      currentYearly: mgmtNow + perDoorCurrent * r.doors,
      proposedYearly: mgmtNow + mgmtAdd + perDoorProposed * r.doors,
    };
  });
  return { impacts, newFeeTypes };
}

/** Cash flow + fatigue for a fee schedule — the single source both tabs use. */
export function portfolioFatigue(
  rows: OwnerRow[],
  cfg: FeeScheduleConfig,
  ctx: VolumeContext
): { cash: CashFlow; fatigue: FatigueResult; newFeeTypes: number } {
  const cash = computeCashFlow(cfg, ctx, mgmtScenarios(rows));
  const { impacts, newFeeTypes } = ownerImpacts(rows, cash, ctx.doors, cfg.mgmtScenario);
  return { cash, fatigue: computeFatigue(impacts, newFeeTypes, cfg.fatigue ?? DEFAULT_FATIGUE), newFeeTypes };
}
