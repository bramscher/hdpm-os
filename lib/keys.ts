/**
 * Key Manager — state machine + Supabase data access.
 *
 * Key numbers are permanent identities (key_slot) recycled across properties;
 * every tenure is a key_assignment row and every change appends a key_event.
 * "Never overwrite" is enforced three ways: canTransition() rejects illegal
 * moves, applyTransition() re-checks current status, and the partial unique
 * index idx_key_assignment_one_active is the race-proof DB backstop.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type {
  KeyAssignment,
  KeyCopy,
  KeyDetail,
  KeyEvent,
  KeyListRow,
  KeySlot,
  KeySlotStatus,
  KeyStats,
  KeyTransitionAction,
  KeyType,
  KeyTypeTemplateEntry,
} from '@/types/keys';

// ============================================
// State machine (pure — unit tested)
// ============================================

const TRANSITIONS: Record<KeySlotStatus, Partial<Record<KeyTransitionAction, KeySlotStatus>>> = {
  open: { assign: 'assigned', retire: 'retired' },
  assigned: { mark_vacant: 'vacant', release: 'open', retire: 'retired' },
  vacant: { reissue: 'assigned', release: 'open', retire: 'retired' },
  retired: { reinstate: 'open' },
};

export function canTransition(from: KeySlotStatus, action: KeyTransitionAction): boolean {
  return TRANSITIONS[from]?.[action] !== undefined;
}

export function nextStatus(from: KeySlotStatus, action: KeyTransitionAction): KeySlotStatus {
  const to = TRANSITIONS[from]?.[action];
  if (!to) {
    throw new Error(`Illegal key transition: ${action} from '${from}'`);
  }
  return to;
}

/**
 * Default issue: 4 copies of the main key — 2 out with the tenant, 2 in
 * office custody (the office copy and the vendor loaner). The loaner only
 * becomes holder_type 'vendor' when it's actually checked out to a vendor,
 * so a freshly issued key shows "2 of 4 out".
 */
export const DEFAULT_KEY_TEMPLATE: KeyTypeTemplateEntry[] = [
  {
    label: 'Main',
    copies: [
      { holder_type: 'tenant' },
      { holder_type: 'tenant' },
      { holder_type: 'office', holder_name: 'Office' },
      { holder_type: 'office', holder_name: 'Vendor loaner' },
    ],
  },
];

// ============================================
// Events
// ============================================

export async function appendKeyEvent(
  keySlotId: string,
  eventType: string,
  payload: Record<string, unknown>,
  actor: string,
  assignmentId?: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('key_event').insert({
    key_slot_id: keySlotId,
    assignment_id: assignmentId ?? null,
    event_type: eventType,
    payload,
    actor,
  });
  if (error) {
    console.error('[keys] appendKeyEvent failed:', error.message, eventType, keySlotId);
  }
}

// ============================================
// List + stats
// ============================================

export interface KeyListFilter {
  q?: string;
  status?: KeySlotStatus | 'flagged' | 'unlinked' | 'af_vacant';
}

interface ActiveAssignmentRow extends KeyAssignment {
  key_type: Array<{ id: string; key_copy: Array<Pick<KeyCopy, 'id' | 'status' | 'holder_type'>> }>;
}

