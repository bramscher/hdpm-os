import { requireEstimateAuthor } from '@/lib/require-estimate-author';
import { NextRequest, NextResponse } from 'next/server';
import { getWorkOrderById } from '@/lib/work-orders';
import { extractWorkOrderItems } from '@/lib/work-order-extraction';
import { listPriceBookItems } from '@/lib/turn-estimator/price-book';
import { workOrderDraft } from '@/lib/turn-estimator/work-order-draft';

export const maxDuration = 120;

/** Build editable scope using the same work-order description/extractor as invoices. */
export async function POST(request: NextRequest) {
  const guard = await requireEstimateAuthor();
  if (!guard.ok) return guard.response;
  let body: { work_order_id?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (typeof body.work_order_id !== 'string' || !body.work_order_id) return NextResponse.json({ error: 'work_order_id is required' }, { status: 400 });
  try {
    const wo = await getWorkOrderById(body.work_order_id);
    if (!wo) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    const items = await listPriceBookItems();
    let extracted = { laborDescription: wo.description || '', materials: [] } as Awaited<ReturnType<typeof extractWorkOrderItems>>;
    let fallback = false;
    if (wo.description?.trim().length > 10) {
      try { extracted = await extractWorkOrderItems(wo.description); }
      catch { fallback = true; }
    }
    const draft = workOrderDraft(wo.description || '', extracted, items);
    if (fallback) draft.unmapped_notes.unshift('Automatic separation was unavailable. The full work-order text is preserved on a labor line; separate materials manually.');
    return NextResponse.json({ draft });
  } catch (err) {
    console.error('Estimate draft failed:', err);
    return NextResponse.json({ error: 'Could not load the work order and price book. Please retry.' }, { status: 500 });
  }
}
