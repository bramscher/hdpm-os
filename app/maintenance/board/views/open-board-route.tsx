'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MaintWorkOrder } from '@/lib/maintenance/types';
import type { BoardData } from '../board-types';
import { fmtDate, isInternalVendor, todayStr, woWhere } from '../board-types';
import { GoogleMap } from '@/components/GoogleMap';
import { HDPM_OFFICE_LAT, HDPM_OFFICE_LNG } from '@/types/routes';
import { workOrderTitle } from '@/lib/field-time/model';
import {
  clockTime,
  doorNotes,
  duration,
  notablePriority,
  routeDayLabel,
  scheduleStops,
  startClock,
  type StopDetails,
} from '@/lib/maintenance/route-day';
import './open-board-route.css';

/** AppFolio's own property/work-order calendar. */
const APPFOLIO_CALENDAR_URL = 'https://highdesertpm.appfolio.com/calendar/properties';
/** The in-house crew a day can be published for (staff.person). */
const TECHS = ['Alberto', 'Brody'];
const ZONE = 'America/Los_Angeles';
/** Time on site choices, in minutes. */
const ON_SITE = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480];
const CHANNEL_LABEL = { outlook: 'Outlook invite', email: 'Email', text: 'Text', my_day: 'My Day' } as const;

interface RouteStopOut {
  work_order_id: string;
  wo_number: string | null;
  description: string;
  property_name: string;
  unit_name: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  stop_order: number;
  drive_minutes_from_prev: number;
  service_minutes: number;
}

interface PlannedRoute {
  stops: RouteStopOut[];
  polyline: string | null;
  source: 'google' | 'haversine' | 'published';
  excluded: { work_order_id: string; reason: string }[];
}

interface ChannelOutcome {
  channel: keyof typeof CHANNEL_LABEL;
  ok: boolean;
  detail: string;
}

interface PublishedStop {
  work_order_id: string;
  stop_order: number;
  address: string;
  lat: number | null;
  lng: number | null;
  drive_minutes_from_prev: number;
  service_minutes: number;
  arrival: string;
  details: StopDetails | null;
  work_orders: {
    wo_number: string | null;
    description: string | null;
    property_name: string | null;
    unit_name: string | null;
    stage: string | null;
  } | null;
}

interface PublishedRoute {
  id: string;
  route_date: string;
  assigned_tech: string | null;
  start_time: string | null;
  notes: string | null;
  polyline: string | null;
  finish: string;
  notify_log: { at: string; by: string; outcomes: ChannelOutcome[] }[] | null;
  stops: PublishedStop[];
}

interface PublishOutcome {
  planId: string;
  updated: boolean;
  scheduled: string[];
  dated: string[];
  skipped: { work_order_id: string; error: string }[];
  notified: ChannelOutcome[];
  routeDate: string;
  tech: string;
}

type Scope = 'mine' | 'inhouse' | 'all';

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const sameName = (a: string | null | undefined, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();
const stageLabel = (stage: string | null | undefined) => (stage ?? '').replace(/_/g, ' ');
const daySheetUrl = (planId: string) => `/api/maintenance/routes/${planId}/day-sheet`;
const fieldAppUrl = (date: string, tech: string) =>
  `/maintenance/field?date=${date}&tech=${encodeURIComponent(tech)}`;
const sentAt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** AppFolio's scheduled start as a Pacific date (date-only values are already one). */
function pacificDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 10) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: ZONE });
}

/** Which list a work order belongs in: the tech's own and unassigned in-house work, all in-house, or everything. */
function inScope(wo: MaintWorkOrder, scope: Scope, tech: string): boolean {
  if (scope === 'all') return true;
  if (!isInternalVendor(wo)) return false;
  if (scope === 'inhouse') return true;
  const unassigned = !wo.assigned_to && !wo.assigned_tech;
  return unassigned || sameName(wo.assigned_tech, tech) || (wo.assigned_to ?? '').toLowerCase().includes(tech.toLowerCase());
}

const minutesLabel = (m: number) => (m < 60 ? `${m} min` : duration(m));

