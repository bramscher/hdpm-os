/** Shared timing for the route page, persisted arrivals, and Outlook itinerary. */
export const INSPECTION_ACCESS_BUFFER_MINUTES = 5;
export interface TimingStop {
  status?: string;
  travel_minutes_from_previous?: number | null;
  drive_minutes_from_prev?: number | null;
  service_minutes?: number | null;
}
export function inspectionSchedule(stops: TimingStop[]) {
  let elapsed = 0;
  let drive = 0;
  let service = 0;
  let activeCount = 0;
  const visits = stops.map(stop => {
    if (stop.status === 'skipped') return {arrivalMinutes: elapsed, departureMinutes: elapsed, driveMinutes:0, serviceMinutes:0, bufferMinutes:0};
    const driveMinutes = Math.max(0, Math.ceil(stop.travel_minutes_from_previous ?? stop.drive_minutes_from_prev ?? 0));
    const serviceMinutes = Math.max(0, stop.service_minutes ?? 15);
    const bufferMinutes = activeCount++ === 0 ? 0 : INSPECTION_ACCESS_BUFFER_MINUTES;
    elapsed += driveMinutes + bufferMinutes;
    const arrivalMinutes = elapsed;
    elapsed += serviceMinutes;
    drive += driveMinutes;
    service += serviceMinutes;
    return { arrivalMinutes, departureMinutes: elapsed, driveMinutes, serviceMinutes, bufferMinutes };
  });
  return { visits, totalMinutes: elapsed, driveMinutes: drive, serviceMinutes: service,
    bufferMinutes: Math.max(0,activeCount-1)*INSPECTION_ACCESS_BUFFER_MINUTES };
}
