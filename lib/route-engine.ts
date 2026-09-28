/**
 * Route optimization engine — pure logic, no database calls.
 *
 * Handles clustering, prioritization, nearest-neighbor TSP, and
 * route plan assembly for property inspections across Central Oregon.
 */

import type {
  GeoCluster,
  GeoInspection,
  InspectionPriority,
  ProposedRoute,
  ProposedStop,
  RouteGenerationResult,
  ExcludedInspection,
} from '@/types/routes';
import { HDPM_OFFICE_LAT, HDPM_OFFICE_LNG } from '@/types/routes';

// ============================================
// Constants
// ============================================

/** Earth radius in meters */
const EARTH_RADIUS_M = 6_371_000;

/** Average speed assumption for Central Oregon rural/suburban roads (km/h) */
const AVERAGE_SPEED_KMH = 50;

/** Priority weight used for sorting (lower = more urgent) */
const PRIORITY_WEIGHT: Record<InspectionPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Default service time per stop in minutes */
const DEFAULT_SERVICE_MINUTES = 15;

/** Default max stops per route */
const DEFAULT_MAX_STOPS = 10;

// ============================================
// Haversine Distance
// ============================================

/**
 * Calculate the great-circle distance between two lat/lng points.
 * @returns distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

// ============================================
// Drive Time Estimation
// ============================================

/**
 * Estimate drive time from straight-line distance.
 * Applies a 1.3x road-winding factor to the Haversine distance,
 * then divides by the assumed average speed for Central Oregon.
 * @returns estimated drive time in minutes
 */
export function estimateDriveMinutes(distanceMeters: number): number {
  const WINDING_FACTOR = 1.3;
  const effectiveMeters = distanceMeters * WINDING_FACTOR;
  const effectiveKm = effectiveMeters / 1000;
  const hours = effectiveKm / AVERAGE_SPEED_KMH;
  return Math.round(hours * 60 * 10) / 10; // one decimal place
}

// ============================================
// Cluster by City
// ============================================

/**
 * Group inspections by their city field.
 * Central Oregon cities are naturally well-separated (Bend, Redmond,
 * Sisters, Prineville, La Pine, Madras are 20-40 min apart), so
 * city-based clustering is a strong geographic heuristic.
 *
 * Inspections missing lat/lng are excluded and should be reported
 * separately by the caller.
 *
 * @returns array of GeoCluster, one per city with at least one inspection
 */
export function clusterInspectionsByCity(
  inspections: GeoInspection[]
): GeoCluster[] {
  const cityMap = new Map<string, GeoInspection[]>();

  for (const insp of inspections) {
    const key = (insp.city || 'Unknown').trim();
    if (!cityMap.has(key)) {
      cityMap.set(key, []);
    }
    cityMap.get(key)!.push(insp);
  }

  const clusters: GeoCluster[] = [];

  for (const [city, members] of cityMap) {
    if (members.length === 0) continue;

    // Compute centroid from member coordinates
    const sumLat = members.reduce((s, m) => s + m.lat, 0);
    const sumLng = members.reduce((s, m) => s + m.lng, 0);

    clusters.push({
      centroid_lat: sumLat / members.length,
      centroid_lng: sumLng / members.length,
      city,
      inspections: members,
    });
  }

  return clusters;
}

// ============================================
// Prioritize Inspections
// ============================================

/**
 * Sort inspections by urgency:
 *   1. Overdue first (most days overdue at the top)
 *   2. Then by due_date ascending (soonest due next)
 *   3. Then by priority level (urgent > high > normal > low)
 *
 * Returns a new sorted array; does not mutate the input.
 */
export function prioritizeInspections(
  inspections: GeoInspection[]
): GeoInspection[] {
  return [...inspections].sort((a, b) => {
    // Overdue inspections first (higher days_overdue = more urgent)
    if (a.days_overdue > 0 || b.days_overdue > 0) {
      if (a.days_overdue !== b.days_overdue) {
        return b.days_overdue - a.days_overdue;
      }
    }

    // Then by due_date ascending (soonest due next)
    const dateA = a.due_date || '9999-12-31';
    const dateB = b.due_date || '9999-12-31';
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }

    // Then by priority weight (urgent=0 < low=3)
    return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  });
}

