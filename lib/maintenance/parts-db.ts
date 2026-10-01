/**
 * Parts orders — server reads and writes. Logging an order also moves the work
 * order to WAITING_ON / PARTS through the single workflow write path.
 */
import { getSupabaseAdmin } from '@/lib/supabase';
import { updateWorkOrderWorkflow, WorkflowValidationError } from './workflow-db';
import {
  OPEN_PARTS_STATUSES, PARTS_EVENT_KINDS, PARTS_STATUSES, countContacts, isUuid, validateExpected, validatePartsOrderInput, validateTrackingUrl,
  type PartsEventKind, type PartsOrder, type PartsOrderEvent, type PartsOrderView, type PartsStatus, type Supplier,
} from './parts';

export type { PartsOrderView };
export class NotFoundError extends Error {}
const SUPPLIER_COLUMNS = 'id,name,phone,email,account_number,pro_desk_notes';
/** Tables not created yet (migration pending): PostgREST reports a missing relation. */
const missingTable = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205');

export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await getSupabaseAdmin().from('supplier').select(SUPPLIER_COLUMNS).eq('active', true).order('name');
  if (error) throw new Error(error.message);
  return (data || []) as Supplier[];
}


async function withDetail(orders: PartsOrder[]): Promise<PartsOrderView[]> {
  if (!orders.length) return [];
  const db = getSupabaseAdmin();
  const [suppliers, events] = await Promise.all([
    db.from('supplier').select(SUPPLIER_COLUMNS).in('id', [...new Set(orders.map(o => o.supplier_id))]),
    db.from('parts_order_event').select('*').in('order_id', orders.map(o => o.id)).order('at', { ascending: false }),
  ]);
  if (suppliers.error) throw new Error(suppliers.error.message);
  if (events.error) throw new Error(events.error.message);
  return orders.map(o => {
    const list = (events.data || []).filter(e => e.order_id === o.id) as PartsOrderEvent[];
    return { ...o, supplier: (suppliers.data || []).find(s => s.id === o.supplier_id) as Supplier, events: list,
      minutes: list.reduce((n, e) => n + (e.minutes_spent || 0), 0), contacts: countContacts(list) };
  });
}

export async function listPartsOrders(workOrderId: string): Promise<PartsOrderView[]> {
  const { data, error } = await getSupabaseAdmin().from('parts_order').select('*').eq('work_order_id', workOrderId).order('ordered_at', { ascending: false });
  if (error) throw new Error(error.message);
  return withDetail((data || []) as PartsOrder[]);
}

/** Open orders for the given work orders, for the chase board. Empty until the migration is applied. */
export async function loadOpenPartsForFollowups(workOrderIds: string[]): Promise<PartsOrderView[]> {
  const db = getSupabaseAdmin(); const orders: PartsOrder[] = [];
  for (let i = 0; i < workOrderIds.length; i += 150) {
    const { data, error } = await db.from('parts_order').select('*').in('work_order_id', workOrderIds.slice(i, i + 150)).in('status', OPEN_PARTS_STATUSES);
    if (missingTable(error)) { console.warn('[parts] parts_order table missing; apply 20261001_parts_orders.sql'); return []; }
    if (error) throw new Error(`Parts orders unavailable: ${error.message}`);
    orders.push(...((data || []) as PartsOrder[]));
  }
  return withDetail(orders);
}

async function insertEvent(orderId: string, actor: string, kind: PartsEventKind, note: string, minutes: number | null = null) {
  const { error } = await getSupabaseAdmin().from('parts_order_event').insert({ order_id: orderId, kind, note, minutes_spent: minutes, actor });
  if (error) throw new Error(error.message);
}