export async function getKeySlots(filter: KeyListFilter = {}): Promise<KeyListRow[]> {
  const supabase = getSupabaseAdmin();

  const { data: slots, error } = await supabase
    .from('key_slot')
    .select('id, key_number, status, notes, created_at, updated_at')
    .order('key_number', { ascending: true });
  if (error) throw new Error(`Failed to load key slots: ${error.message}`);

  const { data: assignments, error: aErr } = await supabase
    .from('key_assignment')
    .select('*, key_type(id, key_copy(id, status, holder_type))')
    .is('released_at', null);
  if (aErr) throw new Error(`Failed to load key assignments: ${aErr.message}`);

  const bySlot = new Map<string, ActiveAssignmentRow>();
  for (const a of (assignments || []) as ActiveAssignmentRow[]) {
    bySlot.set(a.key_slot_id, a);
  }

  let rows: KeyListRow[] = ((slots || []) as KeySlot[]).map((s) => {
    const a = bySlot.get(s.id);
    const copies = a?.key_type?.flatMap((t) => t.key_copy || []) ?? [];
    const address = a
      ? [a.address_1, a.address_2].filter(Boolean).join(' ') || a.raw_address
      : null;
    return {
      id: s.id,
      key_number: s.key_number,
      status: s.status,
      address,
      property_name: a?.property_name ?? null,
      owner_name: a?.owner_name ?? null,
      tenant_names: a?.tenant_names ?? [],
      copies_out: copies.filter((c) => c.status === 'issued' && c.holder_type !== 'office').length,
      copies_total: copies.length,
      sync_flag: a?.sync_flag ?? null,
      unlinked: Boolean(a && !a.appfolio_unit_id),
      af_vacant: Boolean(a && a.unit_occupied === false),
      assigned_at: a?.assigned_at ?? null,
    };
  });

  const { q, status } = filter;
  if (status === 'flagged') {
    rows = rows.filter((r) => r.sync_flag !== null);
  } else if (status === 'unlinked') {
    rows = rows.filter((r) => r.unlinked);
  } else if (status === 'af_vacant') {
    rows = rows.filter((r) => r.af_vacant);
  } else if (status) {
    rows = rows.filter((r) => r.status === status);
  }

  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        String(r.key_number) === needle ||
        (r.address || '').toLowerCase().includes(needle) ||
        (r.property_name || '').toLowerCase().includes(needle) ||
        (r.owner_name || '').toLowerCase().includes(needle) ||
        r.tenant_names.some((t) => t.toLowerCase().includes(needle))
    );
  }

  return rows;
}

export async function getKeyStats(): Promise<KeyStats> {
  const rows = await getKeySlots();
  return {
    total: rows.length,
    assigned: rows.filter((r) => r.status === 'assigned').length,
    vacant: rows.filter((r) => r.status === 'vacant').length,
    open: rows.filter((r) => r.status === 'open').length,
    retired: rows.filter((r) => r.status === 'retired').length,
    flagged: rows.filter((r) => r.sync_flag !== null).length,
    unlinked: rows.filter((r) => r.unlinked).length,
    af_vacant: rows.filter((r) => r.af_vacant).length,
  };
}

// ============================================
// Detail
// ============================================

