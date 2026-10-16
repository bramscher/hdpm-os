'use client';
import { useEffect, useState } from 'react';
import { addressLink, clockTime, doorNotes, duration, notablePriority, placeLine, routeDayLabel, routeMapLinks, startClock, stopRange, type StopDetails } from '@/lib/maintenance/route-day';
import { workOrderTitle } from '@/lib/field-time/model';
import { pacificDay } from '@/lib/maintenance-workspace/model';

interface RouteStop {
  work_order_id: string; stop_order: number; address: string; service_minutes: number; arrival: string; details: StopDetails | null;
  work_orders: { wo_number: string | null; property_name: string | null; unit_name: string | null; description: string | null } | null;
}
interface Route { id: string; start_time: string | null; notes: string | null; finish: string; stops: RouteStop[] }

/** The day the office published for this tech from the Open Board route builder: stops in order with times, map links and door notes. */
export default function RouteToday({ day, tech, viewing, onRoute }: { day: string; tech: string; viewing: boolean; onRoute: (has: boolean) => void }) {
  const [route, setRoute] = useState<Route | null>(null), [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setReady(false);
    fetch(`/api/maintenance/routes?date=${day}&tech=${encodeURIComponent(tech)}`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!live) return; const found = (d.routes?.[0] as Route | undefined) ?? null; setRoute(found); setReady(true); onRoute(!!found); })
      .catch(() => { if (live) { setRoute(null); setReady(false); onRoute(false); } });
    return () => { live = false; };
  }, [day, tech, onRoute]);
  // While loading, or if routes can't load, say nothing: the rest of My Day still works.
  if (!ready) return null;
  const today = day === pacificDay();
  if (!route) return <p className="mw-callout">{viewing ? `${tech} has` : 'You have'} no route from the office for {today ? 'today' : routeDayLabel(day)} yet.</p>;
  const label = today ? 'Today’s route' : `Route for ${routeDayLabel(day)}`;
  const maps = routeMapLinks(route.stops);
  return <section className="mw-card mw-route-today" aria-label={label}>
    <p className="mw-eyebrow">FROM THE OFFICE{viewing ? ` · ${tech.toUpperCase()}` : ''}</p>
    <h2>{label}</h2>
    <p>Start {startClock(day, (route.start_time || '08:00').slice(0, 5))} at the shop · {route.stops.length} stop{route.stops.length === 1 ? '' : 's'} · done about {clockTime(route.finish)}</p>
    {route.notes && <p className="mw-callout">{route.notes}</p>}
    <ol className="mw-route-stops">{route.stops.map(s => {
      const task = s.details?.task || workOrderTitle(s.work_orders?.description, 120);
      const priority = notablePriority(s.details?.priority);
      return <li key={s.work_order_id}>
        <span className="mw-tag">{clockTime(s.arrival)} · about {duration(s.service_minutes)} on site</span>
        <h3>{s.stop_order}. {placeLine({ property_name: s.work_orders?.property_name || 'Property', unit_name: s.work_orders?.unit_name ?? null })}</h3>
        <a className="mw-route-address" href={addressLink(s.address)} target="_blank" rel="noopener noreferrer">{s.address} ↗</a>
        {(s.work_orders?.wo_number || task) && <p>{[s.work_orders?.wo_number ? `WO ${s.work_orders.wo_number}` : '', task].filter(Boolean).join(' · ')}</p>}
        {priority && <p className="mw-warning">Priority: {priority}</p>}
        {doorNotes(s.details ?? undefined).map(n => <p key={n} className="mw-route-note">{n}</p>)}
      </li>;
    })}</ol>
    <div className="mw-actions">
      {maps.map((l, i) => <a key={l.first} href={l.href} target="_blank" rel="noopener noreferrer">{maps.length === 1 ? 'Open the whole route in Maps' : `Maps part ${i + 1}: ${stopRange(l)}`} ↗</a>)}
      <a href={`/api/maintenance/routes/${route.id}/day-sheet`} target="_blank" rel="noopener noreferrer">Day sheet (PDF)</a>
    </div>
    {maps.length > 1 && <p className="mw-footnote">Open the Maps parts in order; each one starts where the last one ended.</p>}
  </section>;
}