/** Records the order, then marks the work order WAITING_ON / PARTS. A blocked stage move is returned as a warning; the order stays. */
export async function createPartsOrder(actor: string, workOrderId: unknown, input: Record<string, unknown>) {
  if (!isUuid(workOrderId)) throw new NotFoundError('Work order not found');
  const v = validatePartsOrderInput(input);
  const db = getSupabaseAdmin();
  const { data: wo, error: woError } = await db.from('work_orders').select('id,stage,waiting_reason').eq('id', workOrderId).maybeSingle();
  if (woError) throw new Error(woError.message);
  if (!wo) throw new NotFoundError('Work order not found');

  let supplierId = v.supplier_id;
  if (supplierId) {
    const { data, error } = await db.from('supplier').select('id').eq('id', supplierId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Choose a supplier from the list');
  } else {
    const { data, error } = await db.from('supplier').upsert({ name: v.supplier_name }, { onConflict: 'org_id,name' }).select('id').single();
    if (error) throw new Error(error.message);
    supplierId = data.id;
  }
  const { data: order, error } = await db.from('parts_order').insert({
    work_order_id: workOrderId, supplier_id: supplierId, item: v.item, order_number: v.order_number, po_number: v.po_number,
    ordered_at: v.ordered_at, expected_at: v.expected_at, tracking_url: v.tracking_url, notes: v.notes, created_by: actor,
  }).select('*').single();
  if (error) throw new Error(error.message);
  await insertEvent(order.id, actor, 'status', `Ordered${v.expected_at ? `; expected ${v.expected_at}` : ''}`);

  let warning: string | null = null;
  if (!(wo.stage === 'WAITING_ON' && wo.waiting_reason === 'PARTS')) {
    try {
      await updateWorkOrderWorkflow(workOrderId, wo.stage === 'WAITING_ON' ? { waiting_reason: 'PARTS' } : { stage: 'WAITING_ON', waiting_reason: 'PARTS' }, actor);
    } catch (e) {
      if (!(e instanceof WorkflowValidationError)) throw e;
      warning = `Order saved, but the work order stage wasn't changed: ${e.errors.join('; ')}`;
    }
  }
  return { order: order as PartsOrder, warning };
}

async function loadOrder(id: unknown) {
  if (!isUuid(id)) throw new NotFoundError('Parts order not found');
  const { data, error } = await getSupabaseAdmin().from('parts_order').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new NotFoundError('Parts order not found');
  return data as PartsOrder;
}

/** Status, expected date, tracking, or notes. Each change is written to the order's history. */
export async function updatePartsOrder(actor: string, id: unknown, input: Record<string, unknown>) {
  const o = await loadOrder(id);
  const patch: Partial<PartsOrder> = {}; const changes: string[] = [];
  if ('status' in input && input.status !== o.status) {
    if (!PARTS_STATUSES.includes(input.status as PartsStatus)) throw new Error('Choose a valid order status');
    patch.status = input.status as PartsStatus; changes.push(`Status ${o.status} → ${patch.status}`);
    if (patch.status === 'delivered' && !o.delivered_at) patch.delivered_at = new Date().toISOString();
  }
  if ('expected_at' in input) {
    const expected = validateExpected(input.expected_at, o.ordered_at);
    if (expected !== o.expected_at) { patch.expected_at = expected; changes.push(`Expected ${expected || 'cleared'}`); }
  }
  if ('tracking_url' in input) {
    const url = validateTrackingUrl(input.tracking_url);
    if (url !== o.tracking_url) { patch.tracking_url = url; changes.push(url ? 'Tracking link updated' : 'Tracking link removed'); }
  }
  if ('notes' in input) {
    if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('Notes must be under 2,000 characters');
    if (input.notes.trim() !== o.notes) { patch.notes = input.notes.trim(); changes.push('Notes updated'); }
  }
  if (!changes.length) return { order: o };
  const { data, error } = await getSupabaseAdmin().from('parts_order').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', o.id).select('*').single();
  if (error) throw new Error(error.message);
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) : '';
  await insertEvent(o.id, actor, 'status', [changes.join(' · '), note].filter(Boolean).join(' — '));
  return { order: data as PartsOrder };
}

/** A call, email, text, or note against an order. Minutes spent are how we learn what a chase costs. */
export async function logPartsContact(actor: string, id: unknown, input: Record<string, unknown>) {
  const o = await loadOrder(id);
  const kind = input.kind as PartsEventKind;
  if (!PARTS_EVENT_KINDS.includes(kind) || kind === 'status') throw new Error('Choose call, email, text, or note');
  const minutes = input.minutes === null || input.minutes === undefined || input.minutes === '' ? null : Number(input.minutes);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 480)) throw new Error('Minutes must be a whole number from 0 to 480');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!note || note.length > 2000) throw new Error('Add a note under 2,000 characters about what you learned');
  await insertEvent(o.id, actor, kind, note, minutes);
  if (kind !== 'note') {
    const { error } = await getSupabaseAdmin().from('parts_order').update({ last_contact_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', o.id);
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}
