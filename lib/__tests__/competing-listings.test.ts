import { describe, expect, it } from 'vitest';
import { listingSourceLabel, mergeCompetingListings } from '../competing-listings';
import type { CompetingListing } from '@/types/comps';

const l = (address: string, price: number, source: string): CompetingListing =>
  ({ address, price, bedrooms: 3, bathrooms: 2, sqft: 1800, source, fetched_at: '2026-10-03T00:00:00Z' }) as CompetingListing;

describe('competing listings', () => {
  const rentCast = [l('3257 Nw Cedar Ave, Redmond, OR 97756', 2795, 'rentcast'), l('1326 Sw Rimrock Way, Redmond', 2895, 'rentcast')];

  it('re-generating a saved report does not pile up copies of the RentCast comps', () => {
    let listings = mergeCompetingListings([], rentCast);
    // The browser sends back the last analysis's list each time the report is regenerated.
    listings = mergeCompetingListings(listings, rentCast);
    listings = mergeCompetingListings(listings, rentCast);
    expect(listings).toHaveLength(2);
  });

  it('keeps Zillow listings and drops the same address at the same price once', () => {
    const zillow = [l('150 Sw 30th St, Redmond, OR 97756', 2595, 'zillow'), l('150 SW 30th St., Redmond OR 97756', 2595, 'zillow')];
    const merged = mergeCompetingListings(zillow, rentCast);
    expect(merged.map((x) => x.source)).toEqual(['zillow', 'rentcast', 'rentcast']);
  });

  it('names the real sources', () => {
    expect(listingSourceLabel(rentCast)).toBe('RentCast');
    expect(listingSourceLabel([l('a', 1, 'zillow'), ...rentCast])).toBe('Zillow + RentCast');
    expect(listingSourceLabel([])).toBe('none');
  });
});
