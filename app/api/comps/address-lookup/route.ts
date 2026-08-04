import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { lookupAddress } from '@/lib/address-lookup';

/**
 * GET /api/comps/address-lookup?address=123+Main+St+Bend+OR
 *
 * Validates an address with Google Geocoding and enriches
 * with property details from RentCast.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const address = request.nextUrl.searchParams.get('address');
    if (!address || address.trim().length < 5) {
      return NextResponse.json(
        { error: 'Address must be at least 5 characters' },
        { status: 400 }
      );
    }

    const result = await lookupAddress(address.trim());

    if (!result) {
      return NextResponse.json(
        { error: 'Could not find that address. Check the spelling and try again.' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Address lookup error:', error);
    const message = error instanceof Error ? error.message : 'Address lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
