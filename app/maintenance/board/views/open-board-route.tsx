'use client';

import { useMemo, useState } from 'react';
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
        Scheduling lives in AppFolio — use <b>View AppFolio calendar</b> for the authoritative
        schedule. Here, tick the stops for a run (the list respects the staff/HDMS filter above),
        then <b>Optimize route</b> for the least-driving order + a Google Maps turn-by-turn link.
        Starts from the HDPM office.
      </p>
    </section>
  );
}
