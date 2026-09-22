import type { Job, Visit } from './model';

export interface DayRouteStop {
  visit: Visit;
  job?: Job;
  address: string;
  gapMinutes: number | null;
}

/** Include every planned visit for the crew member, even when the calendar has a property filter. */
export function scheduledDayRoute(jobs: Job[], visits: Visit[], person: string, date: string): DayRouteStop[] {
  const jobById = new Map(jobs.map(job => [job.id, job]));
  const planned = visits.filter(v => v.work_date === date && v.status === 'planned' && v.technicians.includes(person))
    .sort((a, b) => a.start_minute - b.start_minute || a.id.localeCompare(b.id));
  return planned.map((visit, index) => {
    const job = jobById.get(visit.job_id);
    const previous = planned[index - 1];
    return { visit, job, address: job?.property_address?.trim() || '',
      gapMinutes: previous ? visit.start_minute - previous.start_minute - previous.planned_minutes : null };
  });
}

export function drivingLink(addresses: string[], origin?: string): string | null {
  if (!addresses.length || addresses.some(a => !a.trim())) return null;
  const params = new URLSearchParams({ api: '1', travelmode: 'driving', destination: addresses[addresses.length - 1] });
  if (origin) params.set('origin', origin);
  if (addresses.length > 1) params.set('waypoints', addresses.slice(0, -1).join('|'));
  const url = `https://www.google.com/maps/dir/?${params}`;
  return url.length <= 2048 ? url : null;
}

/** Three intermediate waypoints work on mobile browsers; keep continuity between parts.
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 */
export function dayRouteLinks(stops: DayRouteStop[]): { href: string; first: number; last: number }[] {
  if (!stops.length || stops.some(s => !s.address)) return [];
  const links: { href: string; first: number; last: number }[] = [];
  for (let start = 0; start < stops.length;) {
    let end = Math.min(start + 4, stops.length);
    const origin = start ? stops[start - 1].address : undefined;
    let href = drivingLink(stops.slice(start, end).map(s => s.address), origin);
    while (!href && end > start + 1) {
      end--;
      href = drivingLink(stops.slice(start, end).map(s => s.address), origin);
    }
    if (!href) return [];
    links.push({ href, first: start + 1, last: end });
    start = end;
  }
  return links;
}
