/**
 * Unit Turnover Tracker — data loading and writes (service-role Supabase).
 * The rules live in ./model; this file only gathers rows and records changes.
 * Nothing is written to AppFolio.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHECK_BY_KEY,
  FINAL_STATUSES,
  INVOICE_GRACE_BUSINESS_DAYS,
  WO_STATUS_LABEL,
  buildSections,
  depositSlipDue,
  effectiveStatus,
  inView,
  isWoStatus,
  needsAction,
  sectionFor,
  viewOf,
  type CheckState,
  type SectionNo,
  type SectionStatus,
  type TrackerWo,
  type TurnView,
  type WoStatus,
} from './model';
import { afInvoiceReceived, loadAfBilling, type WoAfBilling } from '@/lib/maintenance/af-wo-billing';

const WO_COLS =
  'id, wo_number, description, unit_turn_category, appfolio_status, status, canceled_date, completed_date, scheduled_start, ' +
  'assigned_to, vendor_name, appfolio_link, appfolio_last_updated_at, created_at, unit_turn_id, ' +
  'turn_status, turn_status_af_basis, turn_status_by, turn_status_at, turn_snoozed_until';

const TURN_COLS =
  'id, property_name, unit_name, vacated_at, movein_date, target_ready, status, coordinator, af_unit_link, af_service_request_id';

type Row = Record<string, unknown>;

interface TurnRow {
  id: string;
  property_name: string;
  unit_name: string | null;
  vacated_at: string;
  movein_date: string | null;
  target_ready: string | null;
  status: string;
  coordinator: string | null;
  af_unit_link: string | null;
}

interface WoRow extends TrackerWo {
  wo_number: string | null;
  completed_date: string | null;
  scheduled_start: string | null;
  assigned_to: string | null;
  vendor_name: string | null;
  appfolio_link: string | null;
  appfolio_last_updated_at: string | null;
  created_at: string;
  unit_turn_id: string;
  turn_status_by: string | null;
  turn_status_at: string | null;
  turn_snoozed_until: string | null;
  /** What AppFolio shows for this work order's invoice and bills (null: not synced yet). */
  af_billing?: (WoAfBilling & { synced_at: string }) | null;
}

async function loadWos(db: SupabaseClient, turnIds: string[]): Promise<WoRow[]> {
  if (turnIds.length === 0) return [];
  const { data, error } = await db.from('work_orders').select(WO_COLS).in('unit_turn_id', turnIds);
  if (error) throw new Error(error.message);
  const wos = (data ?? []) as unknown as WoRow[];
  if (wos.length) {
    const [{ data: inv }, af] = await Promise.all([
      db.from('hdms_invoices').select('work_order_id').in('work_order_id', wos.map((w) => w.id)),
      loadAfBilling(db, wos.map((w) => w.wo_number ?? '')),
    ]);
    const linked = new Set((inv ?? []).map((r) => r.work_order_id as string));
    for (const w of wos) {
      w.has_linked_invoice = linked.has(w.id);
      w.af_billing = w.wo_number ? af.get(w.wo_number) ?? null : null;
      w.af_invoice_received = afInvoiceReceived(w.af_billing);
    }
  }
  return wos;
}

async function loadChecks(db: SupabaseClient, turnIds: string[]): Promise<Map<string, Record<string, CheckState>>> {
  const out = new Map<string, Record<string, CheckState>>();
  if (turnIds.length === 0) return out;
  const { data, error } = await db
    .from('unit_turn_check')
    .select('unit_turn_id, item_key, checked, value, checked_at, checked_by')
    .in('unit_turn_id', turnIds);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    const m = out.get(r.unit_turn_id as string) ?? {};
    m[r.item_key as string] = { checked: !!r.checked, value: (r.value as string) ?? null, checked_at: (r.checked_at as string) ?? null, checked_by: (r.checked_by as string) ?? null };
    out.set(r.unit_turn_id as string, m);
  }
  return out;
}

