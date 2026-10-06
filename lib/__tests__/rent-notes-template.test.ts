import { describe, expect, it } from 'vitest';
import { rentNotesSources, standardRentNotes } from '../rent-notes-template';
import { generateRentReportPdf } from '../rent-report-pdf';
import type { RentAnalysis } from '@/types/comps';

const analysis = (over: Partial<RentAnalysis> = {}) => ({
  subject: { address: '1 Main St', town: 'Redmond', zip_code: '97756', bedrooms: 3, bathrooms: 2, sqft: 1500, property_type: 'SFR' },
  comparable_comps: [{ data_source: 'appfolio' }, { data_source: 'rentcast' }],
  competing_listings: [],
  baselines: [{ area_name: 'Redmond', bedrooms: 3, fmr_rent: 2336 }],
  rentcast_rent_estimate: { rent: 2500, rentRangeLow: 2300, rentRangeHigh: 2700, comparables: [] },
  ...over,
}) as unknown as RentAnalysis;

describe('standard rent notes', () => {
  it('names only the sources this analysis used', () => {
    const sources = rentNotesSources(analysis());
    expect(sources.join(' ')).toMatch(/our own rent records/);
    expect(sources.join(' ')).toMatch(/RentCast/);
    expect(sources.join(' ')).toMatch(/Fair Market Rent/);
    expect(sources.join(' ')).not.toMatch(/Zillow|Rentometer/);
    expect(rentNotesSources(analysis({ comparable_comps: [], baselines: [], rentcast_rent_estimate: undefined }))).toEqual([]);
  });
  it('explains the method, asks to talk and visit, and lists owner choices', () => {
    const text = standardRentNotes(analysis());
    expect(text.startsWith('How we arrived at this range:\n\nTo build this range')).toBe(true);
    expect(text).toContain('in Redmond');
    expect(text).toMatch(/walk through it together/);
    expect(text).toMatch(/landscaping/);
    expect(text).toContain('Give us a call at (541) 548-0383');
  });
  it('fits in the PDF notes section', () => {
    const a = { ...analysis(), stats: { count: 2, avg_rent: 2400, median_rent: 2400, min_rent: 2300, max_rent: 2500, avg_sqft: null, avg_rent_per_sqft: null },
      recommended_rent_low: 2300, recommended_rent_mid: 2400, recommended_rent_high: 2500, methodology_notes: [], generated_at: '2026-10-06T12:00:00Z', generated_by: 't@highdesertpm.com',
      comparable_comps: [], manager_notes: standardRentNotes(analysis()) } as unknown as RentAnalysis;
    expect(generateRentReportPdf(a).length).toBeGreaterThan(1000);
  });
});