// ============================================
// Nearest-Neighbor TSP Solver
// ============================================

interface TSPNode {
  index: number;
  lat: number;
  lng: number;
}

/**
 * Solve the Travelling Salesperson Problem using the nearest-neighbor
 * heuristic. Starts at the given office coordinates and greedily visits
 * the closest unvisited stop at each step.
 *
 * @param stops - inspections to order (must have lat/lng)
 * @param startLat - starting latitude (default: HDPM office)
 * @param startLng - starting longitude (default: HDPM office)
 * @returns reordered array of inspections
 */
export function solveNearestNeighborTSP<T extends { lat: number; lng: number }>(
  stops: T[],
  startLat: number = HDPM_OFFICE_LAT,
  startLng: number = HDPM_OFFICE_LNG
): T[] {
  if (stops.length <= 1) return [...stops];

  const unvisited: TSPNode[] = stops.map((s, i) => ({
    index: i,
    lat: s.lat,
    lng: s.lng,
  }));

  const ordered: T[] = [];
  let currentLat = startLat;
  let currentLng = startLng;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = haversineDistance(
        currentLat,
        currentLng,
        unvisited[i].lat,
        unvisited[i].lng
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const chosen = unvisited.splice(nearestIdx, 1)[0];
    ordered.push(stops[chosen.index]);
    currentLat = chosen.lat;
    currentLng = chosen.lng;
  }

  // Remove crossing/backtracking segments while keeping departure fixed.
  // Open route: no assumed return trip to the office.
  const distance = (a: {lat:number;lng:number}, b: {lat:number;lng:number}) => haversineDistance(a.lat,a.lng,b.lat,b.lng);
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < ordered.length - 1; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const before = i === 0 ? {lat:startLat,lng:startLng} : ordered[i-1];
        const after = ordered[j+1];
        const oldLength = distance(before,ordered[i]) + (after ? distance(ordered[j],after) : 0);
        const newLength = distance(before,ordered[j]) + (after ? distance(ordered[i],after) : 0);
        if (newLength + 0.01 < oldLength) {
          ordered.splice(i,j-i+1,...ordered.slice(i,j+1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return ordered;
}

// ============================================
// Build Route Plans (Orchestrator)
// ============================================

export interface BuildRouteOptions {
  date_range_start: string;
  date_range_end: string;
  assigned_to?: string;
  max_stops_per_route?: number;
  start_lat?: number;
  start_lng?: number;
}

/**
 * Build proposed route plans from a set of inspections.
 *
 * Pipeline:
 *   1. Filter out inspections missing lat/lng (report as excluded)
 *   2. Cluster remaining inspections by city
 *   3. Prioritize within each cluster
 *   4. Split large clusters into sub-routes of max_stops
 *   5. Run nearest-neighbor TSP on each route
 *   6. Assign dates (largest clusters get earlier dates, spread across range)
 *   7. Compute drive/service time totals
 */
export function buildRoutePlans(
  inspections: GeoInspection[],
  options: BuildRouteOptions
): RouteGenerationResult {
  const maxStops = Math.max(1, Math.floor(options.max_stops_per_route || DEFAULT_MAX_STOPS));
  const startLat = options.start_lat ?? HDPM_OFFICE_LAT;
  const startLng = options.start_lng ?? HDPM_OFFICE_LNG;

  // Step 1: Separate valid vs excluded inspections
  const valid: GeoInspection[] = [];
  const excluded: ExcludedInspection[] = [];

  for (const insp of inspections) {
    if (insp.lat == null || insp.lng == null || isNaN(insp.lat) || isNaN(insp.lng)) {
      excluded.push({
        inspection_id: insp.inspection_id,
        address: insp.address,
        reason: 'Missing or invalid coordinates — geocode the property first',
      });
    } else {
      valid.push(insp);
    }
  }

  if (valid.length === 0) {
    return { routes: [], excluded };
  }

  // Step 2: Cluster by city
  const clusters = clusterInspectionsByCity(valid);

  // Step 3: Prioritize within each cluster
  for (const cluster of clusters) {
    cluster.inspections = prioritizeInspections(cluster.inspections);
  }

  // Step 4: Split large clusters into sub-routes
  interface SubRoute {
    city: string;
    inspections: GeoInspection[];
    size: number;
  }

  const subRoutes: SubRoute[] = [];

  for (const cluster of clusters) {
    const remaining = [...cluster.inspections];
    while (remaining.length > 0) {
      // Start with the most urgent remaining inspection, then fill this route
      // with its nearest neighbors instead of splitting by import/due-date order.
      const seed = remaining.shift()!;
      const nearby = [...remaining].sort((a,b) =>
        haversineDistance(seed.lat,seed.lng,a.lat,a.lng) - haversineDistance(seed.lat,seed.lng,b.lat,b.lng));
      const chunk = [seed, ...nearby.slice(0,maxStops-1)];
      const chosen = new Set(chunk);
      for (let i = remaining.length-1; i >= 0; i--) if (chosen.has(remaining[i])) remaining.splice(i,1);
      subRoutes.push({
        city: cluster.city,
        inspections: chunk,
        size: chunk.length,
      });
    }
  }

  // Step 5: Sort sub-routes so largest clusters get earlier dates
  subRoutes.sort((a, b) => b.size - a.size);

  // Step 6: Generate date assignments spread across the range
  const dates = generateDateRange(options.date_range_start, options.date_range_end);
  if (dates.length === 0) {
    // Fallback: use the start date for everything
    dates.push(options.date_range_start);
  }

  // Step 7: Build proposed routes
  const routes: ProposedRoute[] = [];

  for (let r = 0; r < subRoutes.length; r++) {
    const sub = subRoutes[r];
    const routeDate = dates[r % dates.length];

    // TSP within the sub-route
    const ordered = solveNearestNeighborTSP(sub.inspections, startLat, startLng);

    // Build stops with drive estimates
    const stops: ProposedStop[] = [];
    let prevLat = startLat;
    let prevLng = startLng;
    let totalDriveMinutes = 0;
    let totalServiceMinutes = 0;

    for (let i = 0; i < ordered.length; i++) {
      const insp = ordered[i];
      const distMeters = haversineDistance(prevLat, prevLng, insp.lat, insp.lng);
      const driveMin = estimateDriveMinutes(distMeters);
      const serviceMin = insp.service_minutes || DEFAULT_SERVICE_MINUTES;

      stops.push({
        inspection_id: insp.inspection_id,
        property_id: insp.property_id,
        stop_order: i + 1,
        drive_minutes_from_prev: driveMin,
        drive_meters_from_prev: Math.round(distMeters),
        service_minutes: serviceMin,
        lat: insp.lat,
        lng: insp.lng,
        address: insp.address,
        unit_name: insp.unit_name,
        city: insp.city,
      });

      totalDriveMinutes += driveMin;
      totalServiceMinutes += serviceMin;
      prevLat = insp.lat;
      prevLng = insp.lng;
    }

    // Count routes per city per date for naming
    const sameCityCount = routes.filter(
      (rt) => rt.name.startsWith(sub.city) && rt.route_date === routeDate
    ).length;
    const suffix = sameCityCount > 0 ? ` (${sameCityCount + 1})` : '';
    const name = `${sub.city} - ${formatDateShort(routeDate)}${suffix}`;

    routes.push({
      name,
      route_date: routeDate,
      assigned_to: options.assigned_to ?? null,
      total_drive_minutes: Math.round(totalDriveMinutes * 10) / 10,
      total_service_minutes: totalServiceMinutes,
      stop_count: stops.length,
      stops,
    });
  }

  return { routes, excluded };
}

// ============================================
// Helpers
// ============================================

/**
 * Generate an array of date strings (YYYY-MM-DD) between start and end,
 * inclusive, excluding weekends.
 */
function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startDate = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return [];
  }

  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (day !== 0 && day !== 6) {
      dates.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Format a date string as "Mon 3/20" style for route names.
 */
function formatDateShort(dateStr: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}
