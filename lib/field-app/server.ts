import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { FIELD_TECHS, rebuildDeviceDay } from '@/lib/field-time/server';
import { localDate } from '@/lib/timekeeping/model';
import { TimeError } from '@/lib/timekeeping/server';
import { acceptPoints, hashDeviceToken, newDeviceToken, pointDates, POINT_RETENTION_DAYS, REBUILD_EVERY_MS } from './model';
import { loadWorkTime } from './shifts';

export interface Device { id: string; person: string; email: string; label: string }

export class DeviceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** JSON error for the app: { error } with the status it acts on (401 signs the phone out, 409 reloads the clock). */
export function deviceFailure(e: unknown) {
  const status = e instanceof DeviceError || e instanceof TimeError ? e.status
    : e instanceof Error && e.message.includes('CONFLICT') ? 409 : e instanceof Error && e.message.includes('FORBIDDEN') ? 403 : 400;
  const message = e instanceof Error ? e.message : 'Something went wrong';
  if (status >= 500 || !(e instanceof Error)) console.error('[field-app]', e);
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

/** Issue a token for a newly signed-in phone. Only the hash is stored; the token goes once to the app. */
export async function registerDevice(person: string, email: string, label: string): Promise<string> {
  const token = newDeviceToken();
  const { error } = await getSupabaseAdmin().from('field_device').insert({ person, email: email.toLowerCase(), token_hash: hashDeviceToken(token), label: label.slice(0, 80) });
  if (error) throw new DeviceError(`Could not register this phone: ${error.message}`, 500);
  return token;
}

/** The phone behind a request's bearer token. Unknown or revoked tokens are 401, so the app signs out. */
export async function deviceFromRequest(request: Request): Promise<Device> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 200) throw new DeviceError('Sign in again', 401);
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('field_device').select('id,person,email,label,revoked_at').eq('token_hash', hashDeviceToken(token)).maybeSingle();
  if (error) throw new DeviceError(`field_device: ${error.message}`, 500);
  if (!data || data.revoked_at) throw new DeviceError('Sign in again', 401);
  // The person must still be active staff (a departed tech's phone stops working).
  const { data: staff } = await db.from('staff').select('person').eq('person', data.person).eq('active', true).maybeSingle();
  if (!staff) throw new DeviceError('Sign in again', 401);
  await db.from('field_device').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  return { id: data.id, person: data.person, email: data.email, label: data.label };
}

/** Store the points recorded while clocked in, then rebuild the affected device days (throttled). */
export async function uploadPoints(device: Device, input: unknown, now = Date.now()) {
  const list = Array.isArray(input) ? input : null;
  const times = (list || []).map(p => Number((p as { t?: unknown })?.t)).filter(Number.isFinite);
  const from = times.length ? localDate(new Date(Math.min(...times) - 86_400_000)) : localDate(new Date(now));
  const to = times.length ? localDate(new Date(Math.max(...times))) : from;
  const time = await loadWorkTime(device.person, from, to, now);
  const { points, rejected } = acceptPoints(input, time, now);
  if (points.length) {
    const rows = points.map(p => ({ device_id: device.id, person: device.person, t: new Date(p.t).toISOString(), lat: p.lat, lng: p.lng, acc: p.acc }));
    const { error } = await getSupabaseAdmin().from('field_location_point').upsert(rows, { onConflict: 'device_id,t', ignoreDuplicates: true });
    if (error) throw new DeviceError(`Could not save points: ${error.message}`, 500);
  }
  // Field days exist for the pilot techs only; an admin's test phone stores points without a day.
  // Clocked out, rebuild now so the day's last points count; while working, at most every few minutes.
  // A failed rebuild never fails the upload (the app would re-send forever); the next one catches up.
  const rebuilt: string[] = [];
  if (FIELD_TECHS.includes(device.person)) {
    for (const date of pointDates(points)) {
      if (time.open && !(await rebuildDue(device.person, date, now))) continue;
      try {
        await rebuildDeviceDay(device.email, device.person, date);
        rebuilt.push(date);
      } catch (e) {
        console.error('[field-app] rebuild failed', device.person, date, e);
      }
    }
  }
  // `stored` counts points accepted (duplicates included), so the app drops them from its queue.
  return { stored: points.length + rejected, accepted: points.length, rejected, rebuilt };
}

async function rebuildDue(person: string, date: string, now: number) {
  const { data } = await getSupabaseAdmin().from('field_day').select('built_at').eq('technician', person).eq('work_date', date).eq('source', 'device').maybeSingle();
  return !data?.built_at || now - Date.parse(data.built_at) >= REBUILD_EVERY_MS;
}

/** Delete raw points past retention. Returns how many went. */
export async function purgeOldPoints(now = Date.now()) {
  const cutoff = new Date(now - POINT_RETENTION_DAYS * 86_400_000).toISOString();
  const { count, error } = await getSupabaseAdmin().from('field_location_point').delete({ count: 'exact' }).lt('t', cutoff);
  if (error) throw new Error(`field_location_point purge: ${error.message}`);
  return count ?? 0;
}
