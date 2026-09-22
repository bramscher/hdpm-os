'use client';
import { useEffect, useRef } from 'react';
import { dayRouteLinks, drivingLink, scheduledDayRoute } from '@/lib/maintenance-workspace/day-route';
import type { Job, Visit, Workspace } from '@/lib/maintenance-workspace/model';

const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export default function DayRoute({ data, person, date, close, editVisit }: {
  data: Workspace; person: string; date: string; close: () => void;
  editVisit: (job: Job, visit?: Visit, date?: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [person, date]);
  const stops = scheduledDayRoute(data.jobs, data.visits, person, date);
  const links = dayRouteLinks(stops);
  const missing = stops.filter(s => !s.address);
  return <section ref={panel} tabIndex={-1} className="mw-card mw-day-route" aria-label={`${person} day route`}>
    <div className="mw-between"><div><h2>{person} · {date} · Day route</h2><p>{stops.length} planned visits, in appointment order · Pacific time</p></div><button onClick={close}>Close route</button></div>
    <p>Includes every planned job for this technician and day, including jobs hidden by a property filter. Check driving time against the gaps below. Opening directions does not change appointments or publish calendar events.</p>
    {missing.length > 0 && <p className="mw-warning" role="status">{missing.length} visit(s) need a property address. Correct the work-order / job address before opening the full route; no stop will be silently skipped.</p>}
    {!missing.length && stops.length > 0 && !links.length && <p className="mw-warning">The address details are too long for a full directions link. Review them before routing.</p>}
    <div className="mw-actions">{links.map((link, i) => <a key={link.first} href={link.href} target="_blank" rel="noopener noreferrer">{links.length === 1 ? 'Open route in Google Maps' : `Route part ${i + 1} · stops ${link.first}–${link.last}`} ↗</a>)}</div>
    {links.length > 1 && <p className="mw-footnote">Open each part in sequence; the next part starts at the previous part’s last stop.</p>}
    <ol className="mw-route-stops">{stops.map((stop, index) => {
      const href = drivingLink([stop.address]);
      return <li key={stop.visit.id}>
        <div className="mw-between"><h3>{index + 1}. {time(stop.visit.start_minute)} · {stop.job?.property_name || 'Job unavailable'} {stop.job?.unit_name}</h3><span>{stop.visit.planned_minutes} min planned</span></div>
        <p>{stop.address || 'Address missing'}</p><p>{stop.job?.title}</p>
        {stop.gapMinutes !== null && <p className={stop.gapMinutes <= 0 ? 'mw-warning' : ''}>{stop.gapMinutes < 0 ? `${Math.abs(stop.gapMinutes)} min overlap with previous visit` : stop.gapMinutes === 0 ? 'No travel gap after previous visit' : `${stop.gapMinutes} min between visits — check travel and breaks`}</p>}
        <div className="mw-actions">{stop.job && <button onClick={() => editVisit(stop.job!, stop.visit)}>Review appointment</button>}{href && <a href={href} target="_blank" rel="noopener noreferrer">Directions to this stop ↗</a>}</div>
      </li>;
    })}</ol>
    {!stops.length && <p>No planned visits remain for this day.</p>}
    <p className="mw-footnote">Directions start from your chosen/current location. Stops follow the calendar; this preview does not optimize the order or add travel time to booked hours.</p>
  </section>;
}
