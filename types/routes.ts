// ============================================
// HDPM Route Optimization — Types
// ============================================

/** Central Oregon cities serviced by HDPM */
export type ServiceCity =
  | 'Bend'
  | 'Redmond'
  | 'Sisters'
  | 'Prineville'
  | 'La Pine'
  | 'Madras'
  | 'Sunriver'
  | 'Tumalo'
  | 'Terrebonne'
  | 'Powell Butte'
  | 'Crooked River Ranch'
  | 'Metolius';

/** Route plan lifecycle status */
export type RoutePlanStatus =
  | 'draft'
  | 'optimized'
  | 'dispatched'
  | 'in_progress'
  | 'completed';

/** Individual stop status within a route */
export type RouteStopStatus =
  | 'pending'
  | 'en_route'
  | 'arrived'
  | 'completed'
  | 'skipped';

/** Inspection priority levels */
export type InspectionPriority = 'urgent' | 'high' | 'normal' | 'low';

// ============================================
// HDPM Office — Default Start Location
// ============================================

/** HDPM office coordinates — 1515 SW Reindeer Ave, Redmond, OR 97756 */
export const HDPM_OFFICE_LAT = 44.256798;
export const HDPM_OFFICE_LNG = -121.184346;

// ============================================
// Database Row Types
// ============================================

/** A route plan record — mirrors route_plans table */
export interface RoutePlan {
  id: string;
  name: string;
  route_date: string;
  assigned_to: string | null;
  status: RoutePlanStatus;
  total_drive_minutes: number;
  total_service_minutes: number;
  stop_count: number;
  start_lat: number;   // default 44.2726
  start_lng: number;   // default -121.1739
  start_address: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Lightweight inspection data joined onto a route stop */
export interface RouteStopInspection {
  id: string;
  inspection_type: string;
  status: string;
  due_date: string | null;
  priority: InspectionPriority;
  notes: string | null;
}

/** Lightweight property data joined onto a route stop */
export interface RouteStopProperty {
  id: string;
  address_1: string;
  address_2: string | null;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

/** A single stop within a route — mirrors route_stops table */
export interface RouteStop {
  id: string;
  route_plan_id: string;
  inspection_id: string;
  property_id: string;
  stop_order: number;
  drive_minutes_from_prev: number;
  drive_meters_from_prev: number;
  service_minutes: number;  // default 30
  scheduled_arrival: string | null;
  status: RouteStopStatus;
  completed_at: string | null;
  notes: string | null;
  /** Joined inspection data (present when fetched with select) */
  inspection?: RouteStopInspection;
  /** Joined property data (present when fetched with select) */
  property?: RouteStopProperty;
}

// ============================================
// Route Generation Request / Result
// ============================================

/** Parameters for generating optimized routes */
export interface RouteGenerationRequest {
  start_time?: string;
  date_range_start: string;
  date_range_end: string;
  assigned_to?: string;
  max_stops_per_route?: number;  // default 10
  /** Optional: specific inspection IDs to include (manual pick mode) */
  inspection_ids?: string[];
}

/** An inspection excluded from routing, with reason */
export interface ExcludedInspection {
  inspection_id: string;
  address: string;
  reason: string;
}

/** Result of route generation — proposed routes before saving */
export interface RouteGenerationResult {
  routes: ProposedRoute[];
  excluded: ExcludedInspection[];
}

/** A proposed route before it is persisted to the database */
export interface ProposedRoute {
  name: string;
  route_date: string;
  assigned_to: string | null;
  total_drive_minutes: number;
  total_service_minutes: number;
  stop_count: number;
  stops: ProposedStop[];
}

/** A proposed stop before it is persisted to the database */
export interface ProposedStop {
  inspection_id: string;
  property_id: string;
  stop_order: number;
  drive_minutes_from_prev: number;
  drive_meters_from_prev: number;
  service_minutes: number;
  lat: number;
  lng: number;
  address: string;
  unit_name: string | null;
  city: string;
}

// ============================================
// Geo-Clustering
// ============================================

/** A geographic cluster of inspections grouped by city */
export interface GeoCluster {
  centroid_lat: number;
  centroid_lng: number;
  city: string;
  inspections: GeoInspection[];
}

/** Inspection with geographic and scheduling data needed for routing */
export interface GeoInspection {
  inspection_id: string;
  property_id: string;
  address: string;
  unit_name: string | null;
  city: string;
  lat: number;
  lng: number;
  due_date: string | null;
  priority: InspectionPriority;
  service_minutes: number;
  days_overdue: number;
}
