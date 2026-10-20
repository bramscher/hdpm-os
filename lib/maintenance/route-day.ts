// A published maintenance day route as the tech receives it: stop times from the start time,
// map links, and the email, text and invite copy. Pure; the routes API does the sending.
import { wallTime } from '@/lib/timekeeping/model';
import { dayRouteLinks, type DayRouteStop } from '@/lib/maintenance-workspace/day-route';

/** What a tech needs at the door, snapshotted from the work order (and AppFolio) when the route is published. */
export interface StopDetails {
  task?: string;
  description?: string;
  priority?: string | null;
  permission_to_enter?: string | null;
  entry_instructions?: string | null;
  tenant_remarks?: string | null;
  preferred_times?: string | null;
}
export interface RouteStopInput {
  stop_order: number;
  work_order_id: string;
  wo_number: string | null;
  property_name: string;
  unit_name: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  drive_minutes_from_prev: number;
  service_minutes: number;
  details?: StopDetails;
}
export interface ScheduledStop extends RouteStopInput { arrival: string; departure: string }
export interface DayRoute {
  routeDate: string;
  tech: string;
  startTime: string; // HH:MM, Pacific
  stops: ScheduledStop[];
  finish: string;
  notes?: string;
  updated?: boolean;
}

const ZONE = 'America/Los_Angeles';
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN = 60000;