export async function getKeyDetail(slotId: string): Promise<KeyDetail | null> {
  const supabase = getSupabaseAdmin();

  const { data: slot, error } = await supabase
    .from('key_slot')
    .select('*')
    .eq('id', slotId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to load key slot: ${error.message}`);
  }

  const [{ data: assignments, error: aErr }, { data: events, error: eErr }, { data: prevSlot }, { data: nextSlot }] = await Promise.all([
    supabase
      .from('key_assignment')
      .select('*')
      .eq('key_slot_id', slotId)
      .order('created_at', { ascending: false }),
    supabase
      .from('key_event')
      .select('*')
      .eq('key_slot_id', slotId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('key_slot')
      .select('id, key_number')
      .lt('key_number', (slot as KeySlot).key_number)
      .order('key_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('key_slot')
      .select('id, key_number')
      .gt('key_number', (slot as KeySlot).key_number)
      .order('key_number', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (aErr) throw new Error(`Failed to load assignments: ${aErr.message}`);
  if (eErr) throw new Error(`Failed to load events: ${eErr.message}`);

  const all = (assignments || []) as KeyAssignment[];
  const active = all.find((a) => a.released_at === null) ?? null;

  let keyTypes: KeyType[] = [];
  if (active) {
    const { data: types, error: tErr } = await supabase
      .from('key_type')
      .select('*, key_copy(*)')
      .eq('assignment_id', active.id)
      .order('sort_order', { ascending: true });
    if (tErr) throw new Error(`Failed to load key types: ${tErr.message}`);
    keyTypes = ((types || []) as Array<KeyType & { key_copy: KeyCopy[] }>).map((t) => ({
      id: t.id,
      assignment_id: t.assignment_id,
      label: t.label,
      sort_order: t.sort_order,
      notes: t.notes,
      copies: (t.key_copy || []).sort((a, b) => (a.issued_at || '').localeCompare(b.issued_at || '')),
    }));
  }

  return {
    slot: slot as KeySlot,
    active_assignment: active,
    key_types: keyTypes,
    past_assignments: all.filter((a) => a.released_at !== null),
    events: (events || []) as KeyEvent[],
    nav: {
      prev: (prevSlot as { id: string; key_number: number } | null) ?? null,
      next: (nextSlot as { id: string; key_number: number } | null) ?? null,
    },
  };
}

export async function getSlotByNumber(keyNumber: number): Promise<KeySlot | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('key_slot')
    .select('*')
    .eq('key_number', keyNumber)
    .single();
  if (error) return null;
  return data as KeySlot;
}

// ============================================
// Transitions
// ============================================

export interface AssignInput {
  appfolioUnitId?: string | null;
  appfolioPropertyId?: string | null;
  propertyName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  ownerName?: string | null;
  tenantNames?: string[];
  rawAddress?: string | null;
  assignedAt?: string;
  template?: KeyTypeTemplateEntry[];
  confirmDuplicateUnit?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  status?: KeySlotStatus;
  error?: string;
  code?: 'illegal_transition' | 'unit_has_active_key' | 'outstanding_copies' | 'conflict';
  /** For unit_has_active_key: the key numbers already on that unit. */
  key_numbers?: number[];
  /** For outstanding_copies: copies still issued outside the office. */
  outstanding?: Array<{ id: string; holder_type: string; holder_name: string | null }>;
}

async function loadSlot(slotId: string): Promise<KeySlot> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('key_slot').select('*').eq('id', slotId).single();
  if (error || !data) throw new Error(`Key slot not found: ${slotId}`);
  return data as KeySlot;
}

async function setSlotStatus(slotId: string, status: KeySlotStatus): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('key_slot').update({ status }).eq('id', slotId);
  if (error) throw new Error(`Failed to update key slot status: ${error.message}`);
}

async function getActiveAssignment(slotId: string): Promise<KeyAssignment | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('key_assignment')
    .select('*')
    .eq('key_slot_id', slotId)
    .is('released_at', null)
    .maybeSingle();
  if (error) throw new Error(`Failed to load active assignment: ${error.message}`);
  return (data as KeyAssignment) ?? null;
}

/** Key numbers with an active assignment on the given unit. */
export async function activeKeyNumbersForUnit(appfolioUnitId: string): Promise<number[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('key_assignment')
    .select('key_slot_id, key_slot(key_number)')
    .eq('appfolio_unit_id', appfolioUnitId)
    .is('released_at', null);
  if (error) throw new Error(`Failed to check unit keys: ${error.message}`);
  return ((data || []) as Array<{ key_slot: { key_number: number } | { key_number: number }[] }>)
    .flatMap((r) => (Array.isArray(r.key_slot) ? r.key_slot : [r.key_slot]))
    .map((s) => s.key_number)
    .sort((a, b) => a - b);
}

async function createTypesAndCopies(
  assignmentId: string,
  template: KeyTypeTemplateEntry[],
  issuedAt: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  for (let i = 0; i < template.length; i++) {
    const t = template[i];
    const { data: typeRow, error: tErr } = await supabase
      .from('key_type')
      .insert({ assignment_id: assignmentId, label: t.label, sort_order: i })
      .select('id')
      .single();
    if (tErr || !typeRow) throw new Error(`Failed to create key type '${t.label}': ${tErr?.message}`);
    if (t.copies.length > 0) {
      const { error: cErr } = await supabase.from('key_copy').insert(
        t.copies.map((c) => ({
          key_type_id: typeRow.id,
          holder_type: c.holder_type,
          holder_name: c.holder_name ?? null,
          charged: c.charged ?? false,
          status: 'issued',
          issued_at: issuedAt,
        }))
      );
      if (cErr) throw new Error(`Failed to create copies for '${t.label}': ${cErr.message}`);
    }
  }
}

export async function assignKey(
  slotId: string,
  input: AssignInput,
  actor: string
): Promise<TransitionResult> {
  const supabase = getSupabaseAdmin();
  const slot = await loadSlot(slotId);
  if (!canTransition(slot.status, 'assign')) {
    return { ok: false, code: 'illegal_transition', error: `Key #${slot.key_number} is '${slot.status}' — cannot assign` };
  }

  if (input.appfolioUnitId && !input.confirmDuplicateUnit) {
    const existing = await activeKeyNumbersForUnit(input.appfolioUnitId);
    if (existing.length > 0) {
      return { ok: false, code: 'unit_has_active_key', key_numbers: existing, error: `Unit already has active key(s): ${existing.join(', ')}` };
    }
  }

  const assignedAt = input.assignedAt || new Date().toISOString().split('T')[0];
  const { data: assignment, error } = await supabase
    .from('key_assignment')
    .insert({
      key_slot_id: slotId,
      appfolio_unit_id: input.appfolioUnitId ?? null,
      appfolio_property_id: input.appfolioPropertyId ?? null,
      property_name: input.propertyName ?? null,
      address_1: input.address1 ?? null,
      address_2: input.address2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      zip: input.zip ?? null,
      owner_name: input.ownerName ?? null,
      tenant_names: input.tenantNames ?? [],
      raw_address: input.rawAddress ?? null,
      assigned_at: assignedAt,
      assigned_by: actor,
    })
    .select('*')
    .single();
  if (error) {
    // 23505 = unique violation on idx_key_assignment_one_active (race backstop)
    if (error.code === '23505') {
      return { ok: false, code: 'conflict', error: `Key #${slot.key_number} was assigned by someone else just now` };
    }
    throw new Error(`Failed to create assignment: ${error.message}`);
  }

  await createTypesAndCopies(assignment.id, input.template ?? DEFAULT_KEY_TEMPLATE, assignedAt);
  await setSlotStatus(slotId, 'assigned');
  await appendKeyEvent(
    slotId,
    'assigned',
    {
      appfolio_unit_id: input.appfolioUnitId ?? null,
      address: [input.address1, input.address2].filter(Boolean).join(' ') || input.rawAddress,
      tenant_names: input.tenantNames ?? [],
      assigned_at: assignedAt,
    },
    actor,
    assignment.id
  );
  return { ok: true, status: 'assigned' };
}

