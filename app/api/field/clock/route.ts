import { NextResponse } from 'next/server';
import { clockBody, clockSnapshot } from '@/lib/field-app/model';
import { deviceFailure, deviceFromRequest } from '@/lib/field-app/server';
import { clockCommand, contextFor, getClock } from '@/lib/timekeeping/server';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };

// HDPM Field's clock. A thin wrapper over Timekeeping's clock for the phone's person:
// Timekeeping stays the only timecard. Bearer device token (public prefix in proxy.ts).
export async function GET(request: Request) {
  try {
    const device = await deviceFromRequest(request);
    const ctx = await contextFor(device.email);
    return NextResponse.json(clockSnapshot(await getClock(ctx.employee.id)), { headers: noStore });
  } catch (e) {
    return deviceFailure(e);
  }
}

export async function POST(request: Request) {
  try {
    const device = await deviceFromRequest(request);
    const ctx = await contextFor(device.email);
    await clockCommand(ctx, clockBody(await request.json().catch(() => null)));
    return NextResponse.json(clockSnapshot(await getClock(ctx.employee.id)), { headers: noStore });
  } catch (e) {
    return deviceFailure(e);
  }
}
