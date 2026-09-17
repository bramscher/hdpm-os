/**
 * Rent Analysis Engine
 *
 * Computes recommended rent for a subject property based on
 * comparable comps in the database, HUD FMR baselines, and
 * optional competing listings from Zillow.
 */

import { getComps, getBaselines } from './comps';
import { getValueEstimate, getRentEstimate } from './rentcast';
import { refreshRentCastComps } from './rentcast-comps';
import type {
  SubjectProperty,
  RentAnalysis,
  RentalComp,
  CompetingListing,
  CompsFilter,
  CompsStats,
  MarketBaseline,
  RentCastValueEstimate,
  RentCastRentEstimate,
} from '@/types/comps';

// ============================================
// Helpers
// ============================================

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const frac = idx - lower;
  if (lower + 1 < sorted.length) {
    return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower]);
  }
  return sorted[lower];
}

function round(value: number): number {
  return Math.round(value);
}

// ============================================
// Similarity Scoring
// ============================================

/**
 * Score how similar a comp is to the subject property.
 * Higher score = more similar.
 */
function computeSimilarityScore(
  subject: SubjectProperty,
  comp: RentalComp
): number {
  let score = 0;

  // Town match (required for the query, but score it anyway)
  if (comp.town === subject.town) score += 10;

  // Bedroom match
  if (comp.bedrooms === subject.bedrooms) {
    score += 10;
  } else if (Math.abs(comp.bedrooms - subject.bedrooms) === 1) {
    score += 3;
  }

  // Bathroom match
  if (subject.bathrooms && comp.bathrooms) {
    if (comp.bathrooms === subject.bathrooms) {
      score += 5;
    } else if (Math.abs(comp.bathrooms - subject.bathrooms) <= 0.5) {
      score += 2;
    }
  }

  // Property type match
  if (comp.property_type === subject.property_type) {
    score += 5;
  }

  // Sqft proximity (within 20% = +5, within 40% = +2)
  if (subject.sqft && comp.sqft) {
    const diff = Math.abs(comp.sqft - subject.sqft) / subject.sqft;
    if (diff <= 0.2) score += 5;
    else if (diff <= 0.4) score += 2;
  }

  // Recency (within 3 months = +3, within 6 months = +1)
  if (comp.comp_date) {
    const compDate = new Date(comp.comp_date);
    const now = new Date();
    const monthsAgo =
      (now.getFullYear() - compDate.getFullYear()) * 12 +
      (now.getMonth() - compDate.getMonth());
    if (monthsAgo <= 3) score += 3;
    else if (monthsAgo <= 6) score += 1;
  }

  // Amenity overlap
  if (subject.amenities && subject.amenities.length > 0 && comp.amenities) {
    const overlap = subject.amenities.filter((a) =>
      comp.amenities.includes(a)
    ).length;
    score += Math.min(overlap, 3); // up to +3 for amenity matches
  }

  return score;
}

// ============================================
// Recommended Rent Calculation
// ============================================

interface RentRecommendation {
  low: number;
  mid: number;
  high: number;
  notes: string[];
}