export interface MarkVacantInput {
  /** Outcome for each currently-issued tenant copy. */
  copyOutcomes: Array<{ copyId: string; outcome: 'returned' | 'lost' }>;
}

export async function markKeyVacant(
  slotId: string,
  input: MarkVacantInput,
  actor: string
): Promise<TransitionResult> {
  const supabase = getSupabaseAdmin();
  const slot = await loadSlot(slotId);
  if (!canTransition(slot.status, 'mark_vacant')) {
    return { ok: false, code: 'illegal_transition', error: `Key #${slot.key_number} is '${slot.status}' — cannot mark vacant` };
  }
  const active = await getActiveAssignment(slotId);

  const today = new Date().toISOString().split('T')[0];
  for (const { copyId, outcome } of input.copyOutcomes) {
    const { error } = await supabase
      .from('key_copy')
      .update({ status: outcome, returned_at: outcome === 'returned' ? today : null })
      .eq('id', copyId);
    if (error) throw new Error(`Failed to update copy ${copyId}: ${error.message}`);
  }

  await setSlotStatus(slotId, 'vacant');
  await appendKeyEvent(
    slotId,
    'marked_vacant',
    { copy_outcomes: input.copyOutcomes, previous_tenants: active?.tenant_names ?? [] },
    actor,
    active?.id
  );
  return { ok: true, status: 'vacant' };
}

export interface ReissueInput {
  tenantNames: string[];
  /** New copies to issue (typically tenant copies; charged for extras). */
  copies: Array<{ keyTypeId: string; holderType: string; holderName?: string | null; charged?: boolean }>;
}

