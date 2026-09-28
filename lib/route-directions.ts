/**
 * Google Directions API integration for route optimization.
 *
 * Uses Google's waypoint optimization to improve on the nearest-neighbor
 * heuristic, and provides real drive times and encoded polylines for
 * map display. Falls back gracefully to Haversine estimates when the
 * API is unavailable.
 */

import type { ProposedStop } from '@/types/routes';
import { HDPM_OFFICE_LAT, HDPM_OFFICE_LNG } from '@/types/routes';
import { haversineDistance, estimateDriveMinutes, solveNearestNeighborTSP } from '@/lib/route-engine';

// ============================================
// Google Directions API Types
// ============================================

interface GoogleDirectionsLeg {
  distance: { value: number; text: string };
  duration: { value: number; text: string };
  start_location: { lat: number; lng: number };
  end_location: { lat: number; lng: number };
}

interface GoogleDirectionsRoute {
  legs: GoogleDirectionsLeg[];
  overview_polyline: { points: string };
  waypoint_order: number[];
}

interface GoogleDirectionsResponse {
  status: string;
  error_message?: string;
  routes: GoogleDirectionsRoute[];
  geocoded_waypoints?: Array<{
    geocoder_status: string;
    place_id: string;
  }>;
}

// ============================================
// Result Types
// ============================================

export interface OptimizedRouteResult {
  stops: ProposedStop[];
  total_drive_minutes: number;
  total_drive_meters: number;
  polyline: string | null;
  source: 'google' | 'haversine';
}

// ============================================
// Google-Optimized Route
// ============================================

/**
 * Optimize a route using Google Directions API with `optimizeWaypoints: true`.
 *
 * Google reorders the intermediate waypoints for shortest overall distance.
 * Returns reordered stops with real drive_minutes and drive_meters between
 * each consecutive pair.
 *
 * Graceful degradation: if the API call fails for any reason, falls back
 * to Haversine-based estimates with proximity-optimized stop order.
 *
 * @param stops - proposed stops (must have lat/lng)
 * @param startLat - starting latitude (default: HDPM office)
 * @param startLng - starting longitude (default: HDPM office)
 */
export async function optimizeRouteWithGoogle(
  stops: ProposedStop[],
  startLat: number = HDPM_OFFICE_LAT,
  startLng: number = HDPM_OFFICE_LNG
): Promise<OptimizedRouteResult> {
  // Edge cases: nothing to optimize
  if (stops.length === 0) {
    return {
      stops: [],
      total_drive_minutes: 0,
      total_drive_meters: 0,
      polyline: null,
      source: 'haversine',
    };
  }

  stops = solveNearestNeighborTSP(stops, startLat, startLng);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn('GOOGLE_PLACES_API_KEY not set — using Haversine fallback');
    return buildHaversineFallback(stops, startLat, startLng);
  }

  try {
    const origin = `${startLat},${startLng}`;
    // Use the last stop as the destination; intermediate stops are waypoints
    // Google requires an explicit destination when using optimizeWaypoints
    const lastStop = stops[stops.length - 1];
    const destination = `${lastStop.lat},${lastStop.lng}`;

    // All stops except the last become "optimize:" waypoints
    const waypointStops = stops.slice(0, -1);
    const waypoints = waypointStops
      .map((s) => `${s.lat},${s.lng}`)
      .join('|');

    const params = new URLSearchParams({
      origin,
      destination,
      key: apiKey,
      units: 'metric',
    });

    if (waypointStops.length > 0) {
      params.set('waypoints', `optimize:true|${waypoints}`);
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data: GoogleDirectionsResponse = await res.json();

    if (data.status !== 'OK' || data.routes.length === 0) {
      console.warn(
        `Google Directions API returned status "${data.status}"${
          data.error_message ? `: ${data.error_message}` : ''
        } — using Haversine fallback`
      );
      return buildHaversineFallback(stops, startLat, startLng);
    }

    const route = data.routes[0];
    const waypointOrder = route.waypoint_order || [];
    if (route.legs.length !== stops.length || waypointOrder.length !== waypointStops.length
      || new Set(waypointOrder).size !== waypointStops.length
      || waypointOrder.some(i => !Number.isInteger(i) || i < 0 || i >= waypointStops.length)
      || route.legs.some(leg => !Number.isFinite(leg.duration?.value) || leg.duration.value < 0
        || !Number.isFinite(leg.distance?.value) || leg.distance.value < 0)) {
      return buildHaversineFallback(stops, startLat, startLng);
    }

    // Rebuild the stop order based on Google's optimization
    // waypoint_order maps to the intermediate waypoints (all except last)
    const reordered: ProposedStop[] = [];

    // Reorder intermediate waypoints per Google's suggestion
    for (const idx of waypointOrder) {
      reordered.push(waypointStops[idx]);
    }
    // The destination (last stop) stays at the end
    reordered.push(lastStop);

    // Apply real drive data from legs
    let totalDriveMinutes = 0;
    let totalDriveMeters = 0;

    for (let i = 0; i < reordered.length; i++) {
      const leg = route.legs[i];
      if (leg) {
        const driveMin = Math.ceil(leg.duration.value / 60);
        const driveMeters = leg.distance.value;

        reordered[i] = {
          ...reordered[i],
          stop_order: i + 1,
          drive_minutes_from_prev: driveMin,
          drive_meters_from_prev: driveMeters,
        };

        totalDriveMinutes += driveMin;
        totalDriveMeters += driveMeters;
      } else {
        // Shouldn't happen, but handle gracefully
        reordered[i] = { ...reordered[i], stop_order: i + 1 };
      }
    }

    return {
      stops: reordered,
      total_drive_minutes: Math.round(totalDriveMinutes * 10) / 10,
      total_drive_meters: totalDriveMeters,
      polyline: route.overview_polyline?.points || null,
      source: 'google',
    };
  } catch (err) {
    console.warn(
      'Google Directions API call failed — using Haversine fallback:',
      err instanceof Error ? err.message : err
    );
    return buildHaversineFallback(stops, startLat, startLng);
  }
}

