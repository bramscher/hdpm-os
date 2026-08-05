'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BoardData } from '../board-types';
import { todayStr } from '../board-types';
import { GoogleMap } from '@/components/GoogleMap';
import { HDPM_OFFICE_LAT, HDPM_OFFICE_LNG } from '@/types/routes';

/** AppFolio's own property/work-order calendar — the authoritative schedule. */
const APPFOLIO_CALENDAR_URL = 'https://highdesertpm.appfolio.com/calendar/properties';

interface RouteStopOut {
  work_order_id: string;
  wo_number: string | null;
  description: string;
  property_name: string;
  unit_name: string | null;
  address: string;
  lat: number;
  lng: number;
  stop_order: number;
  drive_minutes_from_prev: number;
  service_minutes: number;
}

interface OptimizeResult {
  stops: RouteStopOut[];
  polyline: string | null;
  total_drive_minutes: number;
  total_service_minutes: number;
  source: 'google' | 'haversine';
  excluded: { work_order_id: string; reason: string }[];
}

interface PublishedStop {
  work_order_id: string;
  stop_order: number;
  address: string;
  drive_minutes_from_prev: number;
  service_minutes: number;
  work_orders: {
    wo_number: string | null;
    description: string;
    property_name: string;
    unit_name: string | null;
    stage: string;
  } | null;
}

interface PublishedRoute {
  id: string;
  route_date: string;
  assigned_tech: string | null;
  total_drive_minutes: number;
  total_service_minutes: number;
  stop_count: number;
  calendar_event_id: string | null;
  stops: PublishedStop[];
}

interface PublishOutcome {
  scheduled: string[];
  dated: string[];
  skipped: { work_order_id: string; error: string }[];
  calendar: { created: boolean; skippedReason?: string; webLink?: string | null };
}

