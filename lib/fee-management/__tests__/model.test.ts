import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOOR_SCHEDULE,
  DEFAULT_MAX_RAISE_PTS,
  DEFAULT_WEIGHTS,
  bandFor,
  buildOwnerRows,
  campaignFunnel,
  nextRenewal,
  ownerRowsToCsv,
  parseAgreement,
  parseCampaign,
  nextRaisePct,
  parseDoorSchedule,
  portfolioSummary,
  type FeeFacts,
  type PropertyFact,
} from '../model';

const prop = (over: Partial<PropertyFact>): PropertyFact => ({
  id: 'p', name: 'P', address: '', feeType: 'percent', feePct: 8, flatMonthly: null,
  feeStartDate: null, mgmtStartDate: '2020-03-15', doors: 1, occupiedDoors: 1,
  occupiedRentMonthly: 2000, ownerSetKey: 'o1', ...over,
});

const facts = (properties: PropertyFact[]): FeeFacts => ({
  properties,
  ownerSets: [...new Set(properties.map((p) => p.ownerSetKey))].map((key) => ({
    key, name: key.toUpperCase(), owners: [{ id: key, name: key, email: `${key}@x.com`, phone: null, percentOwned: 100 }],
  })),
});

const TODAY = '2026-09-24';
const rows = (properties: PropertyFact[], extra: Partial<Parameters<typeof buildOwnerRows>[0]> = {}) =>
  buildOwnerRows({ facts: facts(properties), schedule: DEFAULT_DOOR_SCHEDULE, maxRaisePts: DEFAULT_MAX_RAISE_PTS, weights: DEFAULT_WEIGHTS, agreements: [], campaign: [], today: TODAY, ...extra });

describe('door schedule', () => {
  it('maps owner door counts to the schedule rate', () => {
    const t = (d: number) => bandFor(d, DEFAULT_DOOR_SCHEDULE)?.targetPct;
    expect([t(1), t(2), t(3), t(4), t(10), t(11), t(15), t(16), t(25), t(26), t(49), t(50), t(300)])
      .toEqual([10, 9.5, 9.5, 9, 9, 8.5, 8.5, 8, 8, 7.5, 7.5, 7, 7]);
    expect(bandFor(50, DEFAULT_DOOR_SCHEDULE)?.review).toBe(true);
  });

  it('steps toward schedule by the raise cap and never lowers a fee', () => {
    expect(nextRaisePct(5.5, 9, 0.75)).toBe(6.25);
    expect(nextRaisePct(8.8, 9, 0.75)).toBe(9);
    expect(nextRaisePct(10, 9, 0.75)).toBe(10);
  });

  it('rejects schedules with gaps, overlaps, or not starting at 1 door', () => {
    expect(parseDoorSchedule(DEFAULT_DOOR_SCHEDULE)).toEqual(DEFAULT_DOOR_SCHEDULE);
    expect(parseDoorSchedule([{ minDoors: 1, maxDoors: 3, targetPct: 10 }, { minDoors: 5, maxDoors: null, targetPct: 9 }])).toBeNull();
    expect(parseDoorSchedule([{ minDoors: 1, maxDoors: 3, targetPct: 10 }, { minDoors: 3, maxDoors: null, targetPct: 9 }])).toBeNull();
    expect(parseDoorSchedule([{ minDoors: 2, maxDoors: null, targetPct: 9 }])).toBeNull();
    expect(parseDoorSchedule([{ minDoors: 1, maxDoors: null, targetPct: 0 }])).toBeNull();
  });
});

describe('nextRenewal', () => {
  it('projects the next start anniversary on or after today', () => {
    expect(nextRenewal('2020-03-15', undefined, TODAY)).toMatchObject({ date: '2027-03-15', source: 'projected', daysUntil: 172 });
    expect(nextRenewal('2020-09-24', undefined, TODAY)).toMatchObject({ date: '2026-09-24', daysUntil: 0 });
  });

  it('handles Feb 29 starts', () => {
    expect(nextRenewal('2024-02-29', undefined, '2026-01-01')?.date).toBe('2026-02-28');
  });

  it('rolls an entered past end date forward when auto-renew is on, and computes notice', () => {
    const r = nextRenewal('2020-03-15', { propertyId: 'p', startDate: null, endDate: '2025-06-30', autoRenew: true, noticeDays: 60, notes: null }, TODAY);
    expect(r).toMatchObject({ date: '2027-06-30', source: 'entered', noticeBy: '2027-05-01' });
  });

  it('leaves a lapsed end date in the past when auto-renew is off', () => {
    const r = nextRenewal(null, { propertyId: 'p', startDate: null, endDate: '2026-01-31', autoRenew: false, noticeDays: null, notes: null }, TODAY);
    expect(r?.daysUntil).toBeLessThan(0);
  });

  it('returns null with no dates at all', () => {
    expect(nextRenewal(null, undefined, TODAY)).toBeNull();
  });
});

