// Today's published routes for the home dashboard: who, where and when, without the door notes.
// Everyone on staff (front desk included) sees this, so it is built from an allow-list of fields:
// no lockbox codes, entry instructions, tenant remarks or office notes.

export interface HomeRouteStop {
  work_order_id: string;
  stop_order: number;
  address: string;
  lat: number | null;
  lng: number | null;
  arrival: string | null;
  work_orders: { wo_number: string | null; property_name: string; unit_name: string | null } | null;
}
export interface HomeRoute {
  id: string;
  route_date: string;
  assigned_tech: string | null;
  start_time: string;
  total_drive_minutes: number;
  total_service_minutes: number;
  stop_count: number;
  stops: HomeRouteStop[];
}

type LoadedStop = {
  work_order_id: string; stop_order: number; address: string; lat: number | null; lng: number | null; arrival?: string | null;
  work_orders?: { wo_number?: string | null; property_name?: string | null; unit_name?: string | null } | null;
};
type LoadedRoute = {
  id: string; route_date: string; assigned_tech: string | null; start_time?: string | null;
  total_drive_minutes?: number | null; total_service_minutes?: number | null; stop_count?: number | null; stops: LoadedStop[];
};

export function homeRouteSummary(route: LoadedRoute): HomeRoute {
  return {
    id: route.id,
    route_date: route.route_date,
    assigned_tech: route.assigned_tech,
    start_time: (route.start_time || '08:00').slice(0, 5),
    total_drive_minutes: route.total_drive_minutes ?? 0,
    total_service_minutes: route.total_service_minutes ?? 0,
    stop_count: route.stop_count ?? route.stops.length,
    stops: route.stops.map(s => ({
      work_order_id: s.work_order_id,
      stop_order: s.stop_order,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      arrival: s.arrival ?? null,
      work_orders: s.work_orders
        ? { wo_number: s.work_orders.wo_number ?? null, property_name: s.work_orders.property_name || 'Property', unit_name: s.work_orders.unit_name ?? null }
        : null,
    })),
  };
}
