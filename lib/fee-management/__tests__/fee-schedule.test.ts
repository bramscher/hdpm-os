import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FEE_SCHEDULE,
  annualFor,
  computeCashFlow,
  parseFeeSchedule,
  volumeFor,
  type FeeScheduleConfig,
  type VolumeContext,
} from '../fee-schedule';

const ctx: VolumeContext = {
  newLeases: 321, renewals: 142, newProperties: 36, newOwners: 23, properties: 447, doors: 817,
  vendorSpend: 906_070, avgMonthlyRent: 1671,
};
const mgmt = { current: 1_170_200, firstRaise: 1_323_686, schedule: 1_403_679 };

describe('annualFor', () => {
  it('prices each basis', () => {
    expect(annualFor({ basis: 'flat', amount: 300 }, 321, ctx)).toBe(96_300);
    expect(annualFor({ basis: 'pct_month', amount: 50 }, 321, ctx)).toBeCloseTo(268_195.5);
    expect(annualFor({ basis: 'pct_base', amount: 10 }, 906_070, ctx)).toBeCloseTo(90_607);
    expect(annualFor(null, 10, ctx)).toBe(0);
  });
});

describe('volumeFor', () => {
  it('uses the derived volume unless overridden; manual defaults to 0', () => {
    const line = DEFAULT_FEE_SCHEDULE.lines[0];
    expect(volumeFor(line, ctx)).toBe(321);
    expect(volumeFor({ ...line, volumeOverride: 300 }, ctx)).toBe(300);
    expect(volumeFor({ ...line, volumeSource: 'manual' }, ctx)).toBe(0);
  });
});

describe('computeCashFlow', () => {
  it('sums management + ancillary for current vs proposed', () => {
    const cfg: FeeScheduleConfig = {
      mgmtScenario: 'firstRaise',
      lines: [
        { ...DEFAULT_FEE_SCHEDULE.lines[0], proposed: { basis: 'pct_month', amount: 50 } }, // 96,300 → 268,195.5
        { ...DEFAULT_FEE_SCHEDULE.lines[1], proposed: { basis: 'flat', amount: 250 } }, // 0 → 35,500
      ],
    };
    const cf = computeCashFlow(cfg, ctx, mgmt);
    expect(cf.currentYearly).toBeCloseTo(1_170_200 + 96_300);
    expect(cf.proposedYearly).toBeCloseTo(1_323_686 + 268_195.5 + 35_500);
    expect(cf.lines[1].deltaYearly).toBe(35_500);
    expect(cf.lines[0].typicalYearly).toBeCloseTo(268_195.5);
    expect(cf.deltaPct).toBeCloseTo((cf.deltaYearly / cf.currentYearly) * 100);
  });
});

describe('parseFeeSchedule', () => {
  it('round-trips the defaults', () => {
    expect(parseFeeSchedule(DEFAULT_FEE_SCHEDULE)).toEqual(DEFAULT_FEE_SCHEDULE);
  });

  it('rejects bad values, duplicate ids and unknown scenarios', () => {
    const line = DEFAULT_FEE_SCHEDULE.lines[0];
    expect(parseFeeSchedule({ ...DEFAULT_FEE_SCHEDULE, mgmtScenario: 'maybe' })).toBeNull();
    expect(parseFeeSchedule({ ...DEFAULT_FEE_SCHEDULE, lines: [line, line] })).toBeNull();
    expect(parseFeeSchedule({ ...DEFAULT_FEE_SCHEDULE, lines: [{ ...line, current: { basis: 'flat', amount: -5 } }] })).toBeNull();
    expect(parseFeeSchedule({ ...DEFAULT_FEE_SCHEDULE, lines: [{ ...line, proposed: { basis: 'pct_month', amount: 5000 } }] })).toBeNull();
    expect(parseFeeSchedule({ ...DEFAULT_FEE_SCHEDULE, lines: [{ ...line, name: ' ' }] })).toBeNull();
  });
});