describe('buildOwnerRows', () => {
  it('blends fee % by rent and targets the schedule for the owner\'s total doors', () => {
    const [r] = rows([
      prop({ id: 'a', feePct: 5, occupiedRentMonthly: 3000 }),
      prop({ id: 'b', feePct: 10, occupiedRentMonthly: 1000 }),
    ]);
    // (3000×5 + 1000×10) / 4000 = 6.25 (a simple average would be 7.5)
    expect(r.blendedPct).toBe(6.25);
    expect(r.blendedBasis).toBe('rent');
    // 2 doors → 9.5%. Only property a moves (b is above schedule, not cut): 36000 × 4.5% = 1620
    expect(r.targetPct).toBe(9.5);
    expect(Math.round(r.addedYearly)).toBe(1620);
    expect(r.gapPts).toBe(3.25);
    // next raise: a 5 → 5.75 (cap 0.75): 36000 × 0.75% = 270
    expect(Math.round(r.nextRaiseYearly)).toBe(270);
    expect(r.raisesToTarget).toBe(6); // 4.5 pts ÷ 0.75
  });

  it('gives owners at or above schedule a zero gap and zero grade', () => {
    const [r] = rows([prop({ feePct: 10 })]); // 1 door → 10%
    expect(r.gapPts).toBe(0);
    expect(r.addedYearly).toBe(0);
    expect(r.grade).toBe(0);
    expect(r.raisesToTarget).toBe(0);
  });

  it('grades 0–100 on a square-root curve of $ opportunity and sorts by grade', () => {
    const out = rows([
      prop({ id: 'a', ownerSetKey: 'big', doors: 20, occupiedDoors: 20, feePct: 6, occupiedRentMonthly: 40000 }), // 8% target: 480000 × 2% = 9600
      prop({ id: 'b', ownerSetKey: 'mid', doors: 1, feePct: 9, occupiedRentMonthly: 2000 }), // 10%: 24000 × 1% = 240
      prop({ id: 'c', ownerSetKey: 'done', doors: 1, feePct: 10, occupiedRentMonthly: 2000 }),
    ]);
    expect(out.map((r) => [r.key, r.grade])).toEqual([['big', 100], ['mid', 16], ['done', 0]]); // √(240/9600)=0.158
  });

  it('falls back to door weighting when nothing is occupied (no $ opportunity yet)', () => {
    const [r] = rows([prop({ feePct: 6, occupiedDoors: 0, occupiedRentMonthly: 0, doors: 2 })]);
    expect(r.blendedBasis).toBe('doors');
    expect(r.blendedPct).toBe(6);
    expect(r.addedYearly).toBe(0);
    expect(r.grade).toBe(0);
  });

  it('includes flat fees in current fees but not in the % blend', () => {
    const [r] = rows([prop({ feeType: 'flat', feePct: null, flatMonthly: 250 })]);
    expect(r.blendedPct).toBeNull();
    expect(r.currentFeesMonthly).toBe(250);
    expect(r.bandLabel).toBe('Flat fee');
  });

  it('takes the earliest agreement end across properties', () => {
    const [r] = rows([
      prop({ id: 'a', mgmtStartDate: '2019-12-01' }),
      prop({ id: 'b', mgmtStartDate: '2019-10-15' }),
    ]);
    expect(r.earliestRenewal?.date).toBe('2026-10-15');
  });

  it('segments: personal call for 3+ doors or top upside, letter for single door, renewal-timed ≤180d, review for 50+', () => {
    const out = rows([
      prop({ id: 'a', ownerSetKey: 'big', doors: 3, occupiedDoors: 3, feePct: 9, mgmtStartDate: '2020-06-01' }),
      prop({ id: 'b', ownerSetKey: 'single', doors: 1, feePct: 9.5, mgmtStartDate: '2020-06-01' }),
      prop({ id: 'c', ownerSetKey: 'soon', doors: 2, feePct: 10, mgmtStartDate: '2020-10-01' }),
      prop({ id: 'd', ownerSetKey: 'held', doors: 1, feePct: 10, mgmtStartDate: '2020-06-01' }),
      prop({ id: 'e', ownerSetKey: 'huge', doors: 60, occupiedDoors: 60, feePct: 6, mgmtStartDate: '2020-06-01' }),
    ]);
    const by = Object.fromEntries(out.map((r) => [r.key, r.segments]));
    expect(by.big).toContain('Personal call');
    expect(by.single).toEqual(['Personal call']); // has upside → top 20
    expect(by.soon).toEqual(['Renewal-timed']); // at schedule: no upside, 2 doors
    expect(by.held).toEqual(['Letter']);
    expect(by.huge).toEqual(['Personal call', 'Portfolio review']);
  });

  it('scores priority 0–100 with added $ weighted highest', () => {
    const out = rows([
      prop({ id: 'a', ownerSetKey: 'rich', feePct: 5, occupiedRentMonthly: 5000, mgmtStartDate: '2020-06-01' }),
      prop({ id: 'b', ownerSetKey: 'poor', feePct: 9, occupiedRentMonthly: 1000, mgmtStartDate: '2020-06-01' }),
    ]);
    expect(out[0].key).toBe('rich');
    expect(out[0].priority).toBeGreaterThan(out[1].priority);
    expect(out[0].priority).toBeLessThanOrEqual(100);
  });
});

