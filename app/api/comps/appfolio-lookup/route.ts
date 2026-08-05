import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { searchAppFolioProperties } from '@/lib/appfolio';

/**
 * GET /api/comps/appfolio-lookup?address=123+Main
 *
 * Search AppFolio properties by address.
 * Returns matched properties with unit details for auto-filling the analysis form.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const address = request.nextUrl.searchParams.get('address');
    if (!address || address.trim().length < 3) {
      return NextResponse.json(
        { error: 'Address query must be at least 3 characters' },
        { status: 400 }
      );
    }

    const results = await searchAppFolioProperties(address.trim());

    return NextResponse.json({
      properties: results,
      count: results.length,
    });
  } catch (error) {
    console.error('[API] AppFolio lookup error:', error);
    const message = error instanceof Error ? error.message : 'Lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
