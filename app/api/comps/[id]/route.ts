import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCompById, updateComp, deleteComp } from '@/lib/comps';

/**
 * GET /api/comps/:id
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const comp = await getCompById(id);
    if (!comp) {
      return NextResponse.json({ error: 'Comp not found' }, { status: 404 });
    }

    return NextResponse.json({ comp });
  } catch (error) {
    console.error('Get comp error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch comp';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/comps/:id
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();

    // Check comp exists
    const existing = await getCompById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Comp not found' }, { status: 404 });
    }

    const comp = await updateComp(id, body);
    return NextResponse.json({ comp });
  } catch (error) {
    console.error('Update comp error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update comp';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/comps/:id
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const existing = await getCompById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Comp not found' }, { status: 404 });
    }

    await deleteComp(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete comp error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete comp';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
