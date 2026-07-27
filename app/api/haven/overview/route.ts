import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  havenConfigured,
  havenResponseMetrics,
  fetchReceptionistMetrics,
  type HavenMetrics,
} from '@/lib/haven';

export const maxDuration = 60;

/** Pipeline stages in journey order — Inactive is reported separately. */
const PHASE_ORDER = [
  'AwaitingEngagement',
  'PreTour',
  'PreTourScheduled',
  'PreTourConfirmed',
  'PostTour',
] as const;

const HOT_CLASSIFICATIONS = new Set(['Ready to Apply', 'Urgency to Move']);

interface ConversationRow {
  conversation_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  lead_source: string | null;
  property_address: string | null;
  lead_classification: string | null;
  pipeline_phase: string | null;
  tour_status: string | null;
  scheduled_tour_start: string | null;
  assigned_leasing_agent: string | null;
  first_contact_at: string | null;
  last_activity_at: string | null;
  escalation_flag: boolean;
  flag_type: string | null;
  flag_date: string | null;
  flag_resolved: boolean | null;
  pending_follow_up: boolean;
}

function prospectName(r: ConversationRow): string {
  return [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || r.phone_number || 'Unknown prospect';
}

function toFlag(r: ConversationRow) {
  return {
    conversation_id: r.conversation_id,
    name: prospectName(r),
    email: r.email,
    phone: r.phone_number,
    property: r.property_address,
    phase: r.pipeline_phase,
    flag_type: r.flag_type,
    flag_date: r.flag_date,
    last_activity_at: r.last_activity_at,
  };
}

/**
 * GET /api/haven/overview
 *
 * Aggregated Haven leasing + reception snapshot for the /haven page.
 * Leasing data comes from the synced haven_conversation table; reception
 * metrics are fetched live from the PMC API (cheap single calls).
 */
export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const rows: ConversationRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('haven_conversation')
        .select(
          'conversation_id, first_name, last_name, email, phone_number, lead_source, property_address, lead_classification, pipeline_phase, tour_status, scheduled_tour_start, assigned_leasing_agent, first_contact_at, last_activity_at, escalation_flag, flag_type, flag_date, flag_resolved, pending_follow_up'
        )
        .range(from, from + 999);
      if (error) throw new Error(`haven_conversation read failed: ${error.message}`);
      rows.push(...((data || []) as ConversationRow[]));
      if (!data || data.length < 1000) break;
    }

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
    const active = rows.filter((r) => r.pipeline_phase && r.pipeline_phase !== 'Inactive');

    // Funnel: current pipeline distribution, journey order.
    const funnel = PHASE_ORDER.map((phase) => ({
      phase,
      count: active.filter((r) => r.pipeline_phase === phase).length,
    }));
    const inactiveCount = rows.filter((r) => r.pipeline_phase === 'Inactive').length;

    // Flags that need action.
    const escalations = rows
      .filter((r) => r.escalation_flag && r.flag_resolved !== true)
      .sort((a, b) => (b.flag_date || '').localeCompare(a.flag_date || ''))
      .map(toFlag);
    const followUps = rows
      .filter((r) => r.pending_follow_up && !(r.escalation_flag && r.flag_resolved !== true))
      .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
      .map(toFlag);

    // Hot leads — strong classifications, still active.
    const hotLeads = active
      .filter((r) => r.lead_classification && HOT_CLASSIFICATIONS.has(r.lead_classification))
      .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
      .map((r) => ({
        ...toFlag(r),
        classification: r.lead_classification,
        lead_source: r.lead_source,
      }));

    // Upcoming tours.
    const tours = rows
      .filter(
        (r) =>
          r.scheduled_tour_start &&
          new Date(r.scheduled_tour_start) >= now &&
          r.tour_status !== 'cancelled'
      )
      .sort((a, b) => (a.scheduled_tour_start || '').localeCompare(b.scheduled_tour_start || ''))
      .map((r) => ({
        conversation_id: r.conversation_id,
        name: prospectName(r),
        property: r.property_address,
        start: r.scheduled_tour_start,
        status: r.tour_status,
        agent: r.assigned_leasing_agent,
      }));

    const responseTime = await havenResponseMetrics(supabase, ninetyDaysAgo);

    // Reception metrics — live, last 30 days (best-effort).
    let reception: HavenMetrics | null = null;
    if (havenConfigured()) {
      try {
        reception = await fetchReceptionistMetrics(
          new Date(now.getTime() - 30 * 86400000).toISOString(),
          now.toISOString()
        );
      } catch (err) {
        console.warn('[haven/overview] reception metrics failed:', err);
      }
    }

    const lastSync = rows.length
      ? rows.reduce<string | null>((max, r) => {
          return r.last_activity_at && (!max || r.last_activity_at > max) ? r.last_activity_at : max;
        }, null)
      : null;

    return NextResponse.json(
      {
        totals: {
          conversations: rows.length,
          activeProspects: active.length,
          inactive: inactiveCount,
          newLast30Days: rows.filter(
            (r) => r.first_contact_at && new Date(r.first_contact_at) >= new Date(now.getTime() - 30 * 86400000)
          ).length,
        },
        funnel,
        escalations,
        followUps,
        hotLeads,
        tours,
        responseTime,
        reception,
        lastActivityAt: lastSync,
        synced: rows.length > 0,
      },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    );
  } catch (error) {
    console.error('[haven/overview] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load Haven overview';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
