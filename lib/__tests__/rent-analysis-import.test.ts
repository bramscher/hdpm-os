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
