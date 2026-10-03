import { describe, expect, it } from 'vitest';
import { buildNearbyRentals, distanceLabel, yourRent } from '../rent-report-nearby';
import type { RentAnalysis, RentCastComparable } from '@/types/comps';

const TODAY = '2026-10-03';
const comp = (rent: number, correlation: number, over: Partial<RentCastComparable> = {}): RentCastComparable => ({
  formattedAddress: `${rent} Example St, Redmond, OR 97756`,
  city: 'Redmond', state: 'OR', zipCode: '97756', bedrooms: 3, bathrooms: 2, squareFootage: 1400, propertyType: 'Single Family',
  rent, correlation, daysOld: 10, ...over,
});
const analysis = (comps: RentCastComparable[], over: Partial<RentAnalysis> = {}) =>
  ({
    subject: { address: '2741 NE Laramie Way, Bend, OR', town: 'Bend', bedrooms: 3, bathrooms: 2, sqft: 1392, property_type: 'SFR' },
    recommended_rent_low: 2400, recommended_rent_mid: 2600, recommended_rent_high: 2800,
    rentcast_rent_estimate: { rent: 2600, rentRangeLow: 2400, rentRangeHigh: 2800, comparables: comps },
    ...over,
  }) as unknown as RentAnalysis;

const comps = [comp(2750, 0.98, { distance: 2.2, squareFootage: 1350 }), comp(2500, 0.97, { distance: 0.6 }), comp(2600, 0.95), comp(2300, 0.92, { lastSeenDate: '2026-06-25T00:00:00Z' }), comp(2825, 0.9, { listedDate: '2026-08-01' })];

describe('nearby rentals page model', () => {
  it('needs at least three RentCast comps', () => {
    expect(buildNearbyRentals(analysis(comps.slice(0, 2)), TODAY)).toBeNull();
    expect(buildNearbyRentals(analysis([]), TODAY)).toBeNull();
  });

  it('compares each similar rental with your unit, most similar first', () => {
    const m = buildNearbyRentals(analysis(comps, { recommended_rent_override: 2700 }), TODAY)!;
    expect(m.unit.rent).toBe(2700);
    expect(m.rows.map((r) => r.similarity)).toEqual([98, 97, 95, 92, 90]);
    expect(m.rows[0]).toMatchObject({ rent: 2750, rentDiff: 50, sqft: 1350, sqftDiff: -42, distanceLabel: 'about 2 miles away' });
    expect(m.rows[1]).toMatchObject({ rentDiff: -200, distanceLabel: 'under a mile', sqftDiff: 8 });
    expect(m.rows[2].distanceLabel).toBe('—');
    expect(m.above).toBe(2);
    expect(m.below).toBe(3);
  });

  it('dates rentals from last seen, then listed, then days old', () => {
    const m = buildNearbyRentals(analysis(comps), TODAY)!;
    const byRent = Object.fromEntries(m.rows.map((r) => [r.rent, r.lastAdvertised]));
    expect(byRent[2300]).toBe('2026-06-25');
    expect(byRent[2825]).toBe('2026-08-01');
    expect(byRent[2600]).toBe('2026-09-23');
  });

  it('bins rents from low to high with the median and your rent marked', () => {
    const m = buildNearbyRentals(analysis(comps), TODAY)!;
    expect(m).toMatchObject({ low: 2300, high: 2825, median: 2600, binWidth: 50 });
    expect(m.bins.reduce((n, b) => n + b.count, 0)).toBe(5);
    expect(m.bins[0].from).toBe(2300);
    expect(m.bins[m.bins.length - 1].to).toBeGreaterThanOrEqual(2825);
    expect(m.bins[m.medianBin].from).toBeLessThanOrEqual(2600);
    expect(m.bins[m.medianBin].to).toBeGreaterThanOrEqual(2600);
    expect(m.bins[m.yourBin].from).toBeLessThanOrEqual(yourRent({ recommended_rent_mid: 2600 }));
  });

  it('widens bins when rents are spread out', () => {
    const wide = [comp(1400, 0.8), comp(2950, 0.9), comp(2400, 0.85)];
    const m = buildNearbyRentals(analysis(wide), TODAY)!;
    expect(m.bins.length).toBeLessThanOrEqual(16);
    expect(m.binWidth % 25).toBe(0);
    expect(m.bins.reduce((n, b) => n + b.count, 0)).toBe(3);
  });

  it('words distances like AppFolio', () => {
    expect(distanceLabel(undefined)).toBe('—');
    expect(distanceLabel(0.4)).toBe('under a mile');
    expect(distanceLabel(1.2)).toBe('about 1 mile away');
    expect(distanceLabel(6.6)).toBe('about 7 miles away');
  });
});