function fmtMins(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * On-the-fly day route builder for the in-house HDMS crew. Pick the stops for a
 * run (the list is already screened by the shared staff/HDMS filter above), and
 * we geocode + optimize the driving order via Google, draw the loop on a map,
 * and hand off a turn-by-turn Google Maps link. Scheduling itself stays in
 * AppFolio — the calendar link opens their authoritative view.
 */
export default function OpenBoardRoute({ board }: { board: BoardData }) {
  // Scheduled work first (by date), then the rest — makes "today's run" easy to pick.
  const wos = useMemo(
    () =>
      [...board.open].sort(
        (a, b) =>
          (a.scheduled_start ?? '9999').localeCompare(b.scheduled_start ?? '9999') ||
          a.property_name.localeCompare(b.property_name),
      ),
    [board.open],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Publish state ──
  const [publishDate, setPublishDate] = useState(todayStr());
  const [tech, setTech] = useState('Alberto');
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const [published, setPublished] = useState<PublishedRoute[]>([]);

  const loadPublished = useCallback(async (date: string) => {
    try {
      const res = await fetch(`/api/maintenance/routes?date=${date}`);
      const data = await res.json();
      if (res.ok) setPublished(data.routes ?? []);
    } catch {
      /* non-fatal — the publish list is informational */
    }
  }, []);

  useEffect(() => {
    loadPublished(publishDate);
  }, [publishDate, loadPublished]);

  async function publish() {
    if (!result) return;
    setPublishing(true);
    setPublishError(null);
    setOutcome(null);
    try {
      const res = await fetch('/api/maintenance/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeDate: publishDate,
          assignedTech: tech,
          stops: result.stops,
          polyline: result.polyline,
          totalDriveMinutes: result.total_drive_minutes,
          totalServiceMinutes: result.total_service_minutes,
          createCalendarEvent: addToCalendar,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      setOutcome(data as PublishOutcome);
      await loadPublished(publishDate);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }

  async function cancelRoute(id: string) {
    try {
      const res = await fetch(`/api/maintenance/routes/${id}`, { method: 'DELETE' });
      if (res.ok) await loadPublished(publishDate);
    } catch {
      /* leave the row; a reload will re-sync */
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectTodayScheduled = () => {
    const today = todayStr();
    setSelected(
      new Set(wos.filter((w) => (w.scheduled_start ?? '').slice(0, 10) === today).map((w) => w.id)),
    );
  };

  async function optimize() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/maintenance/routes/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderIds: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Route optimization failed');
      setResult(data as OptimizeResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Route optimization failed');
    } finally {
      setLoading(false);
    }
  }

  const pins = (result?.stops ?? []).map((s) => ({
    lat: s.lat,
    lng: s.lng,
    label: String(s.stop_order),
    title: `${s.stop_order}. ${s.address}`,
    color: 'terra' as const,
  }));

  const mapsUrl = result
    ? `https://www.google.com/maps/dir/${HDPM_OFFICE_LAT},${HDPM_OFFICE_LNG}/` +
      result.stops.map((s) => `${s.lat},${s.lng}`).join('/')
    : '';

  const totalMins = result ? result.total_drive_minutes + result.total_service_minutes : 0;

  return (
    <section>
      <div className="grouptools" style={{ flexWrap: 'wrap' }}>
        <button className="mo-btn secondary" onClick={() => setSelected(new Set(wos.map((w) => w.id)))}>
          Select all
        </button>
        <button className="mo-btn secondary" onClick={() => setSelected(new Set())}>
          Clear
        </button>
        <button className="mo-btn secondary" onClick={selectTodayScheduled}>
          Today&apos;s scheduled
        </button>
        <button className="mo-btn" onClick={optimize} disabled={selected.size < 1 || loading}>
          {loading ? 'Optimizing…' : `Optimize route (${selected.size})`}
        </button>
        <a
          className="note"
          href={APPFOLIO_CALENDAR_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto', textDecoration: 'underline' }}
        >
          View AppFolio calendar ↗
        </a>
      </div>

      {error && (
        <p className="note" style={{ color: '#b91c1c', borderColor: '#fca5a5' }}>
          {error}
        </p>
      )}

      {published.length > 0 && (
        <div className="card" style={{ margin: '10px 0', borderColor: 'var(--ok)' }}>
          {published.map((r) => (
            <div key={r.id} style={{ fontSize: 13 }}>
              <b>
                Published route · {r.route_date} · {r.assigned_tech ?? 'unassigned'}
              </b>{' '}
              — {r.stop_count} stops · drive {fmtMins(r.total_drive_minutes)} · on-site{' '}
              {fmtMins(r.total_service_minutes)}
              {r.calendar_event_id && ' · on Outlook'}
              <button
                className="mo-btn secondary"
                style={{ marginLeft: 10 }}
                onClick={() => cancelRoute(r.id)}
              >
                Cancel route
              </button>
              <ol style={{ margin: '4px 0 6px', paddingLeft: 22 }}>
                {r.stops.map((s) => (
                  <li key={s.work_order_id} style={{ fontSize: 12 }}>
                    {s.work_orders?.property_name ?? s.address}
                    {s.work_orders?.unit_name ? ` · ${s.work_orders.unit_name}` : ''}
                    {s.work_orders?.wo_number ? ` · #${s.work_orders.wo_number}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div style={{ margin: '10px 0' }}>
          <GoogleMap pins={pins} polyline={result.polyline} height="360px" showOffice />
          <div className="grouptools" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <span className="note" style={{ border: 'none', padding: 0, margin: 0 }}>
              {result.stops.length} stops · drive {fmtMins(result.total_drive_minutes)} · on-site{' '}
              {fmtMins(result.total_service_minutes)} · <b>~{fmtMins(totalMins)} total</b>
              {result.source === 'haversine' && ' · (estimated — Google route unavailable)'}
            </span>
            <a
              className="mo-btn"
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: 'auto' }}
            >
              Open in Google Maps ↗
            </a>
          </div>
          <ol style={{ margin: '6px 0 0', paddingLeft: 22 }}>
            {result.stops.map((s) => (
              <li key={s.work_order_id} style={{ fontSize: 13, marginBottom: 3 }}>
                <b>{s.property_name}</b>
                {s.unit_name ? ` · ${s.unit_name}` : ''} — {s.address}
                {s.wo_number ? ` · #${s.wo_number}` : ''}
                <span className="note" style={{ border: 'none', padding: 0, marginLeft: 6 }}>
                  (+{fmtMins(s.drive_minutes_from_prev)} drive)
                </span>
              </li>
            ))}
          </ol>
          {result.excluded.length > 0 && (
            <p className="note" style={{ marginTop: 6 }}>
              {result.excluded.length} work order{result.excluded.length === 1 ? '' : 's'} skipped
              (no address / could not geocode).
            </p>
          )}

          <div
            className="grouptools"
            style={{ marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <b style={{ fontSize: 13 }}>Publish day route:</b>
            <input
              type="date"
              value={publishDate}
              onChange={(e) => setPublishDate(e.target.value)}
              style={{ fontSize: 13 }}
            />
            <select value={tech} onChange={(e) => setTech(e.target.value)} style={{ fontSize: 13 }}>
              <option value="Alberto">Alberto</option>
              <option value="Brody">Brody</option>
            </select>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={addToCalendar}
                onChange={(e) => setAddToCalendar(e.target.checked)}
              />
              Add to Outlook calendar
            </label>
            <button className="mo-btn" onClick={publish} disabled={publishing}>
              {publishing ? 'Publishing…' : `Publish route (${result.stops.length} stops)`}
            </button>
          </div>
          {publishError && (
            <p className="note" style={{ color: '#b91c1c', borderColor: '#fca5a5' }}>
              {publishError}
            </p>
          )}
          {outcome && (
            <p className="note" style={{ marginTop: 6, borderColor: 'var(--ok)' }}>
              Route published · {outcome.scheduled.length} WO
              {outcome.scheduled.length === 1 ? '' : 's'} moved to SCHEDULED
              {outcome.dated.length > 0 &&
                ` · ${outcome.dated.length} kept their stage (date + tech set)`}
              {outcome.skipped.length > 0 && ` · ${outcome.skipped.length} could not be updated`}
              {' · '}
              {outcome.calendar.created ? (
                outcome.calendar.webLink ? (
                  <a href={outcome.calendar.webLink} target="_blank" rel="noopener noreferrer">
                    Outlook event created ↗
                  </a>
                ) : (
                  'Outlook event created'
                )
              ) : (
                `calendar: ${outcome.calendar.skippedReason ?? 'skipped'}`
              )}
              {' · Now on the home dashboard.'}
            </p>
          )}
        </div>
      )}

      {wos.length === 0 ? (
        <p className="note">No open work orders match the current filter.</p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {wos.map((w) => {
            const sched = w.scheduled_start ? w.scheduled_start.slice(0, 10) : null;
            return (
              <label
                key={w.id}
                className="card"
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(w.id)}
                  onChange={() => toggle(w.id)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>
                    {w.property_name}
                    {w.unit_name ? ` · ${w.unit_name}` : ''}
                  </b>
                  {sched && <span className="stagechip" style={{ marginLeft: 6 }}>{sched}</span>}
                  <br />
                  <span className="note" style={{ border: 'none', padding: 0 }}>
                    {w.property_address || 'no address'}
                    {w.wo_number ? ` · #${w.wo_number}` : ''}
                    {w.assigned_to ? ` · ${w.assigned_to}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      <p className="note" style={{ marginTop: 10 }}>
        Tick the stops for a run (the list respects the staff/HDMS filter above), then{' '}
        <b>Optimize route</b> for the least-driving order, and <b>Publish day route</b> to put it
        on the schedule: each stop&apos;s WO gets the route date + tech (audited), the run appears
        on the home dashboard, and Outlook gets the crew&apos;s calendar event. Starts from the
        HDPM office. <b>View AppFolio calendar</b> stays the property-side view.
      </p>
    </section>
  );
}