/**
 * When each work order entered its current status: a hand-set status carries
 * its own time; otherwise the latest AppFolio status-change event, falling
 * back to the completed date / last AppFolio update / creation.
 */
async function statusSince(db: SupabaseClient, wos: WoRow[]): Promise<Record<string, string | null>> {
  const since: Record<string, string | null> = {};
  const afIds = wos.filter((w) => effectiveStatus(w).source === 'appfolio').map((w) => w.id);
  const lastChange = new Map<string, string>();
  if (afIds.length) {
    const { data } = await db
      .from('wo_event')
      .select('work_order_id, payload, created_at')
      .eq('event_type', 'sync_update')
      .in('work_order_id', afIds)
      .order('created_at', { ascending: false });
    for (const e of data ?? []) {
      const p = e.payload as { field?: string } | null;
      if (p?.field === 'appfolio_status' && !lastChange.has(e.work_order_id as string)) {
        lastChange.set(e.work_order_id as string, e.created_at as string);
      }
    }
  }
  for (const w of wos) {
    const eff = effectiveStatus(w);
    if (eff.source === 'manual') since[w.id] = w.turn_status_at;
    else if (eff.status === 'completed_awaiting_invoice' && w.completed_date) since[w.id] = w.completed_date;
    else since[w.id] = lastChange.get(w.id) ?? w.appfolio_last_updated_at ?? w.created_at ?? null;
  }
  return since;
}

