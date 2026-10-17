import { beforeEach, expect, it, vi } from 'vitest';
import { generateRentAnalysis } from '../rent-analysis';
import { getComps, getBaselines } from '../comps';
import { refreshRentCastComps } from '../rentcast-comps';
import type { RentalComp, SubjectProperty } from '@/types/comps';

vi.mock('../comps', () => ({ getComps: vi.fn(), getBaselines: vi.fn() }));
vi.mock('../rentcast-comps', () => ({ refreshRentCastComps: vi.fn() }));
vi.mock('../rentcast', () => ({ getRentEstimate: vi.fn().mockResolvedValue(null), getValueEstimate: vi.fn().mockResolvedValue(null) }));

const subject: SubjectProperty = { address: '123 Example St', town: 'La Pine', bedrooms: 3,
  bathrooms: 2, sqft: 1500, property_type: 'SFR', amenities: [] };
const comp = { id: 'listing', address: '456 Example St', town: 'La Pine', bedrooms: 3,
  bathrooms: 2, sqft: 1500, monthly_rent: 2100, rent_per_sqft: 1.4, property_type: 'SFR',
  data_source: 'rentcast', comp_date: new Date().toISOString().slice(0, 10), amenities: [] } as unknown as RentalComp;

beforeEach(() => { vi.clearAllMocks(); vi.mocked(getBaselines).mockResolvedValue([]); });

it('uses newly fetched listings in an initially empty town to produce a recommendation', async () => {
  let saved: RentalComp[] = [];
  vi.mocked(getComps).mockImplementation(async () => saved);
  vi.mocked(refreshRentCastComps).mockImplementation(async () => { saved = [comp]; return 1; });
  const analysis = await generateRentAnalysis(subject, 'test@highdesertpm.com');
  expect(analysis.stats.count).toBe(1);
  expect(analysis.recommended_rent_mid).toBeGreaterThan(0);
  expect(analysis.comparable_comps[0].address).toBe('456 Example St');
  expect(analysis.methodology_notes.join(' ')).toContain('advertised asking rents');
});

it('keeps saved comps usable and explains an external refresh failure', async () => {
  vi.mocked(getComps).mockResolvedValue([comp]);
  vi.mocked(refreshRentCastComps).mockRejectedValue(new Error('Provider temporarily unavailable'));
  const analysis = await generateRentAnalysis(subject, 'test@highdesertpm.com');
  expect(analysis.stats.count).toBe(1);
  expect(analysis.recommended_rent_mid).toBeGreaterThan(0);
  expect(analysis.methodology_notes.join(' ')).toContain('could not be refreshed');
});

it('falls back to a wider RentCast estimate when a small town has no comps', async () => {
  const { getRentEstimate } = await import('../rentcast');
  vi.mocked(getComps).mockResolvedValue([]);
  vi.mocked(refreshRentCastComps).mockResolvedValue(0);
  vi.mocked(getBaselines).mockResolvedValue([{ area_name: 'Maupin', county: 'Wasco', bedrooms: 3, fmr_rent: 2225 } as never]);
  const wide = { rent: 2390, rentRangeLow: 1920, rentRangeHigh: 2860, comparables: [
    { formattedAddress: '1 Main St, Tygh Valley, OR', city: 'Tygh Valley', state: 'OR', zipCode: '97063', bedrooms: 3, bathrooms: 1, squareFootage: 1200, propertyType: 'Single Family', rent: 1450, correlation: 0.9, daysOld: 170, distance: 5 },
    { formattedAddress: '2 Oak St, The Dalles, OR', city: 'The Dalles', state: 'OR', zipCode: '97058', bedrooms: 3, bathrooms: 2, squareFootage: 1600, propertyType: 'Single Family', rent: 3150, correlation: 0.8, daysOld: 1, distance: 30 },
  ] };
  vi.mocked(getRentEstimate).mockResolvedValueOnce(null).mockResolvedValueOnce(wide);

  const analysis = await generateRentAnalysis({ ...subject, town: 'Maupin' }, 'test@highdesertpm.com');

  expect(vi.mocked(getRentEstimate).mock.calls[1][1]).toMatchObject({ maxRadius: 50, daysOld: 365 });
  expect(analysis.recommended_rent_mid).toBe(2390);
  expect(analysis.rentcast_rent_estimate?.rent).toBe(2390);
  const notes = analysis.methodology_notes.join(' ');
  expect(notes).toContain('No saved comparable rentals in Maupin');
  expect(notes).toContain('5-30 miles away');
  expect(notes).toContain('Tygh Valley, The Dalles');
  expect(notes).toContain('HUD FMR for Maupin 3BR: $2225/mo');
});

it('still reports no recommendation when even the wide search finds nothing', async () => {
  vi.mocked(getComps).mockResolvedValue([]);
  vi.mocked(refreshRentCastComps).mockResolvedValue(0);
  const analysis = await generateRentAnalysis(subject, 'test@highdesertpm.com');
  expect(analysis.recommended_rent_mid).toBe(0);
  expect(analysis.methodology_notes[0]).toContain('No comparable properties found');
});
