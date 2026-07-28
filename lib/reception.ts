/**
 * Reception call report — who answers the main line, and where calls go.
 *
 * Source of truth is Zoom Phone call history (verified 2026-07-28):
 *   - Every main-line call hits the "Main Auto Receptionist" IVR.
 *   - Business hours it rings Ashley; result 'answered' = Ashley took it,
 *     'no_answer' = it forwards to Haven AI's line (HAVEN_RECEPTION_NUMBER).
 *   - After hours the IVR forwards straight to Haven ('direct' path).
 *   - When Haven needs a human it places a NEW inbound call from its own
 *     number into a Zoom call queue ("Approved Application" = leasing,
 *     "Existing Tenant" = maintenance/tenant service, "Human Requested")
 *     or directly to a staff line. Those legs can't be joined to the
 *     original call (Zoom sees Haven's caller ID), so they're stored as
 *     separate 'haven_transfer' rows and reported side by side.
 *
 * Per-leg results come from GET /phone/call_history/{id} (call_path).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { zoomFetch, isZoomConfigured } from './zoom-phone';

const HAVEN_LINE = process.env.HAVEN_RECEPTION_NUMBER || '+15415775110';
const RECEPTIONIST_EMAIL = process.env.RECEPTIONIST_EMAIL || 'ashley@highdesertpm.com';

const ANSWERED = new Set(['answered', 'accepted', 'connected', 'call_connected', 'completed']);

// Queue-name → intent mapping for Haven's human transfers.
function queueIntent(name: string): string {
  if (/application|leasing|showing/i.test(name)) return 'leasing';
  if (/tenant|maintenance/i.test(name)) return 'maintenance';
  if (/human/i.test(name)) return 'human';
  return 'unknown';
}

interface CallHistoryItem {
  id: string;
  direction: string;
  duration: number;
  caller_did_number?: string;
  caller_name?: string;
  callee_did_number?: string;
  callee_name?: string;
  callee_ext_type?: string;
  callee_ext_id?: string;
  start_time: string;
  call_result?: string;
}

interface CallPathLeg {
  callee_did_number?: string;
  callee_name?: string;
  callee_ext_type?: string;
  callee_ext_id?: string;
  result?: string;
  start_time?: string;
  talk_time?: number;
}

async function zoomJson<T>(path: string): Promise<T> {
  const res = await zoomFetch(path);
  const text = await res.text();
  if (!res.ok) throw new Error(`Zoom ${path} (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function listCallHistory(from: string, to: string): Promise<CallHistoryItem[]> {
  const all: CallHistoryItem[] = [];
  let npt = '';
  do {
    const qs = new URLSearchParams({ from, to, page_size: '100' });
    if (npt) qs.set('next_page_token', npt);
    const j = await zoomJson<{ call_logs?: CallHistoryItem[]; next_page_token?: string }>(
      `/phone/call_history?${qs}`
    );
    all.push(...(j.call_logs || []));
    npt = j.next_page_token || '';
  } while (npt);
  return all;
}

/** The receptionist's Zoom extension id (looked up once per sync by email). */
async function receptionistExt(): Promise<{ extId: string | null; name: string | null }> {
  try {
    const j = await zoomJson<{
      users?: Array<{ email: string; name: string; extension_id: string }>;
    }>('/phone/users?page_size=100');
    const u = (j.users || []).find(
      (u) => u.email?.toLowerCase() === RECEPTIONIST_EMAIL.toLowerCase()
    );
    return { extId: u?.extension_id ?? null, name: u?.name ?? null };
  } catch {
    return { extId: null, name: null };
  }
}

/** Pacific-time calendar date for daily grouping. */
function ptDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

const last10 = (n: string | null | undefined) => (n || '').replace(/\D/g, '').slice(-10);

export interface ReceptionSyncResult {
  daysCovered: string;
  inboundCalls: number;
  havenTransfers: number;
  upserted: number;
}

/**
 * Sync main-line reception calls for [from, to] (YYYY-MM-DD, inclusive) into
 * reception_call. Idempotent — upserts on Zoom call id.
 */
