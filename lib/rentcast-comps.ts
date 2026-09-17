import { getRentalListings, type RentCastListing } from './rentcast';
import { getSupabaseAdmin } from './supabase';
import { detectCompTown, type CreateCompInput, type PropertyType, type Town } from '@/types/comps';

const PROPERTY_TYPES: Record<string, PropertyType> = {
  'Single Family': 'SFR', Apartment: 'Apartment', 'Multi-Family': 'Apartment',
  Townhouse: 'Townhouse', Condo: 'Condo', Manufactured: 'Manufactured',
};

export function rentalListingsToComps(listings: RentCastListing[], town: Town, userEmail: string): CreateCompInput[] {
  const rows = new Map<string, CreateCompInput>();
  for (const listing of listings) {
    if (listing.status !== 'Active' || listing.state !== 'OR' || detectCompTown(listing.city) !== town) continue;
    if (!listing.id || !listing.formattedAddress || !Number.isFinite(listing.price) || listing.price <= 0) continue;
    if (!Number.isInteger(listing.bedrooms) || listing.bedrooms < 0 || listing.bedrooms > 6) continue;
    const seen = listing.lastSeenDate ? new Date(listing.lastSeenDate) : null;
    if (!seen || !Number.isFinite(seen.getTime())) continue;
    const sqft = listing.squareFootage > 0 ? Math.round(listing.squareFootage) : undefined;
    const externalId = `rentcast-rental-${listing.id}`;
    rows.set(externalId, {
      town, address: listing.formattedAddress, zip_code: listing.zipCode,
      bedrooms: listing.bedrooms, bathrooms: listing.bathrooms > 0 ? listing.bathrooms : undefined,
      sqft, property_type: PROPERTY_TYPES[listing.propertyType] || 'Other',
      monthly_rent: listing.price,
      rent_per_sqft: sqft ? Math.round(listing.price / sqft * 10000) / 10000 : undefined,
      data_source: 'rentcast', comp_date: seen.toISOString().slice(0, 10),
      external_id: externalId, created_by: userEmail,
      notes: 'Advertised asking rent from a RentCast rental listing; not a verified signed lease. Last seen ' + seen.toISOString().slice(0, 10) + '.',
    });
  }
  return [...rows.values()];
}

/** Refresh a town on use, at most once a day when listings are available. */
export async function refreshRentCastComps(town: Town, userEmail: string): Promise<number> {
  const db = getSupabaseAdmin();
  const { data: recent, error } = await db.from('rental_comps')
    .select('id').eq('town', town).eq('data_source', 'rentcast')
    .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1);
  if (error) throw new Error(`Could not check rental listing freshness: ${error.message}`);
  if (recent?.length) return 0;

  const listings = await getRentalListings({ city: town, state: 'OR', status: 'Active', limit: 500 }, true);
  const rows = rentalListingsToComps(listings, town, userEmail);
  if (!rows.length) return 0;
  // Atomic upsert preserves existing rows if a refresh fails and avoids duplicate listings.
  const { error: writeError } = await db.from('rental_comps').upsert(rows, { onConflict: 'external_id' });
  if (writeError) throw new Error(`Could not save rental listings: ${writeError.message}`);
  return rows.length;
}
