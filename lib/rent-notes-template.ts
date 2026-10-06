/**
 * Standard "Notes from High Desert Property Management" for an owner rent
 * analysis: how we arrived at the range, where we looked, and why a
 * conversation and a visit make it more precise. Staff insert it, then edit.
 * Only names the sources this analysis actually used.
 */

import type { RentAnalysis } from '@/types/comps';

const PHONE = '(541) 548-0383';

export function rentNotesSources(analysis: Pick<RentAnalysis, 'comparable_comps' | 'competing_listings' | 'baselines' | 'rentcast_rent_estimate'>): string[] {
  const comps = analysis.comparable_comps ?? [];
  const listings = analysis.competing_listings ?? [];
  const has = (src: string) => comps.some((c) => c.data_source === src);
  const sources: string[] = [];
  if (has('appfolio')) sources.push('homes we currently lease and manage in the area (our own rent records)');
  if (has('manual')) sources.push('recent leases we track by hand');
  if (has('rentcast') || listings.some((l) => l.source === 'rentcast')) sources.push('rentals currently advertised near the property (RentCast)');
  if (listings.some((l) => l.source === 'zillow')) sources.push('competing listings on Zillow');
  if (analysis.rentcast_rent_estimate) sources.push("RentCast's rent estimate for this address");
  if (has('rentometer')) sources.push('Rentometer market data');
  if ((analysis.baselines ?? []).length > 0) sources.push("HUD's Fair Market Rent for the area");
  return sources;
}

function listSentence(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function standardRentNotes(analysis: Pick<RentAnalysis, 'subject' | 'comparable_comps' | 'competing_listings' | 'baselines' | 'rentcast_rent_estimate'>): string {
  const town = analysis.subject?.town;
  const sources = rentNotesSources(analysis);
  const where = sources.length
    ? `To build this range we compared your home with ${listSentence(sources)}.`
    : 'To build this range we compared your home with similar rentals in the area.';
  return [
    'How we arrived at this range',
    `${where} We give the most weight to homes closest to yours${town ? ` in ${town}` : ''} in bedrooms, bathrooms, size and location, and adjust for square footage and property type.`,
    '',
    'This is a desk estimate from market data and public records. It can\'t see your home\'s condition, updates, finishes, yard or views, and those can move the rent in either direction. To make it more precise, we\'d like to talk with you about the property and, ideally, walk through it together.',
    '',
    'Your choices as the owner also change the rent, for example:',
    '- whether you or the tenant handle landscaping and snow removal',
    '- whether pets are allowed, and any pet rent or deposit',
    '- which utilities, if any, are included',
    '- lease length, and whether the home is furnished',
    '- any updates or repairs before a new tenant moves in',
    '',
    `Give us a call at ${PHONE} and we'll walk through the numbers with you.`,
  ].join('\n');
}
