export interface WeeklyRoute {
  id: string;
  route_date: string;
  status: string;
  route_stops: { id: string; status: string }[] | null;
}

/** Count appointments, independently of completion history on reused inspection records. */
export function inspectionWeek(routes: WeeklyRoute[], monday: string, nextMonday: string) {
  const week = routes.filter(route => route.route_date >= monday && route.route_date < nextMonday
    && !['canceled', 'cancelled'].includes(route.status));
  const stops = [...new Map(week.flatMap(route => route.route_stops || []).map(stop => [stop.id, stop])).values()];
  return {
    routes: new Set(week.map(route => route.id)).size,
    planned: stops.length,
    pending: stops.filter(stop => !['completed', 'skipped'].includes(stop.status)).length,
    skipped: stops.filter(stop => stop.status === 'skipped').length,
    completed: stops.filter(stop => stop.status === 'completed').length,
  };
}