// ============================================
// Route Polyline
// ============================================

/**
 * Get the encoded polyline for a route for map display.
 * Calls Google Directions without optimization (preserves stop order).
 * Falls back to null if the API is unavailable.
 *
 * @param stops - ordered route stops (must have lat/lng)
 * @param startLat - starting latitude
 * @param startLng - starting longitude
 */
export async function getRoutePolyline(
  stops: ProposedStop[],
  startLat: number = HDPM_OFFICE_LAT,
  startLng: number = HDPM_OFFICE_LNG
): Promise<string | null> {
  if (stops.length === 0) return null;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn('GOOGLE_PLACES_API_KEY not set — cannot generate polyline');
    return null;
  }

  try {
    const origin = `${startLat},${startLng}`;
    const lastStop = stops[stops.length - 1];
    const destination = `${lastStop.lat},${lastStop.lng}`;

    const params = new URLSearchParams({
      origin,
      destination,
      key: apiKey,
      units: 'metric',
    });

    // Intermediate stops as waypoints (no optimization — order is final)
    if (stops.length > 1) {
      const waypoints = stops
        .slice(0, -1)
        .map((s) => `${s.lat},${s.lng}`)
        .join('|');
      params.set('waypoints', waypoints);
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data: GoogleDirectionsResponse = await res.json();

    if (data.status !== 'OK' || data.routes.length === 0) {
      console.warn(
        `Google Directions API returned status "${data.status}" for polyline request`
      );
      return null;
    }

    return data.routes[0].overview_polyline?.points || null;
  } catch (err) {
    console.warn(
      'Failed to fetch route polyline:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ============================================
// Haversine Fallback
// ============================================

/**
 * Build a fallback route result using Haversine distance estimates.
 * Uses the proximity-optimized stop order and computes approximate drive
 * times using the 50 km/h average with a 1.3x winding factor.
 */
function buildHaversineFallback(
  stops: ProposedStop[],
  startLat: number,
  startLng: number
): OptimizedRouteResult {
  if (stops.length === 0) {
    return {
      stops: [],
      total_drive_minutes: 0,
      total_drive_meters: 0,
      polyline: null,
      source: 'haversine',
    };
  }

  const result: ProposedStop[] = [];
  let prevLat = startLat;
  let prevLng = startLng;
  let totalDriveMinutes = 0;
  let totalDriveMeters = 0;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const distMeters = haversineDistance(prevLat, prevLng, stop.lat, stop.lng);
    const driveMin = Math.ceil(estimateDriveMinutes(distMeters));

    result.push({
      ...stop,
      stop_order: i + 1,
      drive_minutes_from_prev: driveMin,
      drive_meters_from_prev: Math.round(distMeters),
    });

    totalDriveMinutes += driveMin;
    totalDriveMeters += Math.round(distMeters);
    prevLat = stop.lat;
    prevLng = stop.lng;
  }

  return {
    stops: result,
    total_drive_minutes: Math.round(totalDriveMinutes * 10) / 10,
    total_drive_meters: totalDriveMeters,
    polyline: null,
    source: 'haversine',
  };
}
