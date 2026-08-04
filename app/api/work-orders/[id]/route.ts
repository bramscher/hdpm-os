import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getWorkOrderById } from '@/lib/work-orders';

/**
 * GET /api/work-orders/:id
 *
 * Fetch a single work order by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const workOrder = await getWorkOrderById(id);

    if (!workOrder) {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    }

    return NextResponse.json({ workOrder });
  } catch (error) {
    console.error('Get work order error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch work order';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