describe('summaries', () => {
  it('computes the new effective portfolio rate', () => {
    const s = portfolioSummary(rows([
      prop({ id: 'a', ownerSetKey: 'x', feePct: 6, occupiedRentMonthly: 1000 }),
      prop({ id: 'b', ownerSetKey: 'y', feePct: 8, occupiedRentMonthly: 1000 }),
    ]));
    expect(s.currentEffectivePct).toBe(7);
    // single-door owners → 10%: 12000×4% + 12000×2% = 720
    expect(Math.round(s.addedYearly)).toBe(720);
    expect(s.newEffectivePct).toBe(10);
    // first raise capped at 0.75: 12000×0.75% × 2 = 180
    expect(Math.round(s.nextRaiseYearly)).toBe(180);
    expect(s.nextRaiseEffectivePct).toBe(7.75);
  });

  it('funnel uses the accepted new fee when on file', () => {
    const out = rows([prop({ feePct: 6, occupiedRentMonthly: 1000 })], {
      campaign: [{ ownerSetKey: 'o1', status: 'accepted', newFeePct: 8, effectiveDate: null, assignedTo: null, notes: null, updatedAt: null }],
    });
    const accepted = campaignFunnel(out).find((f) => f.status === 'accepted')!;
    expect(accepted.count).toBe(1);
    expect(Math.round(accepted.dollarsYearly)).toBe(240); // accepted 8% on file: 12000 × 2%
  });

  it('csv escapes commas and quotes', () => {
    const out = rows([prop({})], {
      campaign: [{ ownerSetKey: 'o1', status: 'contacted', newFeePct: null, effectiveDate: null, assignedTo: null, notes: 'said "maybe", call back', updatedAt: null }],
    });
    expect(ownerRowsToCsv(out)).toContain('"said ""maybe"", call back"');
  });
});

describe('write validation', () => {
  it('parses agreements and rejects bad dates or ranges', () => {
    expect(parseAgreement({ propertyId: 'p', endDate: '2027-01-31', noticeDays: '60' })).toMatchObject({ noticeDays: 60, autoRenew: true });
    expect(parseAgreement({ propertyId: 'p', endDate: '01/31/2027' })).toBeNull();
    expect(parseAgreement({ propertyId: 'p', startDate: '2027-01-01', endDate: '2026-01-01' })).toBeNull();
  });

  it('parses campaign entries and rejects unknown statuses', () => {
    expect(parseCampaign({ ownerSetKey: 'o1', status: 'accepted', newFeePct: '8.5' })).toMatchObject({ newFeePct: 8.5 });
    expect(parseCampaign({ ownerSetKey: 'o1', status: 'maybe' })).toBeNull();
    expect(parseCampaign({ ownerSetKey: 'o1', status: 'contacted', newFeePct: 120 })).toBeNull();
  });
});