export async function syncReceptionCalls(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ReceptionSyncResult> {
  if (!isZoomConfigured()) throw new Error('Zoom credentials not configured');

  const [history, receptionist] = await Promise.all([listCallHistory(from, to), receptionistExt()]);

  // Leasing-conversation phone numbers, for tagging AI-resolved calls.
  const leasingPhones = new Set<string>();
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('haven_conversation')
      .select('phone_number')
      .range(start, start + 999);
    if (error || !data) break;
    for (const r of data) {
      const d = last10(r.phone_number);
      if (d) leasingPhones.add(d);
    }
    if (data.length < 1000) break;
  }

  const rows: Array<Record<string, unknown>> = [];

  const isHavenLeg = (l: CallPathLeg) => last10(l.callee_did_number) === last10(HAVEN_LINE);
  const isReceptionistLeg = (l: CallPathLeg) =>
    l.callee_ext_type === 'user' &&
    ((receptionist.extId && l.callee_ext_id === receptionist.extId) ||
      (receptionist.name && l.callee_name === receptionist.name) ||
      /ashley/i.test(l.callee_name || ''));

  // ── Main-line inbound calls (hit the auto receptionist) ─────────
  const inbound = history.filter(
    (c) => c.direction === 'inbound' && c.callee_ext_type === 'auto_receptionist'
  );
  for (const call of inbound) {
    let legs: CallPathLeg[] = [];
    try {
      const detail = await zoomJson<{ call_path?: CallPathLeg[] }>(
        `/phone/call_history/${call.id}`
      );
      legs = (detail.call_path || []).sort((a, b) =>
        (a.start_time || '').localeCompare(b.start_time || '')
      );
      await new Promise((r) => setTimeout(r, 120)); // stay under Zoom rate limits
    } catch (err) {
      console.warn(`[Reception] call detail ${call.id} failed:`, err);
    }

    const answeredLeg = legs.find(
      (l) =>
        ANSWERED.has(l.result || '') && (l.callee_ext_type === 'user' || isHavenLeg(l))
    );
    const rangReceptionist = legs.some(isReceptionistLeg);

    let answered_by = 'missed';
    let answered_by_name: string | null = null;
    let haven_path: string | null = null;
    let haven_intent: string | null = null;

    if (answeredLeg && isHavenLeg(answeredLeg)) {
      answered_by = 'haven';
      haven_path = rangReceptionist ? 'overflow' : 'direct';
      haven_intent = leasingPhones.has(last10(call.caller_did_number)) ? 'leasing' : 'unknown';
    } else if (answeredLeg) {
      answered_by = isReceptionistLeg(answeredLeg) ? 'ashley' : 'staff';
      answered_by_name = answeredLeg.callee_name || null;
    }

    rows.push({
      call_id: call.id,
      kind: 'inbound',
      started_at: call.start_time,
      call_date: ptDate(call.start_time),
      caller_number: call.caller_did_number || null,
      caller_name: call.caller_name || null,
      answered_by,
      answered_by_name,
      haven_path,
      haven_intent,
      transfer_target: null,
      duration_seconds: call.duration ?? null,
      raw: { call_result: call.call_result, legs },
    });
  }

  // ── Haven → Zoom transfer legs (Haven hands a live caller to a human) ──
  const transfers = history.filter(
    (c) => c.direction === 'inbound' && last10(c.caller_did_number) === last10(HAVEN_LINE)
  );
  for (const call of transfers) {
    const target = call.callee_name || call.callee_did_number || 'unknown';
    const intent =
      call.callee_ext_type === 'call_queue' ? queueIntent(target) : 'staff';
    rows.push({
      call_id: call.id,
      kind: 'haven_transfer',
      started_at: call.start_time,
      call_date: ptDate(call.start_time),
      caller_number: call.caller_did_number || null,
      caller_name: call.caller_name || null,
      answered_by: ANSWERED.has(call.call_result || '') ? 'staff' : 'missed',
      answered_by_name: call.callee_ext_type === 'user' ? target : null,
      haven_path: null,
      haven_intent: intent,
      transfer_target: target,
      duration_seconds: call.duration ?? null,
      raw: { call_result: call.call_result },
    });
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from('reception_call').upsert(chunk, { onConflict: 'call_id' });
    if (error) throw new Error(`reception_call upsert failed: ${error.message}`);
    upserted += chunk.length;
  }

  return {
    daysCovered: `${from}..${to}`,
    inboundCalls: inbound.length,
    havenTransfers: transfers.length,
    upserted,
  };
}

// ── Daily report aggregation ────────────────────────────────────

export interface ReceptionDay {
  date: string;
  total: number;
  ashley: number;
  staff: number;
  haven: number;
  havenDirect: number;
  havenOverflow: number;
  missed: number;
  transfers: number;
  transferLeasing: number;
  transferMaintenance: number;
  transferHuman: number;
  transferStaff: number;
  aiLeasing: number;
  aiOther: number;
}

export async function receptionDailyReport(
  supabase: SupabaseClient,
  days: number
): Promise<ReceptionDay[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('reception_call')
    .select('kind, call_date, answered_by, haven_path, haven_intent')
    .gte('call_date', since)
    .order('call_date', { ascending: true });
  if (error) throw new Error(`reception_call read failed: ${error.message}`);

  const byDate = new Map<string, ReceptionDay>();
  const day = (d: string): ReceptionDay => {
    let r = byDate.get(d);
    if (!r) {
      r = {
        date: d, total: 0, ashley: 0, staff: 0, haven: 0, havenDirect: 0, havenOverflow: 0,
        missed: 0, transfers: 0, transferLeasing: 0, transferMaintenance: 0, transferHuman: 0,
        transferStaff: 0, aiLeasing: 0, aiOther: 0,
      };
      byDate.set(d, r);
    }
    return r;
  };

  for (const row of data || []) {
    const r = day(row.call_date);
    if (row.kind === 'inbound') {
      r.total++;
      if (row.answered_by === 'ashley') r.ashley++;
      else if (row.answered_by === 'staff') r.staff++;
      else if (row.answered_by === 'haven') {
        r.haven++;
        if (row.haven_path === 'direct') r.havenDirect++;
        else r.havenOverflow++;
        if (row.haven_intent === 'leasing') r.aiLeasing++;
        else r.aiOther++;
      } else r.missed++;
    } else {
      r.transfers++;
      if (row.haven_intent === 'leasing') r.transferLeasing++;
      else if (row.haven_intent === 'maintenance') r.transferMaintenance++;
      else if (row.haven_intent === 'human') r.transferHuman++;
      else r.transferStaff++;
    }
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}