function computeRecommendedRent(
  subject: SubjectProperty,
  comparables: RentalComp[],
  baselines: MarketBaseline[],
  competingListings: CompetingListing[],
  rentCastRent?: RentCastRentEstimate | null,
  rentCastValue?: RentCastValueEstimate | null
): RentRecommendation {
  const notes: string[] = [];
  const rents = comparables.map((c) => Number(c.monthly_rent));

  if (rents.length === 0) {
    return {
      low: 0,
      mid: 0,
      high: 0,
      notes: ['No comparable properties found. Unable to compute recommendation.'],
    };
  }

  // Base: 60% median + 40% 60th-percentile
  const med = median(rents);
  const p60 = percentile(rents, 60);
  let recommended = med * 0.6 + p60 * 0.4;
  notes.push(
    `Base: 60% of median ($${round(med)}) + 40% of 60th percentile ($${round(p60)}) = $${round(recommended)}`
  );

  // Sqft adjustment
  if (subject.sqft) {
    const compSqfts = comparables
      .filter((c) => c.sqft && c.sqft > 0)
      .map((c) => c.sqft!);

    if (compSqfts.length > 0) {
      const avgCompSqft = compSqfts.reduce((a, b) => a + b, 0) / compSqfts.length;
      const rentPerSqft = comparables
        .filter((c) => c.rent_per_sqft && c.rent_per_sqft > 0)
        .map((c) => Number(c.rent_per_sqft!));

      if (rentPerSqft.length > 0) {
        const avgRentPerSqft =
          rentPerSqft.reduce((a, b) => a + b, 0) / rentPerSqft.length;
        const sqftDiff = subject.sqft - avgCompSqft;

        if (Math.abs(sqftDiff) > 100) {
          // Only adjust if meaningful difference
          const adjustment = sqftDiff * avgRentPerSqft * 0.5; // 50% weight on sqft diff
          recommended += adjustment;
          notes.push(
            `Sqft adjustment: subject ${subject.sqft} sqft vs avg ${round(avgCompSqft)} sqft: ${adjustment > 0 ? '+' : ''}$${round(adjustment)}`
          );
        }
      }
    }
  }

  // Property type premium
  const typeOrder: Record<string, number> = {
    SFR: 1.05,
    Townhouse: 1.02,
    Duplex: 1.0,
    Condo: 0.98,
    Apartment: 0.95,
    Manufactured: 0.90,
    Other: 1.0,
  };
  const subjectMultiplier = typeOrder[subject.property_type] || 1.0;
  const avgCompMultiplier =
    comparables.reduce(
      (sum, c) => sum + (typeOrder[c.property_type] || 1.0),
      0
    ) / comparables.length;

  if (Math.abs(subjectMultiplier - avgCompMultiplier) > 0.02) {
    const typeAdj = recommended * (subjectMultiplier - avgCompMultiplier);
    recommended += typeAdj;
    notes.push(
      `Property type adjustment (${subject.property_type}): ${typeAdj > 0 ? '+' : ''}$${round(typeAdj)}`
    );
  }

  // HUD FMR floor check
  const townBaseline = baselines.find(
    (b) =>
      b.area_name === subject.town &&
      b.bedrooms === subject.bedrooms &&
      b.fmr_rent
  );
  if (townBaseline?.fmr_rent) {
    const fmr = Number(townBaseline.fmr_rent);
    if (recommended < fmr) {
      notes.push(
        `Note: Recommendation ($${round(recommended)}) is below HUD FMR ($${round(fmr)}). Market may support higher rent.`
      );
    } else {
      notes.push(
        `HUD FMR for ${subject.town} ${subject.bedrooms}BR: $${round(fmr)}/mo`
      );
    }
  }

  // Factor in competing listings if available
  if (competingListings.length > 0) {
    const compPrices = competingListings.map((l) => l.price);
    const compMedian = median(compPrices);
    const blendedRec = recommended * 0.8 + compMedian * 0.2;
    notes.push(
      `Zillow competing median ($${round(compMedian)}) blended at 20% weight: $${round(blendedRec)}`
    );
    recommended = blendedRec;
  }

  // Factor in RentCast rent estimate if available
  if (rentCastRent) {
    const rcRent = rentCastRent.rent;
    const blendedRec = recommended * 0.85 + rcRent * 0.15;
    notes.push(
      `RentCast rent estimate: $${round(rcRent)}/mo (range: $${round(rentCastRent.rentRangeLow)}-$${round(rentCastRent.rentRangeHigh)}) blended at 15% weight: $${round(blendedRec)}`
    );
    if (rentCastRent.comparables.length > 0) {
      notes.push(
        `RentCast provided ${rentCastRent.comparables.length} rental comparables`
      );
    }
    recommended = blendedRec;
  }

  // Add RentCast value estimate context (informational, not blended into rent)
  if (rentCastValue) {
    notes.push(
      `RentCast property value estimate: $${rentCastValue.price.toLocaleString()} (range: $${rentCastValue.priceRangeLow.toLocaleString()}-$${rentCastValue.priceRangeHigh.toLocaleString()})`
    );
    if (rentCastValue.comparables.length > 0) {
      notes.push(
        `RentCast provided ${rentCastValue.comparables.length} sale comparables for valuation`
      );
    }
  }

  // Generate range: -5% to +5%
  const low = round(recommended * 0.95);
  const mid = round(recommended);
  const high = round(recommended * 1.05);

  notes.push(
    `Recommended range: $${low.toLocaleString()} - $${high.toLocaleString()}/mo`
  );

  return { low, mid, high, notes };
}

// ============================================
// Public: Generate Rent Analysis
// ============================================

