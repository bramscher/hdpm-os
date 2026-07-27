/**
 * Haven leasing digest — daily Slack DM to the leasing/maintenance leads
 * (Brody + Matt, same recipients as the other agent flags) with what needs a
 * human today: new escalations, stale hot leads, pending follow-ups.
 *
 * Reads the synced haven_conversation table (sync runs 15 min before the
 * digest cron). Sends nothing on a quiet day.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface DigestRow {
  conversation_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  property_address: string | null;
  lead_classification: string | null;
  pipeline_phase: string | null;
  flag_type: string | null;
  flag_date: string | null;
  flag_resolved: boolean | null;
  escalation_flag: boolean;
  pending_follow_up: boolean;
  last_activity_at: string | null;
  appfolio_lead_link: string | null;
}

const HOT = new Set(['Ready to Apply', 'Urgency to Move']);

function name(r: DigestRow): string {
  return (
    [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || r.phone_number || 'Unknown'
  );
}

function line(r: DigestRow, detail: string): string {
  const links: string[] = [];
  if (r.appfolio_lead_link) links.push(`<${r.appfolio_lead_link}|AppFolio>`);
  if (r.phone_number) links.push(r.phone_number);
  return `• *${name(r)}* — ${detail}${r.property_address ? ` · ${r.property_address}` : ''}${
    links.length ? ` · ${links.join(' · ')}` : ''
  }`;
}

export interface HavenDigest {
  shouldSend: boolean;
  text: string;
  blocks: Array<Record<string, unknown>>;
  counts: {
    newEscalations: number;
    openEscalations: number;
    staleHotLeads: number;
    pendingFollowUps: number;
  };
}

export async function buildHavenDigest(
  supabase: SupabaseClient,
  now = new Date()
): Promise<HavenDigest> {
  const rows: DigestRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('haven_conversation')
      .select(
        'conversation_id, first_name, last_name, email, phone_number, property_address, lead_classification, pipeline_phase, flag_type, flag_date, flag_resolved, escalation_flag, pending_follow_up, last_activity_at, appfolio_lead_link'
      )
      .range(from, from + 999);
    if (error) throw new Error(`haven_conversation read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const dayAgo = new Date(now.getTime() - 24 * 3600000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);

  const openEscalations = rows.filter((r) => r.escalation_flag && r.flag_resolved !== true);
  const newEscalations = openEscalations
    .filter((r) => r.flag_date && new Date(r.flag_date) >= dayAgo)
    .sort((a, b) => (b.flag_date || '').localeCompare(a.flag_date || ''));
  const staleHot = rows
    .filter(
      (r) =>
        r.lead_classification &&
        HOT.has(r.lead_classification) &&
        r.pipeline_phase !== 'Inactive' &&
        r.last_activity_at &&
        new Date(r.last_activity_at) < threeDaysAgo
    )
    .sort((a, b) => (a.last_activity_at || '').localeCompare(b.last_activity_at || ''));
  const followUps = rows.filter((r) => r.pending_follow_up);

  const counts = {
    newEscalations: newEscalations.length,
    openEscalations: openEscalations.length,
    staleHotLeads: staleHot.length,
    pendingFollowUps: followUps.length,
  };
  const shouldSend =
    counts.newEscalations > 0 || counts.staleHotLeads > 0 || counts.pendingFollowUps > 0;

  const sections: string[] = [];
  if (newEscalations.length > 0) {
    sections.push(
      `*🚨 New escalations (24h): ${newEscalations.length}* — ${openEscalations.length} open total\n` +
        newEscalations.slice(0, 8).map((r) => line(r, r.flag_type || 'Escalated')).join('\n')
    );
  } else if (openEscalations.length > 0) {
    sections.push(`🚨 No new escalations — ${openEscalations.length} still open.`);
  }
  if (staleHot.length > 0) {
    sections.push(
      `*🔥 Hot leads going cold (3+ days quiet): ${staleHot.length}*\n` +
        staleHot
          .slice(0, 5)
          .map((r) =>
            line(
              r,
              `${r.lead_classification} · quiet since ${new Date(
                r.last_activity_at!
              ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            )
          )
          .join('\n')
    );
  }
  if (followUps.length > 0) {
    sections.push(
      `*✉️ Pending follow-ups: ${followUps.length}*\n` +
        followUps.slice(0, 5).map((r) => line(r, r.pipeline_phase || 'awaiting reply')).join('\n')
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hdpm-chatbot.vercel.app';
  const text = `Haven leasing digest — ${counts.newEscalations} new escalations, ${counts.staleHotLeads} hot leads going cold, ${counts.pendingFollowUps} pending follow-ups`;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Haven Leasing — needs a human today', emoji: true },
    },
    ...sections.map((s) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: s },
    })),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `<${appUrl}/haven|Open the Haven board> · data synced from Haven AI`,
        },
      ],
    },
  ];

  return { shouldSend, text, blocks, counts };
}
