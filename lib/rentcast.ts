/**
 * RentCast API Client
 *
 * Centralized module for all RentCast API interactions:
 * - Property records (structural data)
 * - Value estimates (AVM)
 * - Rent estimates (long-term)
 * - Market statistics
 * - Sale & rental listings
 *
 * API docs: https://developers.rentcast.io/reference/introduction
 *
 * Required env vars:
 *   RENTCAST_API_KEY
 */

import type {
  RentCastValueEstimate,
  RentCastRentEstimate,
  RentCastComparable,
  RentCastMarketStats,
} from '@/types/comps';

// ============================================
// Config
// ============================================

const BASE_URL = 'https://api.rentcast.io/v1';

function getApiKey(): string | null {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) {
    console.warn('[RentCast] Missing RENTCAST_API_KEY — API calls will be skipped');
    return null;
  }
  return key;
}

// ============================================
// Shared Fetch Helper
// ============================================

async function fetchRentCast<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>
): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  // Build query string, filtering out undefined values
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }

  const url = `${BASE_URL}${path}?${searchParams}`;
  console.log(`[RentCast] GET ${path} — ${searchParams}`);

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[RentCast] API error (${res.status}): ${text.substring(0, 300)}`);
      return null;
    }

    const data = await res.json();
    return data as T;
  } catch (err) {
    console.error(`[RentCast] Fetch error on ${path}:`, err);
    return null;
  }
}

// ============================================
// Property Records
// ============================================

/** Raw property record from RentCast /properties endpoint */
export interface RentCastPropertyRecord {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  county?: string;
  latitude?: number;
  longitude?: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  features?: {
    cooling?: boolean;
    coolingType?: string;
    heating?: boolean;
    garage?: boolean;
    garageSpaces?: number;
  };
}

/**
 * Look up property records by address.
 * Returns the first matching property or null.
 */
export async function getPropertyRecords(
  address: string
): Promise<RentCastPropertyRecord | null> {
  const data = await fetchRentCast<RentCastPropertyRecord[] | RentCastPropertyRecord>(
    '/properties',
    { address }
  );

  if (!data) return null;

  // API returns an array or single object
  if (Array.isArray(data)) {
    return data.length > 0 ? data[0] : null;
  }
  if (data && typeof data === 'object' && data.formattedAddress) {
    return data;
  }
  return null;
}

// ============================================
// Value Estimate (AVM)
// ============================================

interface RentCastAVMResponse {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  subjectProperty?: Record<string, unknown>;
  comparables?: Array<{
    formattedAddress?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    propertyType?: string;
    price?: number;
    correlation?: number;
    daysOld?: number;
  }>;
}

export interface ValueEstimateOptions {
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  propertyType?: string;
  compCount?: number;
}

/**
 * Get an automated home value estimate for a property.
 * Returns estimated price with range and sale comparables.
 */
export async function getValueEstimate(
  address: string,
  opts?: ValueEstimateOptions
): Promise<RentCastValueEstimate | null> {
  const data = await fetchRentCast<RentCastAVMResponse>('/avm/value', {
    address,
    bedrooms: opts?.bedrooms,
    bathrooms: opts?.bathrooms,
    squareFootage: opts?.squareFootage,
    propertyType: opts?.propertyType,
    compCount: opts?.compCount ?? 15,
  });

  if (!data || !data.price) return null;

  const comparables: RentCastComparable[] = (data.comparables || []).map((c) => ({
    formattedAddress: c.formattedAddress || '',
    city: c.city || '',
    state: c.state || '',
    zipCode: c.zipCode || '',
    bedrooms: c.bedrooms || 0,
    bathrooms: c.bathrooms || 0,
    squareFootage: c.squareFootage || 0,
    propertyType: c.propertyType || '',
    price: c.price,
    correlation: c.correlation || 0,
    daysOld: c.daysOld || 0,
  }));

  console.log(
    `[RentCast] Value estimate: $${data.price} (${data.priceRangeLow}-${data.priceRangeHigh}), ${comparables.length} comps`
  );

  return {
    price: data.price,
    priceRangeLow: data.priceRangeLow || data.price * 0.9,
    priceRangeHigh: data.priceRangeHigh || data.price * 1.1,
    comparables,
  };
}

// ============================================
// Rent Estimate (Long-Term)
// ============================================

interface RentCastRentResponse {
  rent?: number;
  rentRangeLow?: number;
  rentRangeHigh?: number;
  subjectProperty?: Record<string, unknown>;
  comparables?: Array<{
    formattedAddress?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    propertyType?: string;
    price?: number; // RentCast uses "price" for rent in comparables
    correlation?: number;
    daysOld?: number;
  }>;
}

export interface RentEstimateOptions {
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  propertyType?: string;
  compCount?: number;
}

/**
 * Get a long-term rent estimate for a property.
 * Returns estimated rent with range and rental comparables.
 */
export async function getRentEstimate(
  address: string,
  opts?: RentEstimateOptions
): Promise<RentCastRentEstimate | null> {
  const data = await fetchRentCast<RentCastRentResponse>('/avm/rent/long-term', {
    address,
    bedrooms: opts?.bedrooms,
    bathrooms: opts?.bathrooms,
    squareFootage: opts?.squareFootage,
    propertyType: opts?.propertyType,
    compCount: opts?.compCount ?? 15,
  });

  if (!data || !data.rent) return null;

  const comparables: RentCastComparable[] = (data.comparables || []).map((c) => ({
    formattedAddress: c.formattedAddress || '',
    city: c.city || '',
    state: c.state || '',
    zipCode: c.zipCode || '',
    bedrooms: c.bedrooms || 0,
    bathrooms: c.bathrooms || 0,
    squareFootage: c.squareFootage || 0,
    propertyType: c.propertyType || '',
    rent: c.price, // RentCast returns rent as "price" in comparables
    correlation: c.correlation || 0,
    daysOld: c.daysOld || 0,
  }));

  console.log(
    `[RentCast] Rent estimate: $${data.rent}/mo (${data.rentRangeLow}-${data.rentRangeHigh}), ${comparables.length} comps`
  );

  return {
    rent: data.rent,
    rentRangeLow: data.rentRangeLow || data.rent * 0.9,
    rentRangeHigh: data.rentRangeHigh || data.rent * 1.1,
    comparables,
  };
}

// ============================================
// Market Statistics
// ============================================

interface RentCastMarketResponse {
  zipCode?: string;
  medianRent?: number;
  medianPrice?: number;
  averageRent?: number;
  averagePrice?: number;
  rentalListingCount?: number;
  saleListingCount?: number;
}

/**
 * Get market statistics for a zip code.
 * Returns median/average rents and prices, listing counts.
 */
export async function getMarketStats(
  zipCode: string
): Promise<RentCastMarketStats | null> {
  const data = await fetchRentCast<RentCastMarketResponse>('/markets', {
    zipCode,
  });

  if (!data) return null;

  console.log(
    `[RentCast] Market stats for ${zipCode}: median rent $${data.medianRent}, median price $${data.medianPrice}`
  );

  return {
    zipCode: data.zipCode || zipCode,
    medianRent: data.medianRent || 0,
    medianPrice: data.medianPrice || 0,
    averageRent: data.averageRent || 0,
    averagePrice: data.averagePrice || 0,
    rentalListingCount: data.rentalListingCount || 0,
    saleListingCount: data.saleListingCount || 0,
  };
}

// ============================================
// Sale Listings
// ============================================

export interface RentCastListing {
  id?: string;
  lastSeenDate?: string;
  formattedAddress: string;
  city: string;
  state: string;
  zipCode: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  propertyType: string;
  price: number;
  status: string;
  daysOnMarket: number;
  listingUrl?: string;
}

export interface ListingSearchParams {
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  bedrooms?: string;
  propertyType?: string;
  status?: 'Active' | 'Inactive';
  limit?: number;
}

interface RentCastListingResponse {
  id?: string;
  lastSeenDate?: string;
  formattedAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  propertyType?: string;
  price?: number;
  status?: string;
  daysOnMarket?: number;
  listingUrl?: string;
}

function mapListingResponse(raw: RentCastListingResponse): RentCastListing {
  return {
    id: raw.id,
    lastSeenDate: raw.lastSeenDate,
    formattedAddress: raw.formattedAddress || '',
    city: raw.city || '',
    state: raw.state || '',
    zipCode: raw.zipCode || '',
    bedrooms: raw.bedrooms || 0,
    bathrooms: raw.bathrooms || 0,
    squareFootage: raw.squareFootage || 0,
    propertyType: raw.propertyType || '',
    price: raw.price || 0,
    status: raw.status || 'Active',
    daysOnMarket: raw.daysOnMarket || 0,
    listingUrl: raw.listingUrl,
  };
}

/**
 * Search active sale listings.
 */
export async function getSaleListings(
  params: ListingSearchParams
): Promise<RentCastListing[]> {
  const data = await fetchRentCast<RentCastListingResponse[]>('/listings/sale', {
    address: params.address,
    city: params.city,
    state: params.state,
    zipCode: params.zipCode,
    latitude: params.latitude,
    longitude: params.longitude,
    radius: params.radius,
    bedrooms: params.bedrooms,
    propertyType: params.propertyType,
    status: params.status ?? 'Active',
    limit: params.limit ?? 50,
  });

  if (!data || !Array.isArray(data)) return [];

  console.log(`[RentCast] Found ${data.length} sale listings`);
  return data.map(mapListingResponse);
}

/**
 * Search active rental listings (long-term).
 */
export async function getRentalListings(
  params: ListingSearchParams,
  requireSuccess = false
): Promise<RentCastListing[]> {
  const data = await fetchRentCast<RentCastListingResponse[]>('/listings/rental/long-term', {
    address: params.address,
    city: params.city,
    state: params.state,
    zipCode: params.zipCode,
    latitude: params.latitude,
    longitude: params.longitude,
    radius: params.radius,
    bedrooms: params.bedrooms,
    propertyType: params.propertyType,
    status: params.status ?? 'Active',
    limit: params.limit ?? 50,
  });

  if (!data || !Array.isArray(data)) {
    if (requireSuccess) throw new Error('Rental listings are unavailable from RentCast.');
    return [];
  }

  console.log(`[RentCast] Found ${data.length} rental listings`);
  // An unknown bedroom count must not become a studio in the comps database.
  return data.filter((row) => !requireSuccess || row.bedrooms != null).map(mapListingResponse);
}
