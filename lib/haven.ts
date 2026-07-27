/**
 * Haven PMC API client (https://pmc.tools.usehaven.ai — "Haven PMC API
 * Reference" v1.0.0). Read-only leasing conversations, receptionist calls,
 * and aggregate receptionist metrics for the firm. Auth: per-firm bearer key
 * (HAVEN_API_KEY, format hav_<env>_…). Cursor pagination: limit (max 100) +
 * cursor; nextCursor null on the last page. No webhooks — poll via cron.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const HAVEN_BASE = process.env.HAVEN_BASE_URL || 'https://pmc.tools.usehaven.ai';

export function havenConfigured(): boolean {
  return !!process.env.HAVEN_API_KEY;
}

async function havenGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.HAVEN_API_KEY;
  if (!key) throw new Error('HAVEN_API_KEY is not set');
  const url = new URL(`${HAVEN_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Haven API ${path} (${res.status}): ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
  throw new Error(`Haven API ${path}: retries exhausted`);
}

// ── Types (per the PMC API reference) ───────────────────────────

export interface HavenConversation {
  conversationId: string;
  prospectId: string;
  firmId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneNumber: string | null;
  leadSource: string | null;
  propertyOfInterestPath: string | null;
  propertyAddress: string | null;
  propertyType: string | null;
  callSummary: string | null;
  lastActiveAt: string;
  lastChannelUsed: string | null;
  tourScheduled: boolean;
  scheduledTourStartTime: string | null;
  scheduledTourEndTime: string | null;
  tourTimezone: string | null;
  tourStatus: string | null;
  assignedLeasingAgent: string | null;
  recentTourHistory: string[];
  leadClassification: string | null;
  pipelinePhase: string | null;
  handledBy: string | null;
  firstContactAt: string;
  lastActivityAt: string;
  escalationFlag: boolean;
  flagType: string | null;
  flagDate: string | null;
  flagResolved: boolean | null;
  pendingFollowUp: boolean;
}

export interface HavenEvent {
  id: string;
  type: string;
  channel: string | null;
  createdAt: string;
  content: string | null;
  summary: string | null;
  recordingUrl: string | null;
}

export interface HavenMetrics {
  firmId: string;
  periodStart: string;
  periodEnd: string;
  totalCalls: number;
  callsHandledByAi: number;
  callsTransferred: number;
  callsAbandoned: number | null;
  aiResolutionRate: number | null;
  knowledgeGapCount: number;
}

interface CursorPage<K extends string, T> {
  nextCursor?: string | null;
}
type ConversationsPage = CursorPage<'conversations', HavenConversation> & {
  conversations?: HavenConversation[];
  data?: HavenConversation[];
};

/** Every leasing conversation, following nextCursor to the end. */
export async function fetchAllConversations(maxPages = 100): Promise<HavenConversation[]> {
  const all: HavenConversation[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { limit: '100' };
    if (cursor) params.cursor = cursor;
    const res = await havenGet<ConversationsPage>('/v1/leasing/conversations', params);
    all.push(...(res.conversations || res.data || []));
    cursor = res.nextCursor ?? null;
    if (!cursor) break;
  }
  return all;
}

export async function fetchConversationHistory(conversationId: string): Promise<HavenEvent[]> {
  const res = await havenGet<{ events?: HavenEvent[]; data?: HavenEvent[] }>(
    `/v1/leasing/conversations/${encodeURIComponent(conversationId)}/history`
  );
  return res.events || res.data || [];
}

export async function fetchReceptionistMetrics(
  periodStart: string,
  periodEnd: string
): Promise<HavenMetrics> {
  // Live response nests the payload under `metrics` (verified 2026-07-27).
  const res = await havenGet<{ metrics?: HavenMetrics } & HavenMetrics>('/v1/metrics', {
    periodStart,
    periodEnd,
  });
  return res.metrics ?? res;
}

// ── Event direction inference ───────────────────────────────────
// Live event `type` vocabulary (verified 2026-07-27): 'userMessage' =
// prospect-originated, 'assistantMessage' = Haven AI / firm-originated,
// across sms/email/voice channels. Regex fallback for any future types.

const INBOUND_RE = /^user|in(bound)?|receiv|prospect|incoming/i;
const OUTBOUND_RE = /^assistant|^agent|out(bound)?|sent|repl|follow|response/i;

export function classifyEventDirection(ev: HavenEvent): 'inbound' | 'outbound' | 'unknown' {
  if (ev.type === 'userMessage') return 'inbound';
  if (ev.type === 'assistantMessage') return 'outbound';
  if (INBOUND_RE.test(ev.type) && !OUTBOUND_RE.test(ev.type)) return 'inbound';
  if (OUTBOUND_RE.test(ev.type) && !INBOUND_RE.test(ev.type)) return 'outbound';
  return 'unknown';
}

/** First inbound + first subsequent outbound timestamps from a history. */
export function responseTimesFromHistory(events: HavenEvent[]): {
  firstInboundAt: string | null;
  firstOutboundAt: string | null;
  responseSeconds: number | null;
} {
  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  let firstInboundAt: string | null = null;
  let firstOutboundAt: string | null = null;
  for (const ev of sorted) {
    const dir = classifyEventDirection(ev);
    if (dir === 'inbound' && !firstInboundAt) firstInboundAt = ev.createdAt;
    if (dir === 'outbound' && firstInboundAt && !firstOutboundAt) firstOutboundAt = ev.createdAt;
    if (firstInboundAt && firstOutboundAt) break;
  }
  // Conversation opened by us (e.g. AI outbound follow-up): no inbound lead
  // event — treat the whole thread as answered instantly? No: leave null.
  const responseSeconds =
    firstInboundAt && firstOutboundAt
      ? Math.max(
          0,
          Math.round(
            (new Date(firstOutboundAt).getTime() - new Date(firstInboundAt).getTime()) / 1000
          )
        )
      : null;
  return { firstInboundAt, firstOutboundAt, responseSeconds };
}

