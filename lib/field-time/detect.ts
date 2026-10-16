import { estimateDriveMinutes, haversineDistance } from '@/lib/route-engine';
import { FIELD_CONFIG, type FieldConfig } from './config';
import type { Interval, Place, Point, Stop } from './model';

const MIN = 60000;
type LatLng = { lat: number; lng: number };
export const distanceM = (a: LatLng, b: LatLng) => haversineDistance(a.lat, a.lng, b.lat, b.lng);

/** Sorted, de-duplicated fixes, without inaccurate fixes or single-point spikes. */
export function cleanPoints(points: Point[], cfg: FieldConfig = FIELD_CONFIG): Point[] {
  const sorted = points
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.acc == null || p.acc <= cfg.maxAccuracyM))
    .sort((a, b) => a.t - b.t)
    .filter((p, i, all) => i === 0 || p.t !== all[i - 1].t);
  return sorted.filter((p, i) => {
    if (i === 0 || i === sorted.length - 1) return true;
    const prev = sorted[i - 1], next = sorted[i + 1];
    return !(distanceM(p, prev) > cfg.spikeM && distanceM(p, next) > cfg.spikeM && distanceM(prev, next) < cfg.spikeNeighborM);
  });
}

/**
 * Places the tech stayed. Fixes within clusterRadius of the running centre form one cluster; across a
 * long gap, moving less than stationaryGap still counts as staying (phones report rarely when still).
 * Short stops are kept only inside a known place (a quick Pro-desk pickup); same-place stops close
 * together merge.
 */
export function detectStops(points: Point[], places: Place[] = [], cfg: FieldConfig = FIELD_CONFIG): Stop[] {
  const clusters: Point[][] = [];
  let current: Point[] = [];
  let centre: LatLng = { lat: 0, lng: 0 };
  for (const p of cleanPoints(points, cfg)) {
    if (current.length) {
      const last = current[current.length - 1];
      const d = distanceM(centre, p);
      if (d <= cfg.clusterRadiusM || (p.t - last.t > cfg.gapMin * MIN && d <= cfg.stationaryGapM)) {
        current.push(p);
        centre = { lat: centre.lat + (p.lat - centre.lat) / current.length, lng: centre.lng + (p.lng - centre.lng) / current.length };
        continue;
      }
      clusters.push(current);
    }
    current = [p];
    centre = { lat: p.lat, lng: p.lng };
  }
  if (current.length) clusters.push(current);
  const known = places.filter(p => p.active);
  const stops: Stop[] = clusters
    .map(c => ({ start: c[0].t, end: c[c.length - 1].t, lat: c.reduce((n, p) => n + p.lat, 0) / c.length, lng: c.reduce((n, p) => n + p.lng, 0) / c.length, count: c.length }))
    .filter(s => s.end - s.start >= cfg.detectDwellMin * MIN)
    .filter(s => s.end - s.start >= cfg.minStopMin * MIN || known.some(pl => distanceM(s, pl) <= pl.radiusM));
  const merged: Stop[] = [];
  for (const s of stops) {
    const prev = merged[merged.length - 1];
    if (prev && s.start - prev.end < cfg.mergeGapMin * MIN && distanceM(prev, s) <= cfg.stationaryGapM) {
      const count = prev.count + s.count;
      merged[merged.length - 1] = { start: prev.start, end: s.end, lat: (prev.lat * prev.count + s.lat * s.count) / count, lng: (prev.lng * prev.count + s.lng * s.count) / count, count };
    } else merged.push(s);
  }
  return merged;
}

export type Piece = { type: 'stop'; stop: Stop; start: number; end: number } | { type: 'drive' | 'no_data'; start: number; end: number };

/**
 * The whole window as stops, drives and gaps in the data. A gap between fixes longer than the drive it
 * could have been (plus slack) is no_data: the phone was off or out of signal, so nobody can say what
 * happened. Short gaps at the window edges stretch the neighbouring piece.
 */
export function detectPieces(points: Point[], window: Interval, places: Place[] = [], cfg: FieldConfig = FIELD_CONFIG): Piece[] {
  const fixes = cleanPoints(points.filter(p => p.t >= window.start && p.t <= window.end), cfg);
  if (!fixes.length) return [{ type: 'no_data', start: window.start, end: window.end }];
  const pieces: Piece[] = [];
  const firstT = fixes[0].t, lastT = fixes[fixes.length - 1].t;
  const startAt = firstT - window.start > cfg.gapMin * MIN ? firstT : window.start;
  const endAt = window.end - lastT > cfg.gapMin * MIN ? lastT : window.end;
  if (startAt > window.start) pieces.push({ type: 'no_data', start: window.start, end: startAt });
  const travel = (from: number, to: number) => {
    let t = from;
    const between = fixes.filter(p => p.t >= from && p.t <= to);
    for (let i = 1; i < between.length; i++) {
      const a = between[i - 1], b = between[i];
      if (b.t - a.t <= cfg.gapMin * MIN) continue;
      const moved = distanceM(a, b);
      if (moved < cfg.stationaryGapM || b.t - a.t <= (estimateDriveMinutes(moved) + cfg.driveSlackMin) * MIN) continue;
      if (a.t > t) pieces.push({ type: 'drive', start: t, end: a.t });
      pieces.push({ type: 'no_data', start: a.t, end: b.t });
      t = b.t;
    }
    if (to > t) pieces.push({ type: 'drive', start: t, end: to });
  };
  let cursor = startAt;
  for (const stop of detectStops(fixes, places, cfg)) {
    const start = stop.start === firstT ? startAt : stop.start;
    const end = stop.end === lastT ? endAt : stop.end;
    travel(cursor, start);
    pieces.push({ type: 'stop', stop, start, end });
    cursor = end;
  }
  travel(cursor, endAt);
  if (endAt < window.end) pieces.push({ type: 'no_data', start: endAt, end: window.end });
  return pieces;
}
