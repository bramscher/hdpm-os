import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  saveListing,
  listSavedListings,
  deleteSavedListing,
  markListingPosted,
  renewListing,
  archiveListing,
} from '@/lib/saved-listings';

export async function GET() {
  try {
    const listings = await listSavedListings();
    return NextResponse.json({ listings });
  } catch (err) {
    console.error('[saved-listings] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch listings' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Attribute to the signed-in user rather than trusting the client value.
    const session = await auth();
    if (session?.user?.email) body.created_by = session.user.email;
    const listing = await saveListing(body);
    return NextResponse.json({ listing });
  } catch (err) {
    console.error('[saved-listings] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save listing' },
      { status: 500 }
    );
  }
}

/**
 * PATCH — posting lifecycle actions.
 *   { id, action: 'posted', craigslist_url }  — listing is live; record the URL
 *   { id, action: 'renewed' }                 — staff clicked renew on Craigslist
 *   { id, action: 'archived', reason? }       — post down (leased/expired/pulled)
 */
export async function PATCH(req: NextRequest) {
  try {
    const { id, action, craigslist_url, reason } = await req.json();
    if (!id || !action) {
      return NextResponse.json({ error: 'id and action required' }, { status: 400 });
    }

    if (action === 'posted') {
      if (!craigslist_url || !/^https?:\/\//.test(craigslist_url)) {
        return NextResponse.json(
          { error: 'A valid craigslist_url is required to mark a listing posted' },
          { status: 400 }
        );
      }
      const session = await auth();
      const listing = await markListingPosted(
        id,
        craigslist_url,
        session?.user?.email ?? 'staff@highdesertpm.com'
      );
      return NextResponse.json({ listing });
    }

    if (action === 'renewed') {
      const listing = await renewListing(id);
      return NextResponse.json({ listing });
    }

    if (action === 'archived') {
      const listing = await archiveListing(id, reason || 'archived');
      return NextResponse.json({ listing });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('[saved-listings] PATCH error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update listing' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    await deleteSavedListing(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[saved-listings] DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete listing' },
      { status: 500 }
    );
  }
}
