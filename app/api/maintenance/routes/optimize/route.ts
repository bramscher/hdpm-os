import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { geocodeOne } from '@/lib/inspection-geocode';
import { optimizeRouteWithGoogle } from '@/lib/route-directions';
import type { ProposedStop } from '@/types/routes';

/**
 * POST /api/maintenance/routes/optimize
 *
 * On-the-fly day route builder for the in-house HDMS crew. Given a set of open
 * work orders, geocode their property addresses and return the least-driving
 * stop order (Google Directions waypoint optimization), a map polyline, and
 * drive-time totals — so a tech can run an efficient loop and hand off to
 * turn-by-turn navigation. Nothing is persisted.
 *
 * Body: { workOrderIds: string[] }
 * Reuses geocodeOne (lib/inspection-geocode) and optimizeRouteWithGoogle
 * (lib/route-directions); addresses are geocoded per-request (deduped by
 * address so WOs at the same property geocode once).
 */

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

const DEFAULT_SERVICE_MINUTES = 45;

export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Geocoding is not configured (GOOGLE_PLACES_API_KEY missing).' },
      { status: 500 },
    );
  }

  let body: { workOrderIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ids = Array.isArray(body.workOrderIds)
    ? body.workOrderIds.filter((x): x is string => typeof x === 'string')
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one work order.' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: wos, error } = await supabase
    .from('work_orders')
    .select('id, wo_number, description, property_name, unit_name, property_address, property_id')
    .in('id', ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Geocode each distinct address once (WOs at the same property share coords).
  const geoCache = new Map<string, { lat: number; lng: number } | null>();
  const excluded: { work_order_id: string; reason: string }[] = [];
  const stops: ProposedStop[] = [];

  await Promise.all(
    (wos ?? []).map(async (wo) => {
      const address = (wo.property_address ?? '').trim();
      if (!address) {
        excluded.push({ work_order_id: wo.id, reason: 'no address' });
        return;
      }
      if (!geoCache.has(address)) {
        try {
          const geo = await geocodeOne(address, apiKey);
          geoCache.set(address, geo ? { lat: geo.lat, lng: geo.lng } : null);
        } catch {
          geoCache.set(address, null);
        }
      }
      const coords = geoCache.get(address) ?? null;
      if (!coords) {
        excluded.push({ work_order_id: wo.id, reason: 'could not geocode' });
        return;
      }
      // Carry the work order id in `inspection_id` — optimizeRouteWithGoogle is
      // shape-agnostic and just reorders these, spreading the rest through.
      stops.push({
        inspection_id: wo.id,
        property_id: wo.property_id ?? '',
        stop_order: 0,
        drive_minutes_from_prev: 0,
        drive_meters_from_prev: 0,
        service_minutes: DEFAULT_SERVICE_MINUTES,
        lat: coords.lat,
        lng: coords.lng,
        address,
        unit_name: wo.unit_name ?? null,
        city: address.split(',')[1]?.trim() ?? '',
      });
    }),
  );

  if (stops.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected work orders could be geocoded.', excluded },
      { status: 422 },
    );
  }

  const result = await optimizeRouteWithGoogle(stops);

  const woById = new Map((wos ?? []).map((w) => [w.id, w]));
  const orderedStops: RouteStopOut[] = result.stops.map((s, i) => {
    const wo = woById.get(s.inspection_id);
    return {
      work_order_id: s.inspection_id,
      wo_number: wo?.wo_number ?? null,
      description: wo?.description ?? '',
      property_name: wo?.property_name ?? '',
      unit_name: s.unit_name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      stop_order: i + 1,
      drive_minutes_from_prev: s.drive_minutes_from_prev,
      service_minutes: s.service_minutes,
    };
  });

  const totalService = orderedStops.reduce((n, s) => n + s.service_minutes, 0);

  return NextResponse.json({
    stops: orderedStops,
    polyline: result.polyline,
    total_drive_minutes: result.total_drive_minutes,
    total_service_minutes: totalService,
    source: result.source,
    excluded,
  });
}