export async function generateRentAnalysis(
  subject: SubjectProperty,
  userEmail: string,
  competingListings?: CompetingListing[]
): Promise<RentAnalysis> {
  // 1. Build filter for comparable properties
  const filter: CompsFilter = {
    towns: [subject.town],
    bedrooms: [
      Math.max(0, subject.bedrooms - 1),
      subject.bedrooms,
      subject.bedrooms + 1,
    ],
  };

  // Refresh actual market listings before reading the database. Existing comps
  // remain usable if the external provider is temporarily unavailable.
  let refreshWarning: string | undefined;
  const loadComps = async () => {
    try {
      await refreshRentCastComps(subject.town, userEmail);
    } catch (error) {
      console.warn('[Rent analysis] Rental listing refresh failed:', error);
      refreshWarning = 'Current rental listings could not be refreshed; this analysis uses previously saved comps.';
    }
    return getComps(filter, 500);
  };

  // 2. Fetch comps, baselines, and RentCast estimates in parallel
  const [allComps, baselines, rentCastRent, rentCastValue] = await Promise.all([
    loadComps(),
    getBaselines(),
    getRentEstimate(subject.address, {
      bedrooms: subject.bedrooms,
      bathrooms: subject.bathrooms,
      squareFootage: subject.sqft,
    }),
    getValueEstimate(subject.address, {
      bedrooms: subject.bedrooms,
      bathrooms: subject.bathrooms,
      squareFootage: subject.sqft,
    }),
  ]);

  // 3. Score and rank comparables by similarity
  const scored = allComps.map((comp) => ({
    comp,
    score: computeSimilarityScore(subject, comp),
  }));
  scored.sort((a, b) => b.score - a.score);
  const comparableComps = scored.slice(0, 15).map((s) => s.comp);

  // 4. Compute stats on the comparable set
  const rents = comparableComps.map((c) => Number(c.monthly_rent));
  const sqfts = comparableComps
    .filter((c) => c.sqft && c.sqft > 0)
    .map((c) => c.sqft!);
  const rpsValues = comparableComps
    .filter((c) => c.rent_per_sqft && Number(c.rent_per_sqft) > 0)
    .map((c) => Number(c.rent_per_sqft));

  const stats: CompsStats = {
    count: comparableComps.length,
    avg_rent: rents.length > 0 ? round(rents.reduce((a, b) => a + b, 0) / rents.length) : 0,
    median_rent: round(median(rents)),
    min_rent: rents.length > 0 ? Math.min(...rents) : 0,
    max_rent: rents.length > 0 ? Math.max(...rents) : 0,
    avg_sqft: sqfts.length > 0 ? round(sqfts.reduce((a, b) => a + b, 0) / sqfts.length) : null,
    avg_rent_per_sqft:
      rpsValues.length > 0
        ? Math.round((rpsValues.reduce((a, b) => a + b, 0) / rpsValues.length) * 100) / 100
        : null,
  };

  // 5. Build competing listings (include RentCast rental comps if available)
  const allCompetingListings: CompetingListing[] = [...(competingListings || [])];

  if (rentCastRent?.comparables) {
    const now = new Date().toISOString();
    for (const rc of rentCastRent.comparables) {
      if (rc.rent && rc.rent > 0) {
        allCompetingListings.push({
          address: rc.formattedAddress,
          price: rc.rent,
          bedrooms: rc.bedrooms,
          bathrooms: rc.bathrooms,
          sqft: rc.squareFootage,
          source: 'rentcast',
          fetched_at: now,
        });
      }
    }
  }

  // 6. Calculate recommended rent
  const { low, mid, high, notes } = computeRecommendedRent(
    subject,
    comparableComps,
    baselines,
    allCompetingListings,
    rentCastRent,
    rentCastValue
  );
  if (refreshWarning) notes.push(refreshWarning);
  if (comparableComps.some((comp) => comp.data_source === 'rentcast')) {
    notes.push('RentCast database comps reflect advertised asking rents as of the listed comp date, not verified signed leases.');
  }

  return {
    subject,
    stats,
    comparable_comps: comparableComps,
    competing_listings: allCompetingListings,
    baselines,
    recommended_rent_low: low,
    recommended_rent_mid: mid,
    recommended_rent_high: high,
    methodology_notes: notes,
    rentcast_value_estimate: rentCastValue ?? undefined,
    rentcast_rent_estimate: rentCastRent ?? undefined,
    generated_at: new Date().toISOString(),
    generated_by: userEmail,
  };
}
