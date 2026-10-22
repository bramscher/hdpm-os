import { NextResponse } from 'next/server';
import { deviceFailure, deviceFromRequest, DeviceError, uploadPoints } from '@/lib/field-app/server';

export const dynamic = 'force-dynamic';

// HDPM Field's location upload: { points: [{ t, lat, lng, acc }] } → { stored }.
// Only points inside clocked-in time (breaks excluded) are kept. Bearer device token.
export async function POST(request: Request) {
  try {
    const device = await deviceFromRequest(request);
    const raw = await request.text();
    if (raw.length > 200_000) throw new DeviceError('Send fewer points at a time', 413);
    const body = JSON.parse(raw || '{}');
    return NextResponse.json(await uploadPoints(device, body?.points), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return deviceFailure(e instanceof SyntaxError ? new DeviceError('Invalid request') : e);
  }
}
