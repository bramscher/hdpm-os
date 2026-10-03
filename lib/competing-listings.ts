/**
 * Competing rental listings for a rent analysis: where they came from, and
 * merging the browser's list with freshly fetched RentCast comps without
 * duplicates. Pure, so the PDF and the analysis can both use it.
 */

import type { CompetingListing } from '@/types/comps';

const SOURCE_NAMES: Record<string, string> = { zillow: 'Zillow', rentcast: 'RentCast' };

/** "Zillow", "RentCast" or "Zillow + RentCast": where a set of competing listings came from. */
export function listingSourceLabel(listings: CompetingListing[]): string {
  const names = [...new Set(listings.map((l) => SOURCE_NAMES[l.source ?? ''] ?? (l.source || 'Other')))];
  return names.length ? names.join(' + ') : 'none';
}

/**
 * Competing listings for one analysis. RentCast comps are re-fetched on every
 * run, so any RentCast listings echoed back from a previous analysis (the
 * browser re-sends the last list when a saved report is edited) are dropped
 * and replaced, and the same address at the same price is only listed once.
 * Without this, each re-generate appended another copy of the RentCast comps.
 */
export function mergeCompetingListings(fromClient: CompetingListing[], rentCast: CompetingListing[]): CompetingListing[] {
  const key = (l: CompetingListing) => `${(l.address || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${l.price}`;
  const seen = new Set<string>();
  const out: CompetingListing[] = [];
  for (const l of [...fromClient.filter((l) => l.source !== 'rentcast'), ...rentCast]) {
    const k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}
