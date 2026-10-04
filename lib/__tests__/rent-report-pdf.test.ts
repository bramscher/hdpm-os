import { describe, expect, it } from 'vitest';
import { generateRentReportPdf } from '../rent-report-pdf';
import type { RentAnalysis } from '@/types/comps';

const NOTE = `Hello Lauren,

Thank you for expressing interest in High Desert Property Management managing your exceptional home.

We would require a comprehensive assessment and discussion regarding any unique features or conditions. However, this preliminary analysis provides an indication of our competitive pricing strategy based on comparable properties and market trends.

Based on the current condition and any undisclosed features, we estimate your home's value to be between $2300 and $2550, without conducting a physical tour. This valuation is solely based on market data and comparable properties.

We would be delighted to engage in a detailed discussion with you on Monday if you are available.

Sincerely,

Craig and Matt`;

function sampleAnalysis(notes: string, listings = 45): RentAnalysis {
  const comp = (i: number) => ({ address: `${100 + i} NW Example St, Redmond, OR 97756`, town: 'Redmond', bedrooms: 3, bathrooms: 2.5, sqft: 1800, monthly_rent: 2400 + i * 10, rent_per_sqft: 1.33, comp_date: '2026-10-01' });
  return {
    subject: { address: '2987 SW Deschutes Ave, Redmond, OR 97756, USA', town: 'Redmond', zip_code: '97756', bedrooms: 3, bathrooms: 3, sqft: 1875, property_type: 'SFR' },
    stats: { count: 15, avg_rent: 2444, median_rent: 2495, min_rent: 1400, max_rent: 2950, avg_sqft: 1845, avg_rent_per_sqft: 1.32 },
    comparable_comps: Array.from({ length: 15 }, (_, i) => comp(i)),
    competing_listings: Array.from({ length: listings }, (_, i) => ({ address: `${200 + i} SW Sample Ave, Redmond, OR 97756`, price: 2500, bedrooms: 3, bathrooms: 2.5, sqft: 1700 })),
    baselines: [{ area_name: 'Redmond', bedrooms: 3, fmr_rent: 2336 }],
    recommended_rent_low: 2405,
    recommended_rent_mid: 2532,
    recommended_rent_high: 2659,
    recommended_rent_override: 2475,
    methodology_notes: ['Base: 60% of median + 40% of 60th percentile'],
    prepared_for: 'Lauren Reynolds',
    manager_notes: notes,
    generated_at: '2026-10-03T12:00:00Z',
    generated_by: 'test@highdesertpm.com',
  } as unknown as RentAnalysis;
}

const pagesOf = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

describe('rent analysis PDF layout', () => {
  it('numbers every page with the real page count, including overflow pages', () => {
    const pdf = generateRentReportPdf(sampleAnalysis(NOTE));
    const text = pdf.toString('latin1');
    const total = pagesOf(pdf);
    expect(total).toBeGreaterThanOrEqual(5); // 45 listings overflow onto a fifth page
    for (let p = 1; p <= total; p++) expect(text).toContain(`Page ${p} of ${total}`);
    expect(text).not.toContain(`of ${total - 1})`);
  });

  it('continues a very long note on the next page instead of running into the footer', () => {
    const long = Array.from({ length: 6 }, () => NOTE).join('\n\n');
    const pdf = generateRentReportPdf(sampleAnalysis(long, 0));
    const text = pdf.toString('latin1');
    expect(text).toContain('NOTES FROM HIGH DESERT PROPERTY MANAGEMENT');
    expect(text).toContain('NOTES \\(CONTINUED\\)');
    expect(text).toContain('MARKET SNAPSHOT');
    const total = pagesOf(pdf);
    for (let p = 1; p <= total; p++) expect(text).toContain(`Page ${p} of ${total}`);
  });

  it('lists only the data sources that contributed, including RentCast database comps', () => {
    const base = sampleAnalysis(NOTE, 0);
    const comps = base.comparable_comps.map((c, i) => ({ ...c, data_source: i < 11 ? 'appfolio' : 'rentcast' }));
    const text = generateRentReportPdf({ ...base, comparable_comps: comps } as RentAnalysis).toString('latin1');
    expect(text).toContain('AppFolio: 11 comps from portfolio data');
    expect(text).toContain('RentCast: 4 advertised rental comps');
    expect(text).toContain('HUD FMR: Redmond 3BR Fair Market Rent');
    expect(text).not.toContain('Rentometer:');
    expect(text).not.toContain('Manual Entry:');
    expect(text).not.toContain('Zillow:');
  });

  it('adds the Nearby Rentals page when RentCast returns enough comparables, and skips it otherwise', () => {
    const comps = [2750, 2500, 2600, 2300, 2825].map((rent, i) => ({
      formattedAddress: `${i} NE Sample Ln, Bend, OR`, city: 'Bend', state: 'OR', zipCode: '97701', bedrooms: 3, bathrooms: 2,
      squareFootage: 1400, propertyType: 'Single Family', rent, correlation: 0.95 - i / 100, daysOld: 10, distance: 1.5,
    }));
    const base = sampleAnalysis(NOTE, 0);
    const withComps = { ...base, rentcast_rent_estimate: { rent: 2550, rentRangeLow: 2300, rentRangeHigh: 2800, comparables: comps } } as RentAnalysis;
    const text = generateRentReportPdf(withComps).toString('latin1');
    expect(text).toContain('NEARBY RENTALS');
    expect(text).toContain('SIMILARITY');
    expect(text).toContain('about 2 miles away');
    expect(text).toContain('Nearby rentals page: 5 RentCast comparables');
    const total = pagesOf(generateRentReportPdf(withComps));
    for (let p = 1; p <= total; p++) expect(text).toContain(`Page ${p} of ${total}`);

    const few = { ...base, rentcast_rent_estimate: { rent: 2550, rentRangeLow: 2300, rentRangeHigh: 2800, comparables: comps.slice(0, 2) } } as RentAnalysis;
    expect(generateRentReportPdf(few).toString('latin1')).not.toContain('NEARBY RENTALS');
  });
});