export async function reissueKey(
  slotId: string,
  input: ReissueInput,
  actor: string
): Promise<TransitionResult> {
  const supabase = getSupabaseAdmin();
  const slot = await loadSlot(slotId);
  if (!canTransition(slot.status, 'reissue')) {
    return { ok: false, code: 'illegal_transition', error: `Key #${slot.key_number} is '${slot.status}' — cannot reissue` };
  }
  const active = await getActiveAssignment(slotId);
  if (!active) {
    return { ok: false, code: 'illegal_transition', error: 'No active assignment to reissue' };
  }

  const today = new Date().toISOString().split('T')[0];
  if (input.copies.length > 0) {
    const { error } = await supabase.from('key_copy').insert(
      input.copies.map((c) => ({
        key_type_id: c.keyTypeId,
        holder_type: c.holderType,
        holder_name: c.holderName ?? null,
        charged: c.charged ?? false,
        status: 'issued',
        issued_at: today,
      }))
    );
    if (error) throw new Error(`Failed to issue copies: ${error.message}`);
  }

  const { error: aErr } = await supabase
    .from('key_assignment')
    .update({ tenant_names: input.tenantNames })
    .eq('id', active.id);
  if (aErr) throw new Error(`Failed to update tenants: ${aErr.message}`);

  await setSlotStatus(slotId, 'assigned');
  await appendKeyEvent(
    slotId,
    'reissued',
    { tenant_names: input.tenantNames, copies_issued: input.copies.length },
    actor,
    active.id
  );
  return { ok: true, status: 'assigned' };
}

export interface ReleaseInput {
  acknowledgeOutstanding?: boolean;
}

export async function releaseKey(
  slotId: string,
  input: ReleaseInput,
  actor: string
): Promise<TransitionResult> {
  const supabase = getSupabaseAdmin();
  const slot = await loadSlot(slotId);
  if (!canTransition(slot.status, 'release')) {
    return { ok: false, code: 'illegal_transition', error: `Key #${slot.key_number} is '${slot.status}' — cannot release` };
  }
  const active = await getActiveAssignment(slotId);

  if (active && !input.acknowledgeOutstanding) {
    const { data: types, error } = await supabase
      .from('key_type')
      .select('id, key_copy(id, holder_type, holder_name, status)')
      .eq('assignment_id', active.id);
    if (error) throw new Error(`Failed to check copies: ${error.message}`);
    const outstanding = ((types || []) as Array<{ key_copy: Array<{ id: string; holder_type: string; holder_name: string | null; status: string }> }>)
      .flatMap((t) => t.key_copy || [])
      .filter((c) => c.status === 'issued' && c.holder_type !== 'office');
    if (outstanding.length > 0) {
      return {
        ok: false,
        code: 'outstanding_copies',
        error: `${outstanding.length} cop${outstanding.length === 1 ? 'y is' : 'ies are'} still out`,
        outstanding: outstanding.map(({ id, holder_type, holder_name }) => ({ id, holder_type, holder_name })),
      };
    }
  }

  if (active) {
    const { error } = await supabase
      .from('key_assignment')
      .update({ released_at: new Date().toISOString() })
      .eq('id', active.id);
    if (error) throw new Error(`Failed to release assignment: ${error.message}`);
  }

  await setSlotStatus(slotId, 'open');
  await appendKeyEvent(
    slotId,
    'released',
    {
      address: active ? [active.address_1, active.address_2].filter(Boolean).join(' ') || active.raw_address : null,
      acknowledged_outstanding: Boolean(input.acknowledgeOutstanding),
    },
    actor,
    active?.id
  );
  return { ok: true, status: 'open' };
}

export async function retireKey(slotId: string, actor: string): Promise<TransitionResult> {
  const supabase = getSupabaseAdmin();
  const slot = await loadSlot(slotId);
  if (!canTransition(slot.status, 'retire')) {
    return { ok: false, code: 'illegal_transition', error: `Key #${slot.key_number} is '${slot.status}' — cannot retire` };
  }
  const active = await getActiveAssignment(slotId);
  if (active) {
    const { error } = await supabase
      .from('key_assignment')
      .update({ released_at: new Date().toISOString() })
      .eq('id', active.id);
    if (error) throw new Error(`Failed to close assignment: ${error.message}`);
  }
  await setSlotStatus(slotId, 'retired');
  await appendKeyEvent(slotId, 'retired', { previous_status: slot.status }, actor, active?.id);
  return { ok: true, status: 'retired' };
}

export async function reinstateKey(slotId: string, actor: string): Promise<TransitionResult> {
  const slot = await loadSlot(slotId);
  if (!canTransition(slot.status, 'reinstate')) {
    return { ok: false, code: 'illegal_transition', error: `Key #${slot.key_number} is '${slot.status}' — cannot reinstate` };
  }
  await setSlotStatus(slotId, 'open');
  await appendKeyEvent(slotId, 'reinstated', {}, actor);
  return { ok: true, status: 'open' };
}
