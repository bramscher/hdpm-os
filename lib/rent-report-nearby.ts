/**
 * "Nearby Rentals" page of the rent analysis PDF, modelled on AppFolio's
 * Nearby Advertised Units view: a rent histogram with the median and the
 * recommended rent marked, then similar rentals ranked by RentCast's
 * similarity score, each compared with the subject. Pure (no PDF drawing),
 * so it is unit-tested directly.
 *
 * Source: RentCast's rent AVM comparables, already fetched for every
 * analysis (analysis.rentcast_rent_estimate.comparables). AppFolio's own
 * network data isn't available through our APIs.
 */

import type { RentAnalysis } from '@/types/comps';

export interface NearbyRow {
  address: string;
  /** RentCast match score, 0–100. */
  similarity: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  /** Comp sq ft minus the subject's (null when either is unknown). */
  sqftDiff: number | null;
  distanceLabel: string;
  /** yyyy-mm-dd the rental was last seen advertised. */
  lastAdvertised: string | null;
  rent: number;
  /** Comp rent minus your rent: positive means the comp asks more. */
  rentDiff: number;
}

export interface NearbyBin {
  from: number;
  to: number;
  count: number;
}

export interface NearbyRentals {
  unit: { address: string; bedrooms: number; bathrooms: number | null; sqft: number | null; rent: number };
  rows: NearbyRow[];
  bins: NearbyBin[];
  binWidth: number;
  low: number;
  high: number;
  median: number;
  /** Index of the bin holding the median, and the one holding your rent. */
  medianBin: number;
  yourBin: number;
  above: number;
  below: number;
}

export const MIN_NEARBY = 3;
const MAX_BINS = 16;

export function distanceLabel(miles: number | undefined | null): string {
  if (miles == null || !Number.isFinite(miles)) return '—';
  if (miles < 1) return 'under a mile';
  const n = Math.round(miles);
  return `about ${n} mile${n === 1 ? '' : 's'} away`;
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** The rent the report recommends: the manual override when set, otherwise the target. */
export function yourRent(analysis: Pick<RentAnalysis, 'recommended_rent_override' | 'recommended_rent_mid'>): number {
  return Math.round(analysis.recommended_rent_override || analysis.recommended_rent_mid);
}

export function buildNearbyRentals(analysis: RentAnalysis, today: string): NearbyRentals | null {
  const comps = (analysis.rentcast_rent_estimate?.comparables ?? []).filter((c) => (c.rent ?? c.price ?? 0) > 0);
  if (comps.length < MIN_NEARBY) return null;

  const { subject } = analysis;
  const rent = yourRent(analysis);
  const subjectSqft = subject.sqft || null;

  const rows: NearbyRow[] = comps
    .map((c) => {
      const compRent = Math.round((c.rent ?? c.price)!);
      const sqft = c.squareFootage || null;
      return {
        address: c.formattedAddress,
        similarity: Math.max(0, Math.min(100, Math.round((c.correlation || 0) * 100))),
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        sqft,
        sqftDiff: sqft != null && subjectSqft != null ? sqft - subjectSqft : null,
        distanceLabel: distanceLabel(c.distance),
        lastAdvertised: (c.lastSeenDate || c.listedDate)?.slice(0, 10) ?? (c.daysOld != null ? shiftDays(today, c.daysOld) : null),
        rent: compRent,
        rentDiff: compRent - rent,
      };
    })
    .sort((a, b) => b.similarity - a.similarity || a.rentDiff - b.rentDiff);

  const rents = rows.map((r) => r.rent);
  const low = Math.min(...rents);
  const high = Math.max(...rents);
  const med = median(rents);

  // Bins cover the comps and your rent, so the marker is always on the axis.
  let binWidth = 50;
  const lo = Math.min(low, rent);
  const hi = Math.max(high, rent);
  const span = () => Math.floor(lo / binWidth) * binWidth;
  let start = span();
  let count = Math.floor(hi / binWidth) - Math.floor(lo / binWidth) + 1;
  if (count > MAX_BINS) {
    binWidth = Math.ceil((hi - lo + 1) / MAX_BINS / 25) * 25;
    start = span();
    count = Math.floor(hi / binWidth) - Math.floor(lo / binWidth) + 1;
  }
  const bins: NearbyBin[] = Array.from({ length: count }, (_, i) => ({ from: start + i * binWidth, to: start + (i + 1) * binWidth - 1, count: 0 }));
  const binOf = (v: number) => Math.min(count - 1, Math.max(0, Math.floor((v - start) / binWidth)));
  for (const r of rents) bins[binOf(r)].count++;

  return {
    unit: { address: subject.address, bedrooms: subject.bedrooms, bathrooms: subject.bathrooms ?? null, sqft: subjectSqft, rent },
    rows,
    bins,
    binWidth,
    low,
    high,
    median: med,
    medianBin: binOf(med),
    yourBin: binOf(rent),
    above: rows.filter((r) => r.rentDiff > 0).length,
    below: rows.filter((r) => r.rentDiff < 0).length,
  };
}
