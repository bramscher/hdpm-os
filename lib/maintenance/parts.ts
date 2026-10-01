/**
 * Parts orders — pure and client-safe (no Supabase imports).
 * When a supplier order needs a chase, what to say, and input validation.
 */
import { businessDaysBetween } from './business-days';

export const PARTS_STATUSES = ['ordered', 'shipped', 'delivered', 'installed', 'issue', 'cancelled'] as const;
export type PartsStatus = (typeof PARTS_STATUSES)[number];
export const OPEN_PARTS_STATUSES: PartsStatus[] = ['ordered', 'shipped', 'delivered', 'issue'];
export const PARTS_EVENT_KINDS = ['call', 'email', 'text', 'status', 'note'] as const;
export type PartsEventKind = (typeof PARTS_EVENT_KINDS)[number];
export const CONTACT_KINDS: PartsEventKind[] = ['call', 'email', 'text'];
/** Contacts after which an order stops being a routine chase and goes to Needs help. */
export const HELP_CONTACTS = 3;

export type Supplier = { id: string; name: string; phone: string | null; email: string | null; account_number: string | null; pro_desk_notes: string };
export type PartsOrder = {
  id: string; work_order_id: string; supplier_id: string; item: string; order_number: string | null; po_number: string | null;
  ordered_at: string; expected_at: string | null; delivered_at: string | null; status: PartsStatus;
  tracking_url: string | null; last_contact_at: string | null; notes: string; created_by: string; created_at: string; updated_at: string;
};
export type PartsOrderEvent = { id: number; order_id: string; kind: PartsEventKind; minutes_spent: number | null; actor: string; note: string; at: string };
export type PartsOrderView = PartsOrder & { supplier: Supplier; events: PartsOrderEvent[]; minutes: number; contacts: number };
export type ChaseDue = { due: boolean; dueAt: string | null; reason: string };

const ptDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`);
const short = (s: string) => day(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** First calendar day on which more than `n` business days have passed since `start`. */
export function firstDayPast(start: string, n: number): string {
  const d = day(start);
  while (businessDaysBetween(day(start), d) <= n) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * When an order needs a chase:
 * - ordered/shipped with an expected date: more than 1 business day past it
 * - ordered/shipped with no expected date: more than 5 business days since ordering
 * - delivered but the work order has no service date: more than 2 business days since delivery
 * - issue: always
 */
export function partsChaseDue(o: Pick<PartsOrder, 'status' | 'ordered_at' | 'expected_at' | 'delivered_at'>, wo: { scheduled_start?: string | null }, now = new Date()): ChaseDue {
  const today = ptDate(now);
  const at = (dueAt: string, reason: string, pending: string): ChaseDue => ({ due: dueAt <= today, dueAt, reason: dueAt <= today ? reason : pending });
  switch (o.status) {
    case 'issue': return { due: true, dueAt: today, reason: 'Order has a problem' };
    case 'installed': case 'cancelled': return { due: false, dueAt: null, reason: o.status === 'installed' ? 'Installed' : 'Cancelled' };
    case 'delivered': {
      if (wo.scheduled_start) return { due: false, dueAt: null, reason: 'Delivered; install scheduled' };
      const delivered = o.delivered_at ? ptDate(new Date(o.delivered_at)) : today;
      return at(firstDayPast(delivered, 2), `Delivered ${short(delivered)} and the install isn't scheduled`, `Delivered ${short(delivered)}`);
    }
    default:
      return o.expected_at
        ? at(firstDayPast(o.expected_at, 1), `Expected ${short(o.expected_at)} and not delivered`, `Expected ${short(o.expected_at)}`)
        : at(firstDayPast(o.ordered_at, 5), `Ordered ${short(o.ordered_at)} with no delivery date`, `Ordered ${short(o.ordered_at)}`);
  }
}

export const countContacts = (events: Pick<PartsOrderEvent, 'kind'>[]) => events.filter(e => CONTACT_KINDS.includes(e.kind)).length;
export const needsHelp = (o: Pick<PartsOrder, 'status'>, contacts: number) => o.status === 'issue' || contacts >= HELP_CONTACTS;

export type PartsOrderInput = {
  supplier_id: string | null; supplier_name: string | null; item: string; order_number: string | null; po_number: string | null;
  ordered_at: string; expected_at: string | null; tracking_url: string | null; notes: string;
};
const text = (v: unknown, max: number, label: string) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw new Error(`${label} must be under ${max} characters`);
  return s || null;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export function validateExpected(expected: unknown, orderedAt: string) {
  if (expected === null || expected === '' || expected === undefined) return null;
  if (typeof expected !== 'string' || !ISO_DAY.test(expected)) throw new Error('Enter the expected date as a date');
  if (expected < orderedAt) throw new Error('Expected date can’t be before the order date');
  return expected;
}
export function validateTrackingUrl(v: unknown) {
  const url = text(v, 1000, 'Tracking link');
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error('Tracking link must start with http:// or https://');
  return url;
}

export function validatePartsOrderInput(input: Record<string, unknown>, now = new Date()): PartsOrderInput {
  const supplier_id = isUuid(input.supplier_id) ? input.supplier_id : null;
  const supplier_name = supplier_id ? null : text(input.supplier_name, 120, 'Supplier name');
  if (!supplier_id && !supplier_name) throw new Error('Choose a supplier or enter a new one');
  const item = text(input.item, 300, 'Item');
  if (!item) throw new Error('Describe the part that was ordered');
  const ordered_at = typeof input.ordered_at === 'string' ? input.ordered_at : '';
  if (!ISO_DAY.test(ordered_at)) throw new Error('Enter the order date');
  if (ordered_at > ptDate(now)) throw new Error('Order date can’t be in the future');
  return {
    supplier_id, supplier_name, item, ordered_at,
    order_number: text(input.order_number, 80, 'Order number'), po_number: text(input.po_number, 80, 'PO number'),
    expected_at: validateExpected(input.expected_at, ordered_at), tracking_url: validateTrackingUrl(input.tracking_url),
    notes: text(input.notes, 2000, 'Notes') || '',
  };
}

/** Email and text to a supplier about one order. Never states dollar amounts. */
export function buildSupplierDraft(o: Pick<PartsOrder, 'item' | 'order_number' | 'po_number' | 'ordered_at' | 'expected_at' | 'status'>, supplier: Pick<Supplier, 'name' | 'account_number'>,
  wo: { woNumber?: string; property: string; unit?: string }) {
  const ref = [o.order_number && `order #${o.order_number}`, o.po_number && `PO ${o.po_number}`].filter(Boolean).join(', ') || `the order placed ${short(o.ordered_at)}`;
  const where = `${wo.property}${wo.unit ? `, Unit ${wo.unit}` : ''}`;
  const ask = o.status === 'issue' ? 'Can you tell us where this stands and what is needed to resolve it?'
    : o.expected_at ? `It was expected ${short(o.expected_at)}. Can you confirm the current delivery date and any tracking?`
    : 'Can you confirm the delivery date and any tracking?';
  return {
    subject: `Order status — ${o.item}${o.order_number ? ` (#${o.order_number})` : ''}`,
    emailBody: `Hello ${supplier.name},\n\nWe're checking on ${ref} for ${o.item}${supplier.account_number ? ` on account ${supplier.account_number}` : ''}, ordered ${short(o.ordered_at)} for ${where}${wo.woNumber ? ` (our WO ${wo.woNumber})` : ''}.\n\n${ask}\n\nThank you,\nHigh Desert Property Management`,
    smsBody: `Hi, this is High Desert Property Management checking on ${ref} for ${o.item}. ${ask} Thank you.`,
  };
}
