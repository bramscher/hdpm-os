import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getWorkOrders, getWorkOrderStats } from '@/lib/work-orders';
import type { WorkOrderFilter } from '@/lib/work-orders';

/**
 * GET /api/work-orders
 *
 * Fetch filtered work orders + stats.
 * Query params: status, priority, search, date_from, date_to
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);

    const filter: WorkOrderFilter = {};

    const status = searchParams.get('status');
    if (status) {
      filter.status = status.split(',') as ('open' | 'closed' | 'done')[];
    }

    const appfolioStatus = searchParams.get('appfolio_status');
    if (appfolioStatus) {
      filter.appfolio_status = appfolioStatus.split(',');
    }

    const priority = searchParams.get('priority');
    if (priority) {
      filter.priority = priority.split(',');
    }

    const vendorId = searchParams.get('vendor_id');
    if (vendorId) {
      filter.vendor_id = vendorId;
    }

    const search = searchParams.get('search');
    if (search) {
      filter.search = search;
    }

    const dateFrom = searchParams.get('date_from');
    if (dateFrom) filter.date_from = dateFrom;

    const dateTo = searchParams.get('date_to');
    if (dateTo) filter.date_to = dateTo;

    const [workOrders, stats] = await Promise.all([
      getWorkOrders(filter),
      getWorkOrderStats(filter),
    ]);

    return NextResponse.json({ workOrders, stats });
  } catch (error) {
    console.error('Get work orders error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch work orders';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
