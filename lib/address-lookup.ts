/**
 * Address Lookup — Google Geocoding + RentCast
 *
 * Given a raw address string, validates it with Google Geocoding
 * and enriches it with property details from RentCast.
 *
 * Required env vars:
 *   GOOGLE_PLACES_API_KEY — Google Maps API key
 *   RENTCAST_API_KEY — RentCast API key (optional, degrades gracefully)
 */

import type { Town, PropertyType } from '@/types/comps';
import { detectCompTown } from '@/types/comps';
import { getPropertyRecords, type RentCastPropertyRecord } from './rentcast';

// ============================================
// Types
// ============================================

export interface AddressLookupResult {
  /** Validated, formatted address */
  formatted_address: string;
  /** Parsed components */
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  lat: number | null;
  lng: number | null;
  /** Detected HDPM town (null if outside service area) */
  town: Town | null;
  /** Property details from RentCast (null if not available) */
  property: PropertyDetails | null;
  /** Data source info */
  sources: string[];
}

export interface PropertyDetails {
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  property_type: PropertyType | null;
  year_built: number | null;
  lot_size: number | null;
  last_sale_price: number | null;
  last_sale_date: string | null;
  features: {
    garage: boolean;
    ac: boolean;
    heating: boolean;
  };
}

// ============================================
// Town Detection
// ============================================

// ============================================
// Google Geocoding
// ============================================

interface GeocodingResult {
  formatted_address: string;
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
  geometry: {
    location: { lat: number; lng: number };
    location_type: string;
  };
}

interface GeocodingResponse {
  results: GeocodingResult[];
  status: string;
  error_message?: string;
}

async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<GeocodingResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;

  const res = await fetch(url);
  const data: GeocodingResponse = await res.json();

  if (data.status !== 'OK' || data.results.length === 0) {
    console.error(`[Geocoding] Status: ${data.status}, error: ${data.error_message || 'No results'}`);
    return null;
  }

  return data.results[0];
}

function extractComponent(
  result: GeocodingResult,
  type: string
): string {
  const comp = result.address_components.find((c) => c.types.includes(type));
  return comp?.long_name || '';
}

function extractShortComponent(
  result: GeocodingResult,
  type: string
): string {
  const comp = result.address_components.find((c) => c.types.includes(type));
  return comp?.short_name || '';
}

// ============================================
// RentCast Property Type Mapping
// ============================================

function mapRentCastPropertyType(type: string | undefined): PropertyType | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes('single family') || t.includes('sfr')) return 'SFR';
  if (t.includes('apartment') || t.includes('apt')) return 'Apartment';
  if (t.includes('townhouse') || t.includes('townhome')) return 'Townhouse';
  if (t.includes('duplex')) return 'Duplex';
  if (t.includes('condo') || t.includes('condominium')) return 'Condo';
  if (t.includes('manufactured') || t.includes('mobile')) return 'Manufactured';
  if (t.includes('multi')) return 'Apartment';
  return 'Other';
}

// ============================================
// Public: Combined Lookup
// ============================================

export async function lookupAddress(
  rawAddress: string
): Promise<AddressLookupResult | null> {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  const sources: string[] = [];

  if (!googleKey) {
    console.warn('[AddressLookup] No GOOGLE_PLACES_API_KEY — cannot geocode');
    return null;
  }

  // Step 1: Geocode with Google
  console.log(`[AddressLookup] Geocoding: ${rawAddress}`);
  const geo = await geocodeAddress(rawAddress, googleKey);
  if (!geo) {
    return null;
  }

  sources.push('Google Geocoding');

  const street =
    `${extractComponent(geo, 'street_number')} ${extractComponent(geo, 'route')}`.trim();
  const city = extractComponent(geo, 'locality');
  const state = extractShortComponent(geo, 'administrative_area_level_1');
  const zip = extractComponent(geo, 'postal_code');
  const county = extractComponent(geo, 'administrative_area_level_2').replace(' County', '');
  const town = detectCompTown(city);

  const result: AddressLookupResult = {
    formatted_address: geo.formatted_address,
    street,
    city,
    state,
    zip,
    county: county || null,
    lat: geo.geometry.location.lat,
    lng: geo.geometry.location.lng,
    town,
    property: null,
    sources,
  };

  // Step 2: Enrich with RentCast (uses centralized lib/rentcast.ts)
  console.log(`[AddressLookup] Enriching with RentCast...`);
  const rcProp = await getPropertyRecords(geo.formatted_address);

  if (rcProp) {
    sources.push('RentCast');
    result.property = {
      bedrooms: rcProp.bedrooms ?? null,
      bathrooms: rcProp.bathrooms ?? null,
      sqft: rcProp.squareFootage ?? null,
      property_type: mapRentCastPropertyType(rcProp.propertyType),
      year_built: rcProp.yearBuilt ?? null,
      lot_size: rcProp.lotSize ?? null,
      last_sale_price: rcProp.lastSalePrice ?? null,
      last_sale_date: rcProp.lastSaleDate ?? null,
      features: {
        garage: rcProp.features?.garage || false,
        ac: rcProp.features?.cooling || false,
        heating: rcProp.features?.heating || false,
      },
    };
    console.log(
      `[AddressLookup] RentCast found: ${rcProp.bedrooms}BR/${rcProp.bathrooms}BA, ${rcProp.squareFootage}sqft, ${rcProp.propertyType}`
    );
  } else {
    console.log('[AddressLookup] RentCast: no property data found');
  }

  return result;
}
