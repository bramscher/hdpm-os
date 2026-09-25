import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIER_RULES,
  DEFAULT_WEIGHTS,
  buildOwnerRows,
  campaignFunnel,
  nextRenewal,
  ownerRowsToCsv,
  parseAgreement,
  parseCampaign,
  parseTierRules,
  portfolioSummary,
  targetPctFor,
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
  buildOwnerRows({ facts: facts(properties), rules: DEFAULT_TIER_RULES, weights: DEFAULT_WEIGHTS, agreements: [], campaign: [], today: TODAY, ...extra });

describe('tier targets', () => {
  it('applies the default increments by range and holds 10%+', () => {
    expect(targetPctFor(5.5, DEFAULT_TIER_RULES)).toBe(7);
    expect(targetPctFor(6, DEFAULT_TIER_RULES)).toBe(7);
    expect(targetPctFor(7.7, DEFAULT_TIER_RULES)).toBe(8.45);
    expect(targetPctFor(9, DEFAULT_TIER_RULES)).toBe(9.25);
    expect(targetPctFor(10, DEFAULT_TIER_RULES)).toBe(10);
    expect(targetPctFor(4, DEFAULT_TIER_RULES)).toBe(4); // no rule → hold
  });

  it('rejects overlapping or malformed rules', () => {
    expect(parseTierRules([{ min: 5, max: 7, addPts: 1 }, { min: 6, max: 8, addPts: 1 }])).toBeNull();
    expect(parseTierRules([{ min: 5, max: null, addPts: 1 }, { min: 6, max: 8, addPts: 1 }])).toBeNull();
    expect(parseTierRules([{ min: 5, max: 4, addPts: 1 }])).toBeNull();
    expect(parseTierRules(DEFAULT_TIER_RULES)).toEqual(DEFAULT_TIER_RULES);
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
  it('blends fee % by rent, not by simple average', () => {
    const [r] = rows([
      prop({ id: 'a', feePct: 5, occupiedRentMonthly: 3000 }),
      prop({ id: 'b', feePct: 10, occupiedRentMonthly: 1000 }),
    ]);
    // (3000×5 + 1000×10) / 4000 = 6.25 (a simple average would be 7.5)
    expect(r.blendedPct).toBe(6.25);
    expect(r.blendedBasis).toBe('rent');
    // targets: 5→6.5, 10→10 hold; added = 36000×1.5% = 540/yr
    expect(Math.round(r.addedYearly)).toBe(540);
    expect(r.targetPct).toBe(7.38); // (36000×6.5 + 12000×10) / 48000 = 7.375
    expect(r.gapPts).toBe(1.13);
  });

  it('falls back to door weighting when nothing is occupied', () => {
    const [r] = rows([prop({ feePct: 6, occupiedDoors: 0, occupiedRentMonthly: 0, doors: 2 })]);
    expect(r.blendedBasis).toBe('doors');
    expect(r.blendedPct).toBe(6);
    expect(r.addedYearly).toBe(0);
  });

  it('includes flat fees in current fees but not in the % blend', () => {
    const [r] = rows([prop({ feeType: 'flat', feePct: null, flatMonthly: 250 })]);
    expect(r.blendedPct).toBeNull();
    expect(r.currentFeesMonthly).toBe(250);
    expect(r.tier).toBe('Flat');
  });

  it('takes the earliest agreement end across properties', () => {
    const [r] = rows([
      prop({ id: 'a', mgmtStartDate: '2019-12-01' }),
      prop({ id: 'b', mgmtStartDate: '2019-10-15' }),
    ]);
    expect(r.earliestRenewal?.date).toBe('2026-10-15');
  });

  it('segments: personal call for 3+ doors or top upside, letter for single door, renewal-timed ≤180d', () => {
    const out = rows([
      prop({ id: 'a', ownerSetKey: 'big', doors: 3, occupiedDoors: 3, feePct: 9.5, mgmtStartDate: '2020-06-01' }),
      prop({ id: 'b', ownerSetKey: 'single', doors: 1, feePct: 9.5, mgmtStartDate: '2020-06-01' }),
      prop({ id: 'c', ownerSetKey: 'soon', doors: 2, feePct: 10, mgmtStartDate: '2020-10-01' }),
      prop({ id: 'd', ownerSetKey: 'held', doors: 1, feePct: 10, mgmtStartDate: '2020-06-01' }),
    ]);
    const by = Object.fromEntries(out.map((r) => [r.key, r.segments]));
    expect(by.big).toContain('Personal call');
    // 'single' has upside so it is in the top 20 → personal call, not letter.
    expect(by.single).toEqual(['Personal call']);
    expect(by.soon).toEqual(['Renewal-timed']); // held at 10%: no upside, 2 doors
    expect(by.held).toEqual(['Letter']); // single door, no upside, renewal 250d out
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
    // 6→7, 8→8.5: (12000×1 + 12000×0.5)/100 = 180
    expect(Math.round(s.addedYearly)).toBe(180);
    expect(s.newEffectivePct).toBe(7.75);
  });

  it('funnel uses the accepted new fee when on file', () => {
    const out = rows([prop({ feePct: 6, occupiedRentMonthly: 1000 })], {
      campaign: [{ ownerSetKey: 'o1', status: 'accepted', newFeePct: 8, effectiveDate: null, assignedTo: null, notes: null, updatedAt: null }],
    });
    const accepted = campaignFunnel(out).find((f) => f.status === 'accepted')!;
    expect(accepted.count).toBe(1);
    expect(Math.round(accepted.dollarsYearly)).toBe(240); // 12000 × 2%
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