/** Arrival and departure at each stop: the Pacific start time, plus the drive before each stop and the time on site. */
export function scheduleStops(routeDate: string, startTime: string, stops: RouteStopInput[]): { stops: ScheduledStop[]; finish: string } {
  const start = HHMM.test(startTime) ? startTime : '08:00';
  let t = Date.parse(wallTime(routeDate, start));
  const out = [...stops].sort((a, b) => a.stop_order - b.stop_order).map(s => {
    t += Math.max(0, Math.round(s.drive_minutes_from_prev)) * MIN;
    const arrival = new Date(t).toISOString();
    t += Math.max(0, Math.round(s.service_minutes)) * MIN;
    return { ...s, arrival, departure: new Date(t).toISOString() };
  });
  return { stops: out, finish: new Date(t).toISOString() };
}

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });
export const startClock = (routeDate: string, startTime: string) => clockTime(wallTime(routeDate, HHMM.test(startTime) ? startTime : '08:00'));
export const routeDayLabel = (routeDate: string, style: 'long' | 'short' = 'long') =>
  new Date(`${routeDate}T12:00:00Z`).toLocaleDateString('en-US', style === 'long' ? { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' } : { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const duration = (minutes: number) => {
  const m = Math.round(minutes), h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h} h ${r} m` : h ? `${h} h` : `${r} m`;
};
export const placeLine = (s: Pick<RouteStopInput, 'property_name' | 'unit_name'>) => [s.property_name, s.unit_name].filter(Boolean).join(' · ');
/** Google Maps directions for one address. */
export const addressLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
/** The whole day as Google Maps directions, split into parts phones can open (four stops each). */
export const routeMapLinks = (stops: Pick<RouteStopInput, 'address'>[]) =>
  dayRouteLinks(stops.map(s => ({ address: s.address }) as DayRouteStop));
/** "stops 1–4", or "stop 5" for a part with one stop. */
export const stopRange = (l: { first: number; last: number }) => (l.first === l.last ? `stop ${l.first}` : `stops ${l.first}–${l.last}`);

/** A priority worth calling out: AppFolio marks nearly every in-house job Normal. */
export const notablePriority = (p: string | null | undefined) => (p && !/^(normal|low)$/i.test(p.trim()) ? p.trim() : null);

/** The door notes that matter on site, in order, without blanks. */
export function doorNotes(d: StopDetails | undefined): string[] {
  if (!d) return [];
  return [
    d.permission_to_enter ? `Permission to enter: ${d.permission_to_enter}` : '',
    d.entry_instructions ? `Entry: ${d.entry_instructions}` : '',
    d.preferred_times ? `Preferred times: ${d.preferred_times}` : '',
    d.tenant_remarks ? `Tenant: ${d.tenant_remarks}` : '',
  ].map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface RouteLinks { myDay: string; daySheet: string }

/** The email to the tech: the whole day in order, with map links and the door notes. */
export function dayRouteEmail(route: DayRoute, links: RouteLinks): { subject: string; html: string; text: string } {
  const day = routeDayLabel(route.routeDate);
  const lead = route.updated ? 'Updated route' : 'Your route';
  const subject = `${lead} for ${routeDayLabel(route.routeDate, 'short')}: ${route.stops.length} stop${route.stops.length === 1 ? '' : 's'}, start ${startClock(route.routeDate, route.startTime)}`;
  const maps = routeMapLinks(route.stops);
  const rows = route.stops.map(s => {
    const notes = doorNotes(s.details);
    const priority = notablePriority(s.details?.priority);
    return `<tr><td style="padding:10px 8px;border-bottom:1px solid #e3e8e2;vertical-align:top;font-weight:700;color:#1f5c22;white-space:nowrap">${s.stop_order}. ${escapeHtml(clockTime(s.arrival))}</td>
<td style="padding:10px 8px;border-bottom:1px solid #e3e8e2;vertical-align:top">
<b>${escapeHtml(placeLine(s))}</b><br><a href="${escapeHtml(addressLink(s.address))}" style="color:#1f5c22">${escapeHtml(s.address)}</a>
<br><span style="color:#3d433d">${escapeHtml([s.wo_number ? `WO ${s.wo_number}` : '', s.details?.task || ''].filter(Boolean).join(' · '))}</span>
${priority ? `<br><span style="color:#8f2c1f">Priority: ${escapeHtml(priority)}</span>` : ''}
${notes.map(n => `<br><span style="color:#5b625b;font-size:13px">${escapeHtml(n)}</span>`).join('')}
<br><span style="color:#5b625b;font-size:12px">About ${duration(s.service_minutes)} on site</span></td></tr>`;
  }).join('');
  const html = `<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:640px">
<h2 style="margin:0 0 4px">${escapeHtml(lead)} for ${escapeHtml(day)}</h2>
<p style="margin:0 0 14px;color:#5b625b">Start ${escapeHtml(startClock(route.routeDate, route.startTime))} at the shop · ${route.stops.length} stop${route.stops.length === 1 ? '' : 's'} · done about ${escapeHtml(clockTime(route.finish))}</p>
${route.notes ? `<p style="margin:0 0 14px;padding:10px 12px;background:#eef5ee;border-radius:8px">${escapeHtml(route.notes)}</p>` : ''}
<p style="margin:0 0 14px"><a href="${escapeHtml(links.myDay)}" style="display:inline-block;padding:10px 16px;background:#2f7d32;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Open My Day</a>
&nbsp; <a href="${escapeHtml(links.daySheet)}" style="color:#1f5c22">Day sheet (PDF)</a></p>
<table style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table>
${maps.length ? `<p style="margin:14px 0 0">Directions: ${maps.map(l => `<a href="${escapeHtml(l.href)}" style="color:#1f5c22">${stopRange(l)}</a>`).join(' · ')}</p>` : ''}
<p style="margin:16px 0 0;color:#8a918a;font-size:12px">Planned by the office in HDPM-OS. Questions about a stop? Call the office.</p></div>`;
  const text = [
    `${lead} for ${day}`,
    `Start ${startClock(route.routeDate, route.startTime)} at the shop · ${route.stops.length} stops · done about ${clockTime(route.finish)}`,
    route.notes || '',
    '',
    ...route.stops.flatMap(s => [
      `${s.stop_order}. ${clockTime(s.arrival)} — ${placeLine(s)}`,
      `   ${s.address}`,
      `   ${[s.wo_number ? `WO ${s.wo_number}` : '', s.details?.task || ''].filter(Boolean).join(' · ')}`,
      ...doorNotes(s.details).map(n => `   ${n}`),
    ]),
    '',
    `My Day: ${links.myDay}`,
    `Day sheet: ${links.daySheet}`,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
  return { subject, html, text };
}

/** Text cut at a word to at most max characters, with "…" when cut. */
export function clipAtWord(input: string, max: number): string {
  const t = input.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** The text message: one line per stop, tasks cut at a word, a link to the full day. Kept under 600 characters. */
export function dayRouteText(route: DayRoute, links: RouteLinks): string {
  const head = `HDPM: ${route.updated ? 'Updated route' : 'Your route'} for ${routeDayLabel(route.routeDate, 'short')}, start ${startClock(route.routeDate, route.startTime)}.`;
  const tail = `Full day: ${links.myDay}`;
  const lines: string[] = [];
  const total = route.stops.length;
  for (const [i, s] of route.stops.entries()) {
    const line = `${s.stop_order}) ${clockTime(s.arrival)} ${s.property_name}${s.details?.task ? ` – ${clipAtWord(s.details.task, 40)}` : ''}`;
    const rest = total - i - 1;
    // Leave room for "+N more" in case the next stop doesn't fit.
    if ([head, ...lines, line, ...(rest ? [`+${rest} more`] : []), tail].join('\n').length > 600) { lines.push(`+${total - i} more`); break; }
    lines.push(line);
  }
  return [head, ...lines, tail].join('\n');
}

/** US numbers to E.164 (+1XXXXXXXXXX); anything else returns null. */
export function normalizePhone(input: string): string | null {
  const digits = (input || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