function daysSince(iso: string | null, today: string): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${today}T12:00:00Z`) - Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardRow {
  id: string;
  unit: string;
  property: string;
  vacated_at: string;
  movein_date: string | null;
  coordinator: string | null;
  af_unit_link: string | null;
  view: Exclude<TurnView, 'all'>;
  sections: { no: SectionNo; status: SectionStatus; detail: string; overdue: boolean }[];
  needsAction: string[];
  waitingApproval: number;
  waitingFunds: number;
}

export interface Dashboard {
  today: string;
  rows: DashboardRow[];
  tiles: { units: number; waitingApproval: number; waitingFunds: number; needsAction: number };
  properties: string[];
  coordinators: string[];
}

export async function loadDashboard(db: SupabaseClient, view: TurnView, today: string): Promise<Dashboard> {
  let q = db.from('unit_turn').select(TURN_COLS).order('vacated_at', { ascending: true });
  if (view === 'active' || view === 'not_yet_ready') q = q.neq('status', 'closed');
  if (view === 'completed') q = q.eq('status', 'closed');
  const { data: turnData, error } = await q.limit(500);
  if (error) throw new Error(error.message);
  const turns = ((turnData ?? []) as unknown as TurnRow[]).filter((t) => inView(t, view, today));

  const ids = turns.map((t) => t.id);
  const [wos, checks] = await Promise.all([loadWos(db, ids), loadChecks(db, ids)]);
  const since = await statusSince(db, wos.filter((w) => effectiveStatus(w).status === 'completed_awaiting_invoice'));
  const byTurn = new Map<string, WoRow[]>();
  for (const w of wos) byTurn.set(w.unit_turn_id, [...(byTurn.get(w.unit_turn_id) ?? []), w]);

  const rows: DashboardRow[] = turns.map((t) => {
    const turnWos = byTurn.get(t.id) ?? [];
    const input = { vacated_at: t.vacated_at, movein_date: t.movein_date, status: t.status, wos: turnWos, checks: checks.get(t.id) ?? {} };
    const sections = buildSections(input);
    const action = needsAction(input, sections, since, today);
    const statuses = turnWos.map((w) => effectiveStatus(w).status);
    return {
      id: t.id,
      unit: t.unit_name || t.property_name,
      property: t.property_name,
      vacated_at: t.vacated_at,
      movein_date: t.movein_date,
      coordinator: t.coordinator,
      af_unit_link: t.af_unit_link,
      view: viewOf(t, today),
      sections: sections.map((s) => ({
        no: s.no,
        status: s.status,
        detail: s.no === 6 && action.includes('Deposit slip overdue') ? 'Deposit slip overdue' : s.detail,
        overdue: s.no === 6 && action.length > 0,
      })),
      needsAction: action,
      waitingApproval: statuses.filter((s) => s === 'awaiting_owner_approval').length,
      waitingFunds: statuses.filter((s) => s === 'awaiting_owner_funds').length,
    };
  });

  return {
    today,
    rows,
    tiles: {
      units: rows.length,
      waitingApproval: rows.reduce((n, r) => n + r.waitingApproval, 0),
      waitingFunds: rows.reduce((n, r) => n + r.waitingFunds, 0),
      needsAction: rows.reduce((n, r) => n + r.needsAction.length, 0),
    },
    properties: [...new Set(rows.map((r) => r.property))].sort(),
    coordinators: [...new Set(rows.map((r) => r.coordinator).filter(Boolean) as string[])].sort(),
  };
}

// ── Unit detail ─────────────────────────────────────────────────────────────

export interface DetailWo {
  id: string;
  title: string;
  category: string;
  wo_number: string | null;
  vendor: string | null;
  assigned: string | null;
  estimate: number | null;
  approved: number | null;
  status: WoStatus;
  statusLabel: string;
  source: 'appfolio' | 'manual';
  sourceBy: string | null;
  daysInStatus: number | null;
  scheduled: string | null;
  done: string | null;
  invoice: string;
  /** AppFolio's view: invoices uploaded and bills entered, with when it was last checked. */
  appfolio: {
    invoices: number;
    billed: number;
    paid: number;
    unpaid: number;
    lastBillDate: string | null;
    checkedAt: string;
  } | null;
  reminder: string;
  appfolio_link: string | null;
}

export interface Detail {
  today: string;
  turn: TurnRow & { deposit_due: string };
  sections: ReturnType<typeof buildSections>;
  wos: Record<string, DetailWo>;
  progress: { complete: number; total: number };
  activity: { id: number; kind: string; body: string; actor: string; created_at: string }[];
  staff: { person: string; name: string }[];
  needsAction: string[];
}

/** Statuses the estimate follow-up board already chases — linked there, not reminded twice. */
const CHASE_BOARD: ReadonlySet<WoStatus> = new Set(['estimate_requested', 'estimated', 'awaiting_owner_approval']);

function reminderLabel(w: WoRow, status: WoStatus, daysInStatus: number | null, today: string): string {
  if (w.turn_snoozed_until && w.turn_snoozed_until >= today) return `Snoozed until ${w.turn_snoozed_until}`;
  if (FINAL_STATUSES.has(status)) return 'None';
  if (status === 'scheduled') return w.scheduled_start ? `Task on ${w.scheduled_start.slice(0, 10)}` : 'None';
  if (CHASE_BOARD.has(status)) return 'Estimate follow-up board';
  if (status === 'completed_awaiting_invoice') {
    return daysInStatus != null && daysInStatus < INVOICE_GRACE_BUSINESS_DAYS ? `Daily after ${INVOICE_GRACE_BUSINESS_DAYS} business days` : 'Daily, weekdays 7am';
  }
  return 'Daily, weekdays 7am';
}

function invoiceLabel(status: WoStatus): string {
  if (status === 'complete_invoice_received') return 'Received';
  if (status === 'complete_no_bill') return 'None needed';
  if (status === 'cancelled') return '—';
  return 'None';
}

export async function loadDetail(db: SupabaseClient, id: string, today: string): Promise<Detail | null> {
  const { data: turnData } = await db.from('unit_turn').select(TURN_COLS).eq('id', id).maybeSingle();
  if (!turnData) return null;
  const t = turnData as unknown as TurnRow;

  const [wos, checks, act, staff] = await Promise.all([
    loadWos(db, [id]),
    loadChecks(db, [id]),
    db.from('turn_activity').select('id, kind, body, actor, created_at').eq('unit_turn_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('staff').select('person, name').eq('active', true).order('name'),
  ]);
  const since = await statusSince(db, wos);
  const woIds = wos.map((w) => w.id);

  // Estimate / approved amounts: owner approvals first, then our own issued estimates.
  const amounts = new Map<string, { estimate: number | null; approved: number | null }>();
  if (woIds.length) {
    const { data: appr } = await db
      .from('approval')
      .select('work_order_id, estimate, approved_amount, decision, requested_at')
      .eq('kind', 'OWNER')
      .in('work_order_id', woIds)
      .order('requested_at', { ascending: true });
    for (const a of appr ?? []) {
      amounts.set(a.work_order_id as string, {
        estimate: a.estimate != null ? Number(a.estimate) : null,
        approved: a.decision === 'APPROVED' ? Number(a.approved_amount ?? a.estimate ?? 0) : null,
      });
    }
    const { data: ests } = await db
      .from('estimate')
      .select('work_order_id, status, current_version_id')
      .in('work_order_id', woIds)
      .not('status', 'in', '(void,superseded,draft)');
    const versionIds = (ests ?? []).map((e) => e.current_version_id).filter(Boolean) as string[];
    if (versionIds.length) {
      const { data: vers } = await db.from('estimate_version').select('id, owner_total').in('id', versionIds);
      const total = new Map((vers ?? []).map((v) => [v.id as string, Number(v.owner_total)]));
      for (const e of ests ?? []) {
        const wo = e.work_order_id as string;
        if (amounts.has(wo) || !e.current_version_id) continue;
        const amt = total.get(e.current_version_id as string) ?? null;
        amounts.set(wo, { estimate: amt, approved: e.status === 'approved' ? amt : null });
      }
    }
  }

  const detailWos: Record<string, DetailWo> = {};
  for (const w of wos) {
    const eff = effectiveStatus(w);
    const days = daysSince(since[w.id], today);
    detailWos[w.id] = {
      id: w.id,
      title: w.description || `WO ${w.wo_number ?? ''}`.trim(),
      category: w.unit_turn_category || 'Linked manually',
      wo_number: w.wo_number,
      vendor: w.vendor_name,
      assigned: w.assigned_to,
      estimate: amounts.get(w.id)?.estimate ?? null,
      approved: amounts.get(w.id)?.approved ?? null,
      status: eff.status,
      statusLabel: WO_STATUS_LABEL[eff.status],
      source: eff.source,
      sourceBy: eff.source === 'manual' ? w.turn_status_by : null,
      daysInStatus: days,
      scheduled: w.scheduled_start ? w.scheduled_start.slice(0, 10) : null,
      done: w.completed_date ? w.completed_date.slice(0, 10) : null,
      invoice: invoiceLabel(eff.status),
      appfolio: w.af_billing
        ? {
            invoices: w.af_billing.invoice_count,
            billed: w.af_billing.billed_amount,
            paid: w.af_billing.paid_amount,
            unpaid: w.af_billing.unpaid_amount,
            lastBillDate: w.af_billing.last_bill_date,
            checkedAt: w.af_billing.synced_at,
          }
        : null,
      reminder: reminderLabel(w, eff.status, days, today),
      appfolio_link: w.appfolio_link,
    };
  }

  const input = { vacated_at: t.vacated_at, movein_date: t.movein_date, status: t.status, wos, checks: checks.get(id) ?? {} };
  const sections = buildSections(input);
  return {
    today,
    turn: { ...t, deposit_due: depositSlipDue(t.vacated_at) },
    sections,
    wos: detailWos,
    progress: { complete: sections.filter((s) => s.status === 'complete').length, total: sections.length },
    activity: (act.data ?? []) as Detail['activity'],
    staff: (staff.data ?? []) as Detail['staff'],
    needsAction: needsAction(input, sections, since, today),
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function logActivity(db: SupabaseClient, turnId: string, kind: string, body: string, actor: string) {
  const { error } = await db.from('turn_activity').insert({ unit_turn_id: turnId, kind, body, actor });
  if (error) throw new Error(error.message);
}

export async function setCheck(
  db: SupabaseClient,
  turnId: string,
  key: string,
  checked: boolean,
  value: string | null,
  actor: string
): Promise<void> {
  const def = CHECK_BY_KEY.get(key);
  if (!def || def.kind !== 'manual') throw new Error('That item is calculated and cannot be ticked by hand');
  const { error } = await db.from('unit_turn_check').upsert(
    {
      unit_turn_id: turnId,
      item_key: key,
      checked,
      value: value?.trim() ? value.trim().slice(0, 500) : null,
      checked_at: checked ? new Date().toISOString() : null,
      checked_by: checked ? actor : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'unit_turn_id,item_key' }
  );
  if (error) throw new Error(error.message);
  await logActivity(db, turnId, 'check', `${checked ? 'Checked' : 'Unchecked'}: ${def.label}${value?.trim() ? ` (${value.trim()})` : ''}`, actor);
}

export async function setWoStatus(db: SupabaseClient, woId: string, status: string, actor: string): Promise<string> {
  if (!isWoStatus(status)) throw new Error('Unknown status');
  const { data } = await db.from('work_orders').select(WO_COLS).eq('id', woId).maybeSingle();
  const w = data as unknown as WoRow | null;
  if (!w?.unit_turn_id) throw new Error('Work order not found');
  const from = effectiveStatus(w).status;
  if (from === status) return w.unit_turn_id;
  const { error } = await db
    .from('work_orders')
    .update({ turn_status: status, turn_status_af_basis: w.appfolio_status, turn_status_by: actor, turn_status_at: new Date().toISOString() })
    .eq('id', woId);
  if (error) throw new Error(error.message);
  await db.from('wo_event').insert({ work_order_id: woId, event_type: 'turn_status_change', payload: { from, to: status, source: 'manual' }, actor });
  await logActivity(db, w.unit_turn_id, 'wo_status', `${w.description || 'Work order'}: ${WO_STATUS_LABEL[from]} → ${WO_STATUS_LABEL[status]}`, actor);
  return w.unit_turn_id;
}

export async function addNote(db: SupabaseClient, turnId: string, body: string, actor: string): Promise<void> {
  const text = body.trim().slice(0, 4000);
  if (!text) throw new Error('Note is empty');
  await logActivity(db, turnId, 'note', text, actor);
}

export async function setCoordinator(db: SupabaseClient, turnId: string, person: string, actor: string): Promise<void> {
  const { data: staff } = await db.from('staff').select('person, name').eq('person', person).eq('active', true).maybeSingle();
  if (!staff) throw new Error('Unknown staff member');
  const { error } = await db.from('unit_turn').update({ coordinator: person }).eq('id', turnId);
  if (error) throw new Error(error.message);
  await logActivity(db, turnId, 'coordinator', `Coordinator set to ${staff.name}`, actor);
}

/** Mark complete / reopen. Keeps the legacy status and the lifecycle status in step. */
export async function setComplete(db: SupabaseClient, turnId: string, complete: boolean, actor: string): Promise<void> {
  const { data: t } = await db.from('unit_turn').select('lifecycle_status').eq('id', turnId).maybeSingle();
  if (!t) throw new Error('Unit turn not found');
  const to = complete ? 'CLOSED' : 'IN_PROGRESS';
  const { error } = await db.from('unit_turn').update({ status: complete ? 'closed' : 'active', lifecycle_status: to }).eq('id', turnId);
  if (error) throw new Error(error.message);
  await db.from('turn_status_event').insert({ unit_turn_id: turnId, from_status: (t as Row).lifecycle_status ?? null, to_status: to, actor, reason: 'Turnover tracker' });
  await logActivity(db, turnId, complete ? 'complete' : 'reopen', complete ? 'Marked complete' : 'Reopened', actor);
}
