import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isCompanyEmail } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { registerDevice } from '@/lib/field-app/server';
import { FIELD_TECHS } from '@/lib/field-time/server';

export const dynamic = 'force-dynamic';

// HDPM Field sign-in. The app opens this in a web sign-in sheet; the proxy sends a signed-out
// browser through Microsoft sign-in and back here. A field tech (or an admin, for testing)
// gets a device token handed back to the app through its URL scheme.
const back = (params: Record<string, string>) =>
  NextResponse.redirect(`hdpmfield://signed-in?${new URLSearchParams(params)}`, { headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!isCompanyEmail(email)) return back({ error: 'Sign in with your High Desert Microsoft account.' });
  const { data: staff } = await getSupabaseAdmin().from('staff').select('person,access_role').eq('active', true).ilike('email', email!).maybeSingle();
  if (!staff || !(FIELD_TECHS.includes(staff.person) || staff.access_role === 'admin'))
    return back({ error: 'HDPM Field is for field techs. Ask Craig to add you.' });
  const label = (new URL(request.url).searchParams.get('device') || request.headers.get('user-agent') || '').slice(0, 80);
  try {
    return back({ token: await registerDevice(staff.person, email!, label) });
  } catch {
    return back({ error: 'Could not register this phone. Try again.' });
  }
}