// ── Sync into Supabase ──────────────────────────────────────────

export interface HavenSyncResult {
  conversations: number;
  historiesFetched: number;
  escalationsOpen: number;
  pendingFollowUps: number;
  errors: string[];
}

/**
 * Upsert all conversations into haven_conversation. Histories (one request
 * each) are only fetched for conversations that are new or whose
 * last_activity_at advanced since the stored row, so steady-state syncs stay
 * cheap.
 */
export async function syncHavenConversations(
  supabase: SupabaseClient,
  { historyBudget = 300 }: { historyBudget?: number } = {}
): Promise<HavenSyncResult> {
  const conversations = await fetchAllConversations();
  const errors: string[] = [];

  const { data: existing, error: exErr } = await supabase
    .from('haven_conversation')
    .select('conversation_id, last_activity_at, response_seconds, first_inbound_at');
  if (exErr) throw new Error(`haven_conversation read failed: ${exErr.message}`);
  const existingById = new Map((existing || []).map((r) => [r.conversation_id, r]));

  const needsHistory = conversations
    .filter((c) => {
      const row = existingById.get(c.conversationId);
      if (!row) return true;
      if (row.response_seconds != null) return false;
      return !row.last_activity_at || new Date(c.lastActivityAt) > new Date(row.last_activity_at);
    })
    .slice(0, historyBudget);

  const histories = new Map<string, ReturnType<typeof responseTimesFromHistory>>();
  for (const c of needsHistory) {
    try {
      const events = await fetchConversationHistory(c.conversationId);
      histories.set(c.conversationId, responseTimesFromHistory(events));
    } catch (err) {
      errors.push(`history ${c.conversationId}: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const rows = conversations.map((c) => {
    const rt = histories.get(c.conversationId);
    const prev = existingById.get(c.conversationId);
    return {
      conversation_id: c.conversationId,
      prospect_id: c.prospectId,
      first_name: c.firstName,
      last_name: c.lastName,
      email: c.email,
      phone_number: c.phoneNumber,
      lead_source: c.leadSource,
      property_path: c.propertyOfInterestPath,
      property_address: c.propertyAddress,
      property_type: c.propertyType,
      lead_classification: c.leadClassification,
      pipeline_phase: c.pipelinePhase,
      handled_by: c.handledBy,
      tour_scheduled: c.tourScheduled,
      tour_status: c.tourStatus,
      scheduled_tour_start: c.scheduledTourStartTime,
      assigned_leasing_agent: c.assignedLeasingAgent,
      first_contact_at: c.firstContactAt,
      last_activity_at: c.lastActivityAt,
      escalation_flag: c.escalationFlag,
      flag_type: c.flagType,
      flag_date: c.flagDate,
      flag_resolved: c.flagResolved,
      pending_follow_up: c.pendingFollowUp,
      first_inbound_at: rt?.firstInboundAt ?? prev?.first_inbound_at ?? null,
      response_seconds: rt?.responseSeconds ?? prev?.response_seconds ?? null,
      synced_at: new Date().toISOString(),
    };
  });

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from('haven_conversation')
      .upsert(rows.slice(i, i + 200), { onConflict: 'conversation_id' });
    if (error) throw new Error(`haven_conversation upsert failed: ${error.message}`);
  }

  return {
    conversations: conversations.length,
    historiesFetched: histories.size,
    escalationsOpen: conversations.filter((c) => c.escalationFlag && c.flagResolved !== true)
      .length,
    pendingFollowUps: conversations.filter((c) => c.pendingFollowUp).length,
    errors,
  };
}

// ── Response-time metrics for the leasing funnel ────────────────

export interface HavenResponseMetrics {
  avgHoursToFirstContact: number | null;
  pctContactedUnder1Hour: number | null;
  pctContactedUnder24Hours: number | null;
  pctNeverContacted: number | null;
  sampleSize: number;
}

/**
 * Response-time stats over conversations whose first contact falls in the
 * window. Reads the synced haven_conversation table (null if empty/missing).
 */
export async function havenResponseMetrics(
  supabase: SupabaseClient,
  since: Date
): Promise<HavenResponseMetrics | null> {
  const { data, error } = await supabase
    .from('haven_conversation')
    .select('response_seconds, first_inbound_at, first_contact_at')
    .gte('first_contact_at', since.toISOString());
  if (error || !data || data.length === 0) return null;

  const withResponse = data.filter((r) => r.response_seconds != null);
  const neverContacted = data.filter(
    (r) => r.first_inbound_at != null && r.response_seconds == null
  );
  const denom = withResponse.length + neverContacted.length;
  if (denom === 0) return null;

  const avgSec =
    withResponse.length > 0
      ? withResponse.reduce((s, r) => s + (r.response_seconds as number), 0) / withResponse.length
      : null;
  const pctIn = (secs: number) =>
    Math.round(
      (withResponse.filter((r) => (r.response_seconds as number) <= secs).length / denom) * 1000
    ) / 10;

  return {
    avgHoursToFirstContact: avgSec != null ? Math.round((avgSec / 3600) * 10) / 10 : null,
    pctContactedUnder1Hour: pctIn(3600),
    pctContactedUnder24Hours: pctIn(86400),
    pctNeverContacted: Math.round((neverContacted.length / denom) * 1000) / 10,
    sampleSize: denom,
  };
}
