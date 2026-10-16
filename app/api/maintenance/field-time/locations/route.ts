import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { dailyBillingActor } from '@/lib/daily-billing/server';
import { geocodeOne } from '@/lib/inspection-geocode';
import { RADIUS_BY_KIND } from '@/lib/field-time/config';
import type { PlaceKind } from '@/lib/field-time/model';
import { loadLocations, rematchRecent, stopCentre, type Source } from '@/lib/field-time/server';

const noStore = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  const guard = await requireCompanySession(); if (!guard.ok) return guard.response;
  try { return NextResponse.json(await loadLocations(await dailyBillingActor(guard.email)), { headers: noStore }); } catch (e) { return failure(e); }
}

const num = (v: unknown) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function POST(request: NextRequest) {
  const guard = await requireCompanySession(); if (!guard.ok) return guard.response;
  try {
    const actor = await dailyBillingActor(guard.email);
    const body = await request.json();
    if (body.op === 'rematch') return NextResponse.json(await rematchRecent(actor), { headers: noStore });
    if (body.op === 'place_from_stop') {
      const source: Source = body.source === 'device' ? 'device' : 'sample';
      return NextResponse.json(await stopCentre(actor, String(body.technician || ''), String(body.date || ''), source, String(body.segment_id || '')), { headers: noStore });
    }
    let req: Record<string, unknown>;
    if (body.op === 'place_save') {
      if (!actor.admin) throw new Error('FORBIDDEN: only an admin can change stop locations');
      const kind = (['store', 'dump', 'shop', 'other'].includes(body.kind) ? body.kind : 'store') as PlaceKind;
      let latitude = num(body.latitude), longitude = num(body.longitude);
      // Blank coordinates: look the address up. Big-box pins can land on the road, so pasted coordinates win.
      if (latitude == null || longitude == null) {
        const hit = String(body.address || '').trim() ? await geocodeOne(String(body.address), process.env.GOOGLE_PLACES_API_KEY || '') : null;
        latitude = hit?.lat ?? null; longitude = hit?.lng ?? null;
      }
      req = {
        op: 'place_save', id: body.id || null, version: body.version ?? null, kind, name: body.name, address: body.address || '', supplier_id: body.supplier_id || null,
        latitude, longitude, radius_m: num(body.radius_m) ?? RADIUS_BY_KIND[kind], active: body.active !== false,
      };
    } else if (body.op === 'supplier_save') {
      req = { op: 'supplier_save', id: body.id || null, version: body.version ?? null, name: body.name, phone: body.phone || '', email: body.email || '', account_number: body.account_number || '', pro_desk_notes: body.pro_desk_notes || '', active: body.active !== false };
    } else throw new Error('Unknown locations action');
    const { error } = await getSupabaseAdmin().rpc('field_time_apply', { actor: guard.email, request: req });
    if (error) throw new Error(error.message);
    return NextResponse.json(await loadLocations(actor), { headers: noStore });
  } catch (e) { return failure(e); }
}

function failure(e: unknown) {
  const message = e instanceof Error ? e.message : 'Locations could not load';
  return NextResponse.json({ error: message.replace(/^(FORBIDDEN|CONFLICT): /, '') }, { status: message.includes('FORBIDDEN') ? 403 : message.includes('CONFLICT') ? 409 : 400 });
}