/**
 * The office plans a tech's day: pick the in-house work orders, plan the least-driving order (from
 * the office), set the start time and the time on site at each stop, and publish. Publishing puts
 * the work orders on the schedule and sends the day to the tech: Outlook invite, email, a text when
 * their mobile is on file, and My Day in the Field app; the day sheet prints from here too.
 */
export default function OpenBoardRoute({ board }: { board: BoardData }) {
  const [date, setDate] = useState(todayStr());
  const [tech, setTech] = useState(TECHS[0]);
  const [scope, setScope] = useState<Scope>('inhouse');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<PlannedRoute | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('08:00');
  const [notes, setNotes] = useState('');
  const [onSite, setOnSite] = useState<Record<string, number>>({});
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const [published, setPublished] = useState<PublishedRoute[]>([]);
  // Bumped on each publish so the cards start fresh (no left-over re-send results).
  const [publishCount, setPublishCount] = useState(0);
  const [publishedError, setPublishedError] = useState<string | null>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const [scrollToPlan, setScrollToPlan] = useState(0);
  const loadSeq = useRef(0);

  const loadPublished = useCallback(async (day: string) => {
    if (!isDate(day)) return;
    const seq = ++loadSeq.current;
    try {
      const res = await fetch(`/api/maintenance/routes?date=${day}`);
      const data = await res.json().catch(() => ({}));
      if (seq !== loadSeq.current) return;
      if (!res.ok) throw new Error(data.error || `Published routes could not load (${res.status})`);
      setPublished(data.routes ?? []);
      setPublishedError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setPublished([]);
      setPublishedError(e instanceof Error ? e.message : 'Published routes could not load');
    }
  }, []);

  useEffect(() => {
    loadPublished(date);
  }, [date, loadPublished]);

  useEffect(() => {
    if (scrollToPlan) planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollToPlan]);

  const woById = useMemo(() => new Map(board.open.map((w) => [w.id, w])), [board.open]);
  const existing = published.find((r) => sameName(r.assigned_tech, tech)) ?? null;
  const onRoute = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of published) for (const s of r.stops) m.set(s.work_order_id, r.assigned_tech ?? '');
    return m;
  }, [published]);

  // AppFolio-scheduled work first (by date), then by property, so a property's jobs sit together.
  const sorted = useMemo(
    () =>
      [...board.open].sort(
        (a, b) =>
          (a.scheduled_start ?? '9999').localeCompare(b.scheduled_start ?? '9999') ||
          a.property_name.localeCompare(b.property_name) ||
          (a.unit_name ?? '').localeCompare(b.unit_name ?? ''),
      ),
    [board.open],
  );
  const list = useMemo(() => sorted.filter((w) => inScope(w, scope, tech)), [sorted, scope, tech]);
  const counts = useMemo(
    () => ({
      mine: board.open.filter((w) => inScope(w, 'mine', tech)).length,
      inhouse: board.open.filter((w) => inScope(w, 'inhouse', tech)).length,
      all: board.open.length,
    }),
    [board.open, tech],
  );
  const shownIds = new Set(list.map((w) => w.id));
  const hiddenSelected = [...selected].filter((id) => !shownIds.has(id)).length;
  const appfolioThatDay = list.filter((w) => pacificDate(w.scheduled_start) === date);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const minutesFor = (s: { work_order_id: string; service_minutes: number }) =>
    onSite[s.work_order_id] ?? s.service_minutes;

  const timed = useMemo(() => {
    if (!plan || !isDate(date)) return null;
    try {
      return scheduleStops(
        date,
        startTime,
        plan.stops.map((s) => ({ ...s, service_minutes: onSite[s.work_order_id] ?? s.service_minutes })),
      );
    } catch {
      return null;
    }
  }, [plan, date, startTime, onSite]);

  // The plan no longer matches the ticked work orders: plan again before publishing.
  // (Unticking a work order the plan already left off is fine.)
  const planned = plan
    ? new Set([...plan.stops.map((s) => s.work_order_id), ...plan.excluded.map((x) => x.work_order_id)])
    : null;
  const stale =
    !!plan &&
    (plan.stops.some((s) => !selected.has(s.work_order_id)) || [...selected].some((id) => !planned!.has(id)));

  async function planRoute() {
    setPlanning(true);
    setPlanError(null);
    setOutcome(null);
    try {
      const res = await fetch('/api/maintenance/routes/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderIds: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The route could not be planned');
      setPlan({ stops: data.stops, polyline: data.polyline, source: data.source, excluded: data.excluded ?? [] });
      setScrollToPlan((n) => n + 1);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : 'The route could not be planned');
    } finally {
      setPlanning(false);
    }
  }

  async function publish() {
    if (!plan) return;
    setPublishing(true);
    setPublishError(null);
    setOutcome(null);
    try {
      const res = await fetch('/api/maintenance/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeDate: date,
          assignedTech: tech,
          startTime,
          notes,
          stops: plan.stops.map((s) => ({
            work_order_id: s.work_order_id,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
            drive_minutes_from_prev: s.drive_minutes_from_prev,
            service_minutes: minutesFor(s),
          })),
          polyline: plan.polyline,
          createCalendarEvent: addToCalendar,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The route could not be published');
      setOutcome({ ...(data as Omit<PublishOutcome, 'routeDate' | 'tech'>), routeDate: date, tech });
      setPublishCount((n) => n + 1);
      setPlan(null);
      setSelected(new Set());
      setNotes('');
      setStartTime('08:00');
      setScrollToPlan((n) => n + 1);
      await loadPublished(date);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'The route could not be published');
    } finally {
      setPublishing(false);
    }
  }

  /** Load a published route back into the builder to change it; publishing again replaces it. */
  function changeRoute(r: PublishedRoute) {
    setTech(r.assigned_tech || tech);
    setStartTime((r.start_time || '08:00').slice(0, 5));
    setNotes(r.notes || '');
    setSelected(new Set(r.stops.map((s) => s.work_order_id)));
    setOnSite((prev) => ({ ...prev, ...Object.fromEntries(r.stops.map((s) => [s.work_order_id, s.service_minutes])) }));
    setPlan({
      stops: r.stops.map((s) => ({
        work_order_id: s.work_order_id,
        wo_number: s.work_orders?.wo_number ?? null,
        description: s.work_orders?.description ?? s.details?.task ?? '',
        property_name: s.work_orders?.property_name || 'Property',
        unit_name: s.work_orders?.unit_name ?? null,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        stop_order: s.stop_order,
        drive_minutes_from_prev: s.drive_minutes_from_prev,
        service_minutes: s.service_minutes,
      })),
      polyline: r.polyline,
      source: 'published',
      excluded: [],
    });
    setOutcome(null);
    setPublishError(null);
    setScrollToPlan((n) => n + 1);
  }

  const pins = (plan?.stops ?? [])
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({
      lat: s.lat as number,
      lng: s.lng as number,
      label: String(s.stop_order),
      title: `${s.stop_order}. ${s.address}`,
      color: 'terra' as const,
    }));
  const mapsUrl = plan
    ? `https://www.google.com/maps/dir/${HDPM_OFFICE_LAT},${HDPM_OFFICE_LNG}/` +
      plan.stops
        .map((s) => (s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : encodeURIComponent(s.address)))
        .join('/')
    : '';
  const driveTotal = plan ? plan.stops.reduce((n, s) => n + s.drive_minutes_from_prev, 0) : 0;
  const onSiteTotal = plan ? plan.stops.reduce((n, s) => n + minutesFor(s), 0) : 0;
  const sendLabel = existing ? `Replace ${tech}’s route and send the update` : `Publish and send to ${tech}`;

  return (
    <section className="rb">
      <div className="rb-day">
        <label className="rb-field">
          Day
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} />
        </label>
        <label className="rb-field">
          Technician
          <select value={tech} onChange={(e) => setTech(e.target.value)}>
            {TECHS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <p className="rb-day-note" aria-live="polite">
          {existing ? (
            <>
              <b>{tech}</b> already has a route for {routeDayLabel(date, 'short')} ({existing.stops.length} stop
              {existing.stops.length === 1 ? '' : 's'}). Publishing again replaces it and sends the update.
            </>
          ) : (
            <>
              No route yet for <b>{tech}</b> on {isDate(date) ? routeDayLabel(date, 'short') : 'this day'}. Tick the
              stops below, then plan the route.
            </>
          )}
        </p>
        <a className="rb-ext" href={APPFOLIO_CALENDAR_URL} target="_blank" rel="noopener noreferrer">
          AppFolio calendar ↗
        </a>
      </div>

      {publishedError && <p className="rb-error">{publishedError}</p>}
      {published.length > 0 && (
        <>
          <h3 className="rb-section-title">Published for {routeDayLabel(date)}</h3>
          {published.map((r) => (
            <PublishedCard
              key={`${r.id}:${publishCount}`}
              route={r}
              onChange={changeRoute}
              onChanged={() => loadPublished(date)}
              onCanceled={(id) => {
                setOutcome((o) => (o?.planId === id ? null : o));
                loadPublished(date);
              }}
            />
          ))}
        </>
      )}

      <div ref={planRef} className="rb-anchor">
        {outcome && <OutcomePanel outcome={outcome} onDone={() => setOutcome(null)} />}

        {plan && (
          <div className="rb-plan">
            <h3 className="rb-section-title">
              {tech}’s route for {isDate(date) ? routeDayLabel(date) : 'this day'}
            </h3>
            <GoogleMap pins={pins} polyline={plan.polyline} height="320px" showOffice />
            <div className="rb-summary">
              <span>
                <b>{plan.stops.length}</b> stop{plan.stops.length === 1 ? '' : 's'} · drive {duration(driveTotal)} · on
                site {duration(onSiteTotal)}
                {timed && (
                  <>
                    {' '}
                    · start {startClock(date, startTime)}, done about <b>{clockTime(timed.finish)}</b>
                  </>
                )}
                {plan.source === 'haversine' && ' · drive times estimated (Google route unavailable)'}
              </span>
              <a className="mo-btn secondary" href={mapsUrl} target="_blank" rel="noopener noreferrer">
                Open in Google Maps ↗
              </a>
            </div>

            <ol className="rb-plan-stops">
              {plan.stops.map((s, i) => {
                const t = timed?.stops[i];
                const wo = woById.get(s.work_order_id);
                const mins = minutesFor(s);
                const choices = ON_SITE.includes(mins) ? ON_SITE : [...ON_SITE, mins].sort((a, b) => a - b);
                return (
                  <li key={s.work_order_id}>
                    <span className="rb-num">{s.stop_order}</span>
                    <div className="rb-when">
                      <b>{t ? clockTime(t.arrival) : '—'}</b>
                      <small>{duration(s.drive_minutes_from_prev)} drive</small>
                    </div>
                    <div className="rb-what">
                      <b>{[s.property_name, s.unit_name].filter(Boolean).join(' · ')}</b>
                      <div className="rb-task">{workOrderTitle(s.description, 120) || 'No description'}</div>
                      <small>
                        {s.address}
                        {s.wo_number ? ` · WO ${s.wo_number}` : ''}
                        {wo ? ` · ${stageLabel(wo.stage)}` : ''}
                      </small>
                    </div>
                    <label className="rb-mins">
                      On site
                      <select
                        value={mins}
                        onChange={(e) => setOnSite((prev) => ({ ...prev, [s.work_order_id]: Number(e.target.value) }))}
                        aria-label={`Time on site at stop ${s.stop_order}`}
                      >
                        {choices.map((m) => (
                          <option key={m} value={m}>
                            {minutesLabel(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ol>
            {plan.excluded.length > 0 && (
              <p className="rb-warn">
                Left off (no address or the address could not be found):{' '}
                {plan.excluded
                  .map((x) => {
                    const w = woById.get(x.work_order_id);
                    return w ? `${woWhere(w)}${w.wo_number ? ` (WO ${w.wo_number})` : ''}` : 'a work order';
                  })
                  .join('; ')}
              </p>
            )}

            <div className="rb-send">
              <label className="rb-field">
                Start at the shop
                <input type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value || '08:00')} />
              </label>
              <label className="rb-field">
                Note for {tech} (optional)
                <textarea
                  value={notes}
                  maxLength={600}
                  rows={2}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Pick up the paint at Sherwin-Williams first"
                />
              </label>
              <div className="rb-send-foot">
                <button className="mo-btn" onClick={publish} disabled={publishing || stale || !isDate(date)}>
                  {publishing ? 'Publishing…' : sendLabel}
                </button>
                <label className="rb-check">
                  <input type="checkbox" checked={addToCalendar} onChange={(e) => setAddToCalendar(e.target.checked)} />
                  Send an Outlook invite
                </label>
                <button className="mo-btn secondary" onClick={() => setPlan(null)} disabled={publishing}>
                  Discard plan
                </button>
              </div>
              {stale && (
                <p className="rb-warn rb-wide">
                  The ticked work orders changed since this route was planned. Plan the route again before publishing.
                </p>
              )}
              {publishError && <p className="rb-error rb-wide">{publishError}</p>}
              <p className="rb-hint">
                {tech} gets an Outlook invite and an email now, and a text when a mobile number is saved for them in User
                settings. The route shows on My Day in the Field app, and the day sheet prints from the published
                route. Each work order gets the date and tech, and moves to Scheduled where it can.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mo-seg rb-scope" role="tablist" aria-label="Which work orders">
        {(
          [
            ['mine', `${tech}’s + unassigned`],
            ['inhouse', 'All in-house'],
            ['all', 'All vendors'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={scope === key}
            className={scope === key ? 'on' : ''}
            onClick={() => setScope(key)}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      <PickTools
        selectedCount={selected.size}
        hiddenSelected={hiddenSelected}
        listCount={list.length}
        appfolioCount={appfolioThatDay.length}
        planning={planning}
        onSelectShown={() => setSelected((prev) => new Set([...prev, ...list.map((w) => w.id)]))}
        onClear={() => setSelected(new Set())}
        onAppfolio={() => setSelected(new Set(appfolioThatDay.map((w) => w.id)))}
        onPlan={planRoute}
      />
      {planError && <p className="rb-error">{planError}</p>}

      {list.length === 0 ? (
        <p className="note">No open work orders match this list and the filter above.</p>
      ) : (
        <ul className="rb-list">
          {list.map((w) => {
            const sched = pacificDate(w.scheduled_start);
            const routeTech = onRoute.get(w.id);
            const priority = notablePriority(w.priority);
            return (
              <li key={w.id}>
                <label className={`rb-wo${selected.has(w.id) ? ' on' : ''}`}>
                  <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)} />
                  <span className="rb-wo-body">
                    <span className="rb-wo-top">
                      <b>{woWhere(w)}</b>
                      <span className="stagechip">{stageLabel(w.stage)}</span>
                      {priority && <span className="rb-tag pri">{priority}</span>}
                      {sched && <span className="rb-tag">AppFolio {fmtDate(sched)}</span>}
                      {routeTech && <span className="rb-tag route">On {routeTech}’s route</span>}
                    </span>
                    <span className="rb-wo-task">{workOrderTitle(w.description, 120) || 'No description'}</span>
                    <span className="rb-wo-meta">
                      {w.property_address || 'No address'}
                      {w.wo_number ? ` · WO ${w.wo_number}` : ''}
                      {` · ${w.assigned_to || 'Unassigned'}`}
                      {scope === 'all' && w.vendor_name ? ` · ${w.vendor_name}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > 8 && (
        <PickTools
          selectedCount={selected.size}
          hiddenSelected={hiddenSelected}
          listCount={list.length}
          appfolioCount={appfolioThatDay.length}
          planning={planning}
          onSelectShown={() => setSelected((prev) => new Set([...prev, ...list.map((w) => w.id)]))}
          onClear={() => setSelected(new Set())}
          onAppfolio={() => setSelected(new Set(appfolioThatDay.map((w) => w.id)))}
          onPlan={planRoute}
        />
      )}

      <p className="note">
        Pick the day and the tech, tick the stops, and <b>Plan the route</b> for the least-driving order from the
        office. Set the start time and the time on site at each stop, then publish: the tech gets the day by Outlook
        invite, email, text (when their mobile is saved) and My Day, and each work order gets the date and tech
        (audited). Publishing the same tech and day again replaces that route. The list respects the filter above.
      </p>
    </section>
  );
}

function PickTools(props: {
  selectedCount: number;
  hiddenSelected: number;
  listCount: number;
  appfolioCount: number;
  planning: boolean;
  onSelectShown: () => void;
  onClear: () => void;
  onAppfolio: () => void;
  onPlan: () => void;
}) {
  return (
    <div className="rb-pick-tools">
      <button className="mo-btn" onClick={props.onPlan} disabled={props.selectedCount < 1 || props.planning}>
        {props.planning ? 'Planning…' : `Plan the route (${props.selectedCount})`}
      </button>
      <button
        className="mo-btn secondary"
        onClick={props.onSelectShown}
        disabled={props.listCount === 0 || props.listCount > 40}
        title={props.listCount > 40 ? 'Too many for one day: narrow the list first' : undefined}
      >
        Tick all shown
      </button>
      <button className="mo-btn secondary" onClick={props.onClear} disabled={props.selectedCount === 0}>
        Clear
      </button>
      {props.appfolioCount > 0 && (
        <button className="mo-btn secondary" onClick={props.onAppfolio}>
          AppFolio-scheduled that day ({props.appfolioCount})
        </button>
      )}
      {props.hiddenSelected > 0 && (
        <span className="rb-sub">
          {props.hiddenSelected} ticked outside this list
        </span>
      )}
    </div>
  );
}

function OutcomePanel({ outcome, onDone }: { outcome: PublishOutcome; onDone: () => void }) {
  const order = ['outlook', 'email', 'text', 'my_day'] as const;
  const channels = [...outcome.notified].sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel));
  const moved = outcome.scheduled.length;
  return (
    <div className="rb-outcome" role="status">
      <h3>
        {outcome.updated ? 'Updated' : 'Published'} {outcome.tech}’s route for {routeDayLabel(outcome.routeDate)}
      </h3>
      <ul className="rb-channels">
        {channels.map((c) => (
          <li key={c.channel} className={c.ok ? 'ok' : 'no'}>
            <span className="mark" aria-hidden>
              {c.ok ? '✓' : '!'}
            </span>
            <b>{CHANNEL_LABEL[c.channel]}</b>
            <span>{c.detail}</span>
          </li>
        ))}
      </ul>
      <p className="rb-sub">
        {moved} work order{moved === 1 ? '' : 's'} moved to Scheduled
        {outcome.dated.length > 0 && ` · ${outcome.dated.length} kept their stage (date and tech set)`}
        {outcome.skipped.length > 0 &&
          ` · ${outcome.skipped.length} could not be updated: ${outcome.skipped.map((s) => s.error).join('; ')}`}
      </p>
      <div className="rb-actions">
        <a className="mo-btn" href={daySheetUrl(outcome.planId)} target="_blank" rel="noopener noreferrer">
          Print day sheet ↗
        </a>
        <a
          className="mo-btn secondary"
          href={fieldAppUrl(outcome.routeDate, outcome.tech)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Field app ↗
        </a>
        <button className="mo-btn secondary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function PublishedCard({
  route,
  onChange,
  onChanged,
  onCanceled,
}: {
  route: PublishedRoute;
  onChange: (r: PublishedRoute) => void;
  onChanged: () => void;
  onCanceled: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'resend' | 'cancel' | null>(null);
  const [message, setMessage] = useState<{ outcomes?: ChannelOutcome[]; error?: string } | null>(null);
  const tech = route.assigned_tech || 'Unassigned';
  const startTime = (route.start_time || '08:00').slice(0, 5);
  const last = route.notify_log?.length ? route.notify_log[route.notify_log.length - 1] : null;
  const onSite = route.stops.reduce((n, s) => n + s.service_minutes, 0);

  async function resend() {
    setBusy('resend');
    setMessage(null);
    try {
      const res = await fetch(`/api/maintenance/routes/${route.id}/resend`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The route could not be re-sent');
      setMessage({ outcomes: data.notified ?? [] });
      onChanged();
    } catch (e) {
      setMessage({ error: e instanceof Error ? e.message : 'The route could not be re-sent' });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy('cancel');
    setMessage(null);
    try {
      const res = await fetch(`/api/maintenance/routes/${route.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The route could not be canceled');
      onCanceled(route.id);
    } catch (e) {
      setMessage({ error: e instanceof Error ? e.message : 'The route could not be canceled' });
      setBusy(null);
    }
  }

  return (
    <div className="rb-route">
      <div className="rb-route-head">
        <div>
          <div className="rb-route-title">
            <b>{tech}</b> · start {startClock(route.route_date, startTime)} · {route.stops.length} stop
            {route.stops.length === 1 ? '' : 's'} · on site {duration(onSite)} · done about {clockTime(route.finish)}
          </div>
          <div className="rb-route-sub">
            {last ? (
              <>
                Sent {sentAt(last.at)}
                {last.outcomes
                  .filter((c) => c.channel !== 'my_day')
                  .map((c) => (
                    <span key={c.channel} className={`rb-chip ${c.ok ? 'ok' : 'no'}`} title={c.detail}>
                      {c.ok ? '✓' : '✗'} {CHANNEL_LABEL[c.channel]}
                    </span>
                  ))}
              </>
            ) : (
              'Not sent yet'
            )}
          </div>
          {route.notes && <div className="rb-notes">{route.notes}</div>}
        </div>
        <div className="rb-actions">
          <button className="mo-btn secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide stops' : 'Show stops'}
          </button>
          <a className="mo-btn secondary" href={daySheetUrl(route.id)} target="_blank" rel="noopener noreferrer">
            Print day sheet ↗
          </a>
          <button className="mo-btn secondary" onClick={resend} disabled={!!busy}>
            {busy === 'resend' ? 'Sending…' : 'Re-send'}
          </button>
          <button className="mo-btn secondary" onClick={() => onChange(route)} disabled={!!busy}>
            Change
          </button>
          <button className="mo-btn secondary rb-danger" onClick={() => setConfirming(true)} disabled={!!busy}>
            Cancel route
          </button>
        </div>
      </div>

      {confirming && (
        <div className="rb-confirm" role="alert">
          <span>
            Cancel {tech}’s route for {routeDayLabel(route.route_date, 'short')}? The Outlook invite is removed. The work
            orders keep their date and stage.
          </span>
          <button className="mo-btn danger" onClick={cancel} disabled={busy === 'cancel'}>
            {busy === 'cancel' ? 'Canceling…' : 'Yes, cancel route'}
          </button>
          <button className="mo-btn secondary" onClick={() => setConfirming(false)} disabled={busy === 'cancel'}>
            Keep it
          </button>
        </div>
      )}

      {message?.error && <p className="rb-error">{message.error}</p>}
      {message?.outcomes && (
        <ul className="rb-channels rb-resent" role="status">
          {message.outcomes
            .filter((c) => c.channel !== 'my_day')
            .map((c) => (
              <li key={c.channel} className={c.ok ? 'ok' : 'no'}>
                <span className="mark" aria-hidden>
                  {c.ok ? '✓' : '!'}
                </span>
                <b>{CHANNEL_LABEL[c.channel]}</b>
                <span>{c.detail}</span>
              </li>
            ))}
        </ul>
      )}

      {open && (
        <ol className="rb-stops">
          {route.stops.map((s) => {
            const task = s.details?.task || workOrderTitle(s.work_orders?.description, 120);
            const notes = doorNotes(s.details ?? undefined);
            return (
              <li key={s.work_order_id}>
                <span className="rb-time">
                  {s.stop_order}. {clockTime(s.arrival)}
                </span>
                <span>
                  <b>{[s.work_orders?.property_name, s.work_orders?.unit_name].filter(Boolean).join(' · ') || s.address}</b>
                  {task ? ` · ${task}` : ''}
                  <br />
                  <span className="rb-sub">
                    {s.address}
                    {s.work_orders?.wo_number ? ` · WO ${s.work_orders.wo_number}` : ''} · {duration(s.service_minutes)}{' '}
                    on site
                    {notes.length > 0 && ` · ${notes.join(' · ')}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
