/**
 * Batch geocoding for inspection properties.
 * Reuses the Google Geocoding API via GOOGLE_PLACES_API_KEY.
 */

import { getSupabaseAdmin } from '@/lib/supabase';

interface GeocodeResult {
  id: string;
  address: string;
  success: boolean;
  lat?: number;
  lng?: number;
  formatted_address?: string;
  zip?: string;
  error?: string;
}

interface GoogleGeoResponse {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    address_components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
}

/** Geocode a single address string to lat/lng via Google. Exported for reuse. */
export async function geocodeOne(address: string, apiKey: string): Promise<{
  lat: number;
  lng: number;
  formatted_address: string;
  zip: string;
} | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const res = await fetch(url);
  const data: GoogleGeoResponse = await res.json();

  if (data.status !== 'OK' || data.results.length === 0) {
    return null;
  }

  const result = data.results[0];
  const zipComp = result.address_components.find((c) => c.types.includes('postal_code'));

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formatted_address: result.formatted_address,
    zip: zipComp?.short_name || '',
  };
}

/**
 * Batch geocode inspection properties that haven't been geocoded yet.
 * Processes in chunks of 10 with 200ms delay between requests.
 * Returns results as they complete for SSE streaming.
 */
export async function batchGeocodeProperties(
  propertyIds?: string[],
  onProgress?: (completed: number, total: number, result: GeocodeResult) => void
): Promise<{
  success: number;
  failed: number;
  skipped: number;
  errors: GeocodeResult[];
}> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set');
  }

  const supabase = getSupabaseAdmin();

  // Fetch properties needing geocoding
  let query = supabase
    .from('inspection_properties')
    .select('id, address_1, address_2, city, state, zip')
    .in('geocode_status', ['pending', 'failed']);

  if (propertyIds && propertyIds.length > 0) {
    query = query.in('id', propertyIds);
  }

  const { data: properties, error } = await query;

  if (error) throw new Error(`Failed to fetch properties: ${error.message}`);
  if (!properties || properties.length === 0) {
    return { success: 0, failed: 0, skipped: 0, errors: [] };
  }

  let success = 0;
  let failed = 0;
  const errors: GeocodeResult[] = [];

  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i];
    const fullAddress = [
      prop.address_1,
      prop.address_2,
      prop.city,
      prop.state || 'OR',
      prop.zip,
    ]
      .filter(Boolean)
      .join(', ');

    const result: GeocodeResult = {
      id: prop.id,
      address: fullAddress,
      success: false,
    };

    try {
      const geo = await geocodeOne(fullAddress, apiKey);

      if (geo) {
        result.success = true;
        result.lat = geo.lat;
        result.lng = geo.lng;
        result.formatted_address = geo.formatted_address;
        result.zip = geo.zip;

        // Update DB
        const updates: Record<string, unknown> = {
          latitude: geo.lat,
          longitude: geo.lng,
          geocode_status: 'success',
        };
        // Fill in zip if we didn't have one
        if (!prop.zip && geo.zip) {
          updates.zip = geo.zip;
        }

        await supabase
          .from('inspection_properties')
          .update(updates)
          .eq('id', prop.id);

        success++;
      } else {
        result.error = 'No results from Google Geocoding';
        await supabase
          .from('inspection_properties')
          .update({ geocode_status: 'failed' })
          .eq('id', prop.id);

        failed++;
        errors.push(result);
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : 'Geocoding failed';
      failed++;
      errors.push(result);
    }

    onProgress?.(i + 1, properties.length, result);

    // Rate limiting: 200ms between requests
    if (i < properties.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { success, failed, skipped: 0, errors };
}
